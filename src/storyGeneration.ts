import {recordStoryGeneration} from './storyDiagnostics';
export {getStoryGenerationDiagnostics} from './storyDiagnostics';
import {describeReplyFailure} from './replyFailure';
import {makeStoryFailure,StoryGenerationError,type StoryFailureStage,type StoryFailureCode} from './storyFailure';
import {parseStoryReply,StoryResponseError,recordStoryResponseFailure} from './storyResponse';
export {parseStoryReply,getStoryResponseDiagnostics} from './storyResponse';
import {db} from './store';
import {reconcileApiDefault,usableApi} from './apiSelection';
import {storyJSONTransport} from './storyJSON';
import {requestReply} from './chatProvider';
import {registerRequestDiagnostics,requestDebugEnabled} from './chatRequestDiagnostics';
import type {ContextMessage} from './chatTypes';
import {claimStory,resolveStoryDefinition,storyTables} from './storyStore';
import {validateStoryNode} from './storyValidation';
import {storyLimits,storyLengths,type StoryNode,type StoryAction,type StoryExpectedProgress} from './storyTypes';
import {storyPrompt} from './storyContext';
import {compileSimulatorRuntime} from './wizardSimulatorRuntime';
import {deriveSimulatorProgress} from './wizardSimulatorProgress';
export {storyPrompt,storyInput} from './storyContext';
const schema={type:'OBJECT',properties:{segments:{type:'ARRAY',maxItems:256,items:{type:'OBJECT',properties:{type:{type:'STRING',enum:['narration','action','dialogue']},text:{type:'STRING'},speaker:{type:'STRING'}},required:['type','text']}},body:{type:'STRING'},choices:{type:'ARRAY',minItems:4,maxItems:4,items:{type:'OBJECT',properties:{id:{type:'STRING',enum:['A','B','C','D']},text:{type:'STRING'}},required:['id','text']}}},required:['body','choices']};

