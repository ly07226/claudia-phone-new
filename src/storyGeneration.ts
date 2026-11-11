import {fitDocumentInput} from './wizardDocumentBudget';
import {verifyDocumentSnapshot} from './wizardDocumentSnapshot';
import {replayDocumentState,runtimeTurn} from './wizardRuntimeConfig';
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
import {compileSimulatorRuntime,containsHiddenEvidence,documentKnowledge,validateDocumentDisclosure} from './wizardSimulatorRuntime';
import {deriveSimulatorProgress} from './wizardSimulatorProgress';
import {replaySimulatorState,applySimulatorChanges} from './wizardSimulatorState';
export {storyPrompt,storyInput} from './storyContext';
const schema={type:'OBJECT',properties:{segments:{type:'ARRAY',maxItems:256,items:{type:'OBJECT',properties:{type:{type:'STRING',enum:['narration','action','dialogue']},text:{type:'STRING'},speaker:{type:'STRING'}},required:['type','text']}},body:{type:'STRING'},choices:{type:'ARRAY',minItems:4,maxItems:4,items:{type:'OBJECT',properties:{id:{type:'STRING',enum:['A','B','C','D']},text:{type:'STRING'}},required:['id','text']}}},required:['body','choices']};

const simulatorSchema={...schema,properties:{...schema.properties,stateChanges:{type:'ARRAY',maxItems:40,items:{type:'OBJECT',properties:{key:{type:'STRING'},op:{type:'STRING',enum:['set','increment','remove']},value:{anyOf:[{type:'STRING'},{type:'NUMBER'},{type:'BOOLEAN'}]}},required:['key','op']}}},required:[...schema.required,'stateChanges']};
export async function generateStory(worldId:string,actionInput?:string|StoryAction,options:{signal?:AbortSignal;allowOldDefinition?:boolean;expected?:StoryExpectedProgress;firstAttemptOnly?:boolean;operation?:'advance'|'regenerate'}={}){
 if(options.signal?.aborted)throw Error('生成已取消，原主线未改变。');
 const initialWorld=await db.worlds.get(worldId);
 const document=initialWorld?.storyDocument;if(document)await verifyDocumentSnapshot(document);
 const simulatorSource=document?{id:document.source.id}:initialWorld?.simulatorSource;
 // Prepared documents use automatic source validation; legacy reviewed archives remain compatible.
 let simulatorPolicy=simulatorSource?await compileSimulatorRuntime(simulatorSource.id,document):undefined;
 // Never claim a generation lease if the supplied public world metadata already contains secret evidence.
 if(containsHiddenEvidence([initialWorld?.description,initialWorld?.background,initialWorld?.rules,initialWorld?.script],simulatorPolicy))throw Error('公开世界设定包含未公开的秘密证据，未请求模型。');
 const claim=await claimStory(worldId,actionInput,!!options.allowOldDefinition,options.expected,!!options.firstAttemptOnly,options.operation,simulatorPolicy?Math.min(24000,new TextEncoder().encode(JSON.stringify({rules:simulatorPolicy.publicRules,runtime:document?.runtime})).length+3000):0),s=claim.session,token=s.pending!.token;
 const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;abort();},storyLimits.leaseMs);let failure:'cancelled'|'request'|'invalid'|'stale'|'budget'='request',phase:StoryFailureStage='configuration';
 let configuredOutputTokens=0,diagnosticRecorded=false,credentialForRedaction='\u0000';
 let simulatorInput=claim.input,promptText=storyPrompt;
 let inputData:Record<string,any>={};
 const record=(outcome:'complete'|'failed',body?:string)=>{if(diagnosticRecorded||!structured?.getResponseInfo().attempted)return;diagnosticRecorded=true;const info=structured.getResponseInfo();recordStoryGeneration({outcome,length:claim.length,inputBytes:new TextEncoder().encode(promptText+simulatorInput).length,configuredOutputTokens,outputTokenLimit:outputTokenLimit??0,...(info.finishReason?{finishReason:info.finishReason}:{}),...(info.outputTokens!==undefined?{returnedOutputTokens:info.outputTokens}:{}),...(info.textCharacters!==undefined?{responseCharacters:info.textCharacters}:{}),...(body!==undefined?{bodyCharacters:Array.from(body.replace(/\s/gu,'')).length,chineseCharacters:(body.match(/\p{Script=Han}/gu)||[]).length,belowTarget:Array.from(body.replace(/\s/gu,'')).length<Number(storyLengths[claim.length].target.split('～')[0])}:{}),recentNodes:inputData.confirmedHistory.length,omittedNodes:inputData.historyOmitted,memoryExcerpts:inputData.longTermStoryMemory?.excerpts.length??0});};
 let structured:ReturnType<typeof storyJSONTransport>|undefined,outputTokenLimit:number|undefined;
 try{
 const runtime=document?.runtime;const replay=runtime?replayDocumentState(claim.path,runtime):undefined;
 if(document)simulatorPolicy=await compileSimulatorRuntime(document.source.id,document,replay?.state,replay?.history);
 const simulation=!!simulatorPolicy?.simulation;
  const simulatorPrompt=simulation?' 模拟器附加协议：除body、choices、segments外必须输出stateChanges数组；每项为key、op以及set/increment时的value，value必须是字符串、数字或布尔值。没有可确认的变化时返回空数组。仅记录正文已经发生的公开变化，不记录NPC秘密，不得编造玩家行动。':'';
  const effectivePrompt=storyPrompt+simulatorPrompt;
 promptText=effectivePrompt;
 simulatorInput=simulatorPolicy?JSON.stringify({...JSON.parse(claim.input),documentKnowledge:documentKnowledge(simulatorPolicy,[s.definition.participants?.protagonist.name??'',...s.definition.participants?.characters.map(c=>c.name)??[]].filter(Boolean),s.definition.participants?.protagonist.name),simulatorProgress:deriveSimulatorProgress(claim.path),...(simulation?{simulatorState:replay?.state??replaySimulatorState(claim.path),...(runtime?{runtimeDeclaration:runtime}: {})}:{}),simulatorRules:{sourceName:simulatorPolicy.sourceName,reviewedChunks:simulatorPolicy.reviewedChunks,rules:simulatorPolicy.publicRules.map(r=>({id:`${r.sourceStart}:${r.sourceEnd}`,kind:r.kind,text:r.text,certainty:r.certainty})),instruction:(simulatorPolicy.referenceOnly?'本剧本采用原文叙事，没有启用附加状态机制；提供的是按预算选取的原文参考，不是完整执行配置，不能声称程序已执行未提供的规则。uninterpreted表示未经结构化整理的原文，依据上下文区分设定、计划与已发生事实；不得从缺失资料推测秘密。':simulation?'状态引擎已启用。':'普通故事模式，不输出stateChanges或强制数值模拟。')+(simulatorPolicy.referenceOnly?'这是当前世界的原文参考，不代表已审核的执行规则':'这是当前世界已审核的引用')+'，不是全知视角授权；规则与人物背景不是已发生事件。certainty=uncertain/planned仅作未证实信息/计划，不得当成事实或确定硬规则。存在相互冲突且无法确定的条件时，不擅自选一条；只有当前行动确实依赖该条件才用普通语言向玩家澄清，其余暂缓。不得让角色无故知道未在正文揭示的其他人物资料。'+(simulatorPolicy.referenceOnly?'仅参考本次提供的公开原文':'仅使用已校验的公开规则')+'；未提供的原文和角色秘密不得推断为事实。不推断秘密状态；只有状态引擎启用时才输出stateChanges。'}}):claim.input;
 inputData=JSON.parse(simulatorInput);
  if(containsHiddenEvidence(inputData,simulatorPolicy))throw Error('剧情输入包含已确认的角色秘密原文，已阻止请求；请检查世界设定与历史记录。');
  try{if(simulatorPolicy){simulatorInput=fitDocumentInput(inputData,effectivePrompt,storyLimits.inputBytes);inputData=JSON.parse(simulatorInput);}else if(new TextEncoder().encode(storyPrompt+simulatorInput).length>storyLimits.inputBytes)throw Error('budget');}catch{throw new StoryGenerationError(makeStoryFailure('budget','admission',false));}
  const {config}=await reconcileApiDefault();if(!config)throw new StoryGenerationError(makeStoryFailure(await db.apiConfigs.count()?'config-invalid':'config-missing','configuration',false));const credential=await db.apiCredentials.get(config.id);if(!credential?.apiKey||!usableApi(config,credential.apiKey))throw new StoryGenerationError(makeStoryFailure('config-invalid','configuration',false));
  credentialForRedaction=credential.apiKey;
  if(controller.signal.aborted)throw Error('cancelled');
  structured=storyJSONTransport(config,simulation?simulatorSchema:schema,async()=>{
   const admitted=await db.transaction('r',storyTables(),async()=>{
    const current=await db.storySessions.get(s.id),world=await db.worlds.get(worldId);
    return !controller.signal.aborted&&current?.pending?.token===token&&current.pending.expiresAt>Date.now()&&current.revision===s.revision&&current.headNodeId===s.headNodeId&&world?.script?.playMode==='story'&&JSON.stringify(await resolveStoryDefinition(world))===claim.worldSnapshot&&JSON.stringify(world.storyDocument??world.simulatorSource??null)===claim.documentSnapshot&&JSON.stringify(world.storyPreferences?.guidance??null)===claim.guidanceSnapshot&&(!claim.replacement||JSON.stringify(await db.storyNodes.get(claim.replacement.id))===JSON.stringify(claim.replacement));
   });
   if(!admitted)failure='stale';return admitted;
  },true);
  configuredOutputTokens=config.maxTokens;
  outputTokenLimit=Math.min(config.maxTokens,storyLengths[claim.length].tokens,storyLimits.outputTokens);

  const input=simulatorInput;if(new TextEncoder().encode(effectivePrompt+input).length>storyLimits.inputBytes)throw new StoryGenerationError(makeStoryFailure('budget','admission',false));
  const messages:ContextMessage[]=[{role:'system',content:effectivePrompt},{role:'user',content:input}];
  if(requestDebugEnabled())registerRequestDiagnostics('story',messages,[{source:'story-instruction',text:storyPrompt,role:'system'},{source:'story-input',text:input,role:'user'}]);
  phase='request';const raw=await requestReply({...config,maxTokens:outputTokenLimit},credential.apiKey,messages,controller.signal,structured.transport,false);
  failure='invalid';phase='parse';if(structured.getResponseInfo().transportInterrupted)throw new StoryGenerationError(makeStoryFailure('network','response',true));if(structured.getResponseInfo().blocked)throw new StoryResponseError('blocked');if(structured.isTruncated())throw new StoryResponseError('truncated',{responseCharacters:raw.length});const participants=s.definition.participants;const result=parseStoryReply(raw,participants?[participants.protagonist.name,...participants.characters.map(c=>c.name)]:[],simulation);
  // A model can still hallucinate private source evidence even when it was not in its prompt.
  // Never persist or display a response containing a verified private passage.
  phase='validation';if(containsHiddenEvidence(result,simulatorPolicy))throw Error('生成包含未授权秘密证据，本回合未保存。');
  phase='validation';if(simulatorPolicy)validateDocumentDisclosure(result,simulatorPolicy,s.definition.participants?.protagonist.name);const simulatorChanges=result.stateChanges;
  if(simulatorChanges){if(runtime)runtimeTurn(replay!.state,simulatorChanges,runtime,new Set(replay!.fired));else applySimulatorChanges(replaySimulatorState(claim.path),simulatorChanges);}
  const id=crypto.randomUUID();phase='validation';
  const node:StoryNode={...(simulatorChanges?{simulatorChanges}:{}),id,worldId,sessionId:s.id,body:result.body,...(result.segments?{segments:result.segments}:{}),choices:result.choices.map(c=>({id:`${id}:${c.id}`,label:c.id,text:c.text})),...(claim.parentNodeId?{parentNodeId:claim.parentNodeId,action:claim.action,...(claim.action?.kind==='choice'?{fromChoiceId:claim.action.choiceId}:{})}:{}),narrativeLength:claim.length,requestId:token,createdAt:Date.now(),definitionRevision:s.definitionRevision,sequence:claim.nextRevision};validateStoryNode(node);
  failure='stale';phase='commit';let abortCommit=()=>{};const cancelCommit=()=>abortCommit();controller.signal.addEventListener('abort',cancelCommit,{once:true});
  try{await db.transaction('rw',storyTables(),async tx=>{
   abortCommit=()=>{try{tx.abort();}catch{/* Transaction already settled. */}};
   const current=await db.storySessions.get(s.id),world=await db.worlds.get(worldId);
   if(controller.signal.aborted||!current||current.pending?.token!==token||current.revision!==s.revision||current.headNodeId!==s.headNodeId||Date.now()>=s.pending!.expiresAt||!world||JSON.stringify(await resolveStoryDefinition(world))!==claim.worldSnapshot||JSON.stringify(world.storyDocument??world.simulatorSource??null)!==claim.documentSnapshot||JSON.stringify(world.storyPreferences?.guidance??null)!==claim.guidanceSnapshot)throw Error('stale');
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
  let measuredBody:string|undefined;try{const x=JSON.parse(structured?.getPartialText()??'');if(typeof x?.body==='string'&&x.body.length<=storyLimits.body&&!containsHiddenEvidence(x.body,simulatorPolicy))measuredBody=x.body;}catch{/* Incomplete JSON has no safely measurable body. */}
  record('failed',measuredBody);
  const diagnostic=makeStoryFailure(code,stage,!!info?.attempted,{httpStatus:info?.httpStatus??details.httpStatus,serviceCode:details.serviceCode,finishReason:info?.finishReason,responseCharacters:info?.textCharacters??issue?.detail.responseCharacters,choiceCount:issue?.detail.choiceCount,outputTokenLimit});
  await db.transaction('rw',db.storySessions,async()=>{const current=await db.storySessions.get(s.id);if(current?.pending?.token===token){const text=structured?.getPartialText().split(credentialForRedaction).join('[凭据已隐藏]');const interruptedOutput=text&&!simulatorPolicy?.secretCount&&code!=='stale'&&current.revision===s.revision&&current.headNodeId===s.headNodeId&&(structured?.isTruncated()||info?.transportInterrupted)?{text,reason:(structured?.isTruncated()?'truncated':'transport') as 'truncated'|'transport',baseRevision:current.revision,createdAt:Date.now()}:current.interruptedOutput;await db.storySessions.put({...current,interruptedOutput,status:'failed',pending:undefined,error:failure,failureDetails:diagnostic,updatedAt:Date.now()});}}).catch(()=>{});
  throw new StoryGenerationError(diagnostic);
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