export async function generateStory(worldId:string,actionInput?:string|StoryAction,options:{signal?:AbortSignal;allowOldDefinition?:boolean;expected?:StoryExpectedProgress;firstAttemptOnly?:boolean;operation?:'advance'|'regenerate'}={}){
 if(options.signal?.aborted)throw Error('生成已取消，原主线未改变。');
 const simulatorSource=(await db.worlds.get(worldId))?.simulatorSource;
 // The browser-local source must pass the human review gate before any paid request.
 const simulatorPolicy=simulatorSource?await compileSimulatorRuntime(simulatorSource.id):undefined;
 // Never claim a generation lease if the supplied public world metadata already contains secret evidence.
 if(simulatorPolicy?.secretEvidence.some(secret=>secret.length>=12&&[
  (await db.worlds.get(worldId))?.description??'',(await db.worlds.get(worldId))?.background??'',(await db.worlds.get(worldId))?.rules??''
 ].some(publicText=>publicText.includes(secret))))throw Error('公开世界设定包含已确认的角色秘密原文，请先分离公开设定与秘密；未请求模型。');
 const claim=await claimStory(worldId,actionInput,!!options.allowOldDefinition,options.expected,!!options.firstAttemptOnly,options.operation),s=claim.session,token=s.pending!.token;
 const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;abort();},storyLimits.leaseMs);let failure:'cancelled'|'request'|'invalid'|'stale'|'budget'='request',phase:StoryFailureStage='configuration';
 let configuredOutputTokens=0,diagnosticRecorded=false,credentialForRedaction='\u0000';
 const simulatorInput=simulatorPolicy?JSON.stringify({...JSON.parse(claim.input),simulatorProgress:deriveSimulatorProgress(claim.path),simulatorRules:{sourceName:simulatorPolicy.sourceName,reviewedChunks:simulatorPolicy.reviewedChunks,rules:simulatorPolicy.publicRules.map(r=>({kind:r.kind,text:r.text})),instruction:'仅使用已人工确认的公开规则；未提供的原文和角色秘密不得推断为事实。'}}):claim.input;
 const inputData=JSON.parse(simulatorInput);
 const record=(outcome:'complete'|'failed',body?:string)=>{if(diagnosticRecorded||!structured?.getResponseInfo().attempted)return;diagnosticRecorded=true;const info=structured.getResponseInfo();recordStoryGeneration({outcome,length:claim.length,inputBytes:new TextEncoder().encode(storyPrompt+simulatorInput).length,configuredOutputTokens,outputTokenLimit:outputTokenLimit??0,...(info.finishReason?{finishReason:info.finishReason}:{}),...(info.outputTokens!==undefined?{returnedOutputTokens:info.outputTokens}:{}),...(info.textCharacters!==undefined?{responseCharacters:info.textCharacters}:{}),...(body!==undefined?{bodyCharacters:Array.from(body.replace(/\s/gu,'')).length,chineseCharacters:(body.match(/\p{Script=Han}/gu)||[]).length,belowTarget:Array.from(body.replace(/\s/gu,'')).length<Number(storyLengths[claim.length].target.split('～')[0])}:{}),recentNodes:inputData.confirmedHistory.length,omittedNodes:inputData.historyOmitted,memoryExcerpts:inputData.longTermStoryMemory?.excerpts.length??0});};
 let structured:ReturnType<typeof storyJSONTransport>|undefined,outputTokenLimit:number|undefined;
 try{
  const input=simulatorInput;
  if(simulatorPolicy?.secretEvidence.some(secret=>secret.length>=12&&input.includes(secret)))throw Error('剧情输入包含已确认的角色秘密原文，已阻止请求；请检查世界设定与历史记录。');
  if(new TextEncoder().encode(storyPrompt+input).length>storyLimits.inputBytes)throw Error('模拟器公开规则超过剧情输入预算，未请求模型；请精简并人工确认规则。');
  const {config}=await reconcileApiDefault();if(!config)throw new StoryGenerationError(makeStoryFailure(await db.apiConfigs.count()?'config-invalid':'config-missing','configuration',false));const credential=await db.apiCredentials.get(config.id);if(!credential?.apiKey||!usableApi(config,credential.apiKey))throw new StoryGenerationError(makeStoryFailure('config-invalid','configuration',false));
  credentialForRedaction=credential.apiKey;
  if(controller.signal.aborted)throw Error('cancelled');
  structured=storyJSONTransport(config,schema,async()=>{
   const admitted=await db.transaction('r',storyTables(),async()=>{
    const current=await db.storySessions.get(s.id),world=await db.worlds.get(worldId);
    return !controller.signal.aborted&&current?.pending?.token===token&&current.pending.expiresAt>Date.now()&&current.revision===s.revision&&current.headNodeId===s.headNodeId&&world?.script?.playMode==='story'&&JSON.stringify(await resolveStoryDefinition(world))===claim.worldSnapshot&&JSON.stringify(world.storyPreferences?.guidance??null)===claim.guidanceSnapshot&&(!claim.replacement||JSON.stringify(await db.storyNodes.get(claim.replacement.id))===JSON.stringify(claim.replacement));
   });
   if(!admitted)failure='stale';return admitted;
  },true);
  configuredOutputTokens=config.maxTokens;
  outputTokenLimit=Math.min(config.maxTokens,storyLengths[claim.length].tokens,storyLimits.outputTokens);
  const messages:ContextMessage[]=[{role:'system',content:storyPrompt},{role:'user',content:input}];
  if(requestDebugEnabled())registerRequestDiagnostics('story',messages,[{source:'story-instruction',text:storyPrompt,role:'system'},{source:'story-input',text:input,role:'user'}]);
  phase='request';const raw=await requestReply({...config,maxTokens:outputTokenLimit},credential.apiKey,messages,controller.signal,structured.transport,false);
  failure='invalid';phase='parse';if(structured.getResponseInfo().transportInterrupted)throw new StoryGenerationError(makeStoryFailure('network','response',true));if(structured.getResponseInfo().blocked)throw new StoryResponseError('blocked');if(structured.isTruncated())throw new StoryResponseError('truncated',{responseCharacters:raw.length});const participants=s.definition.participants;const result=parseStoryReply(raw,participants?[participants.protagonist.name,...participants.characters.map(c=>c.name)]:[]);const id=crypto.randomUUID();phase='validation';
  const node:StoryNode={id,worldId,sessionId:s.id,body:result.body,...(result.segments?{segments:result.segments}:{}),choices:result.choices.map(c=>({id:`${id}:${c.id}`,label:c.id,text:c.text})),...(claim.parentNodeId?{parentNodeId:claim.parentNodeId,action:claim.action,...(claim.action?.kind==='choice'?{fromChoiceId:claim.action.choiceId}:{})}:{}),narrativeLength:claim.length,requestId:token,createdAt:Date.now(),definitionRevision:s.definitionRevision,sequence:claim.nextRevision};validateStoryNode(node);
  failure='stale';phase='commit';let abortCommit=()=>{};const cancelCommit=()=>abortCommit();controller.signal.addEventListener('abort',cancelCommit,{once:true});
  try{await db.transaction('rw',storyTables(),async tx=>{
   abortCommit=()=>{try{tx.abort();}catch{/* Transaction already settled. */}};
   const current=await db.storySessions.get(s.id),world=await db.worlds.get(worldId);
   if(controller.signal.aborted||!current||current.pending?.token!==token||current.revision!==s.revision||current.headNodeId!==s.headNodeId||Date.now()>=s.pending!.expiresAt||!world||JSON.stringify(await resolveStoryDefinition(world))!==claim.worldSnapshot||JSON.stringify(world.storyPreferences?.guidance??null)!==claim.guidanceSnapshot)throw Error('stale');
   if(claim.replacement){const old=await db.storyNodes.get(claim.replacement.id);if(JSON.stringify(old)!==JSON.stringify(claim.replacement)||await db.storyNodes.where('parentNodeId').equals(claim.replacement.id).count())throw Error('stale');await db.storyNodes.delete(claim.replacement.id);}
   if(claim.guidance?.enabled&&claim.guidance.mode==='once')await db.worlds.update(worldId,{storyPreferences:{...world.storyPreferences!,guidance:{...claim.guidance,enabled:false,revision:claim.guidance.revision+1}}});
   await db.storyNodes.add(node);await db.storySessions.put({...current,headNodeId:node.id,revision:claim.nextRevision,status:'ready',pending:undefined,error:undefined,failureDetails:undefined,interruptedOutput:undefined,actionDraft:undefined,updatedAt:Date.now()});
  });}finally{controller.signal.removeEventListener('abort',cancelCommit);}
  record('complete',node.body);
  return node;
 }catch(error){
  const info=structured?.getResponseInfo(),details=describeReplyFailure(error);
  let code:StoryFailureCode='unknown',stage:StoryFailureStage=phase;
  const issue=controller.signal.aborted?undefined:error instanceof StoryResponseError?error:structured?.isTruncated()?new StoryResponseError('truncated'):info?.blocked?new StoryResponseError('blocked'):info?.invalidEnvelope?new StoryResponseError('envelope-invalid'):info?.invalidContent?new StoryResponseError('envelope-shape'):info?.textCharacters===0&&info.httpStatus===200&&!info.serviceError?new StoryResponseError('empty-response'):info?.textCharacters!==undefined&&info.textCharacters>storyLimits.outputChars?new StoryResponseError('response-too-long'):undefined;
  if(controller.signal.aborted){failure='cancelled';code=timedOut?'timeout':'cancelled';}
  else if(error instanceof StoryGenerationError){code=error.failure.code;stage=error.failure.stage;}
  else if(info?.transportInterrupted){failure='request';code='network';stage='response';}
  else if(issue){failure='invalid';recordStoryResponseFailure(issue,outputTokenLimit);code=issue.code==='segments-invalid'?'validation-failed':issue.code;stage=code.startsWith('json-')?'parse':['blocked','truncated','empty-response','envelope-invalid','envelope-shape','response-too-long'].includes(code)?'response':'validation';}
  else if(error instanceof Error&&error.message==='budget'){failure='budget';code='budget';stage='admission';}
  else if(error instanceof Error&&error.message==='stale'||failure==='stale'&&phase==='request'){failure='stale';code='stale';}
  else if(phase==='commit'){failure='request';code='storage-failed';}
  else if(phase==='validation'){failure='invalid';code='validation-failed';}
  else if(phase==='request'&&!info?.attempted){code='admission-failed';stage='admission';}
  else if(phase==='request'){
   stage=info?.httpStatus!==undefined?'response':'request';
   code=['auth','quota','rate','network','server'].includes(details.kind)?details.kind as StoryFailureCode:details.kind==='safety'?'blocked':info?.httpStatus!==undefined?'http-error':'unknown';
  }
  let measuredBody:string|undefined;try{const x=JSON.parse(structured?.getPartialText()??'');if(typeof x?.body==='string'&&x.body.length<=storyLimits.body)measuredBody=x.body;}catch{/* Incomplete JSON has no safely measurable body. */}
  record('failed',measuredBody);
  const diagnostic=makeStoryFailure(code,stage,!!info?.attempted,{httpStatus:info?.httpStatus??details.httpStatus,serviceCode:details.serviceCode,finishReason:info?.finishReason,responseCharacters:info?.textCharacters??issue?.detail.responseCharacters,choiceCount:issue?.detail.choiceCount,outputTokenLimit});
  await db.transaction('rw',db.storySessions,async()=>{const current=await db.storySessions.get(s.id);if(current?.pending?.token===token){const text=structured?.getPartialText().split(credentialForRedaction).join('[凭据已隐藏]');const interruptedOutput=text&&code!=='stale'&&current.revision===s.revision&&current.headNodeId===s.headNodeId&&(structured?.isTruncated()||info?.transportInterrupted)?{text,reason:(structured?.isTruncated()?'truncated':'transport') as 'truncated'|'transport',baseRevision:current.revision,createdAt:Date.now()}:current.interruptedOutput;await db.storySessions.put({...current,interruptedOutput,status:'failed',pending:undefined,error:failure,failureDetails:diagnostic,updatedAt:Date.now()});}}).catch(()=>{});
  throw new StoryGenerationError(diagnostic);
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
