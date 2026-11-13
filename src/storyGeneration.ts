import {resolveStoryDirectives,checkStoryDirectives} from './storyDirectives';
import {storyResultKey,hasStoryResult,recoverStoryResult,retainStoryResult,discardStoryResult} from './storyResultRecovery';
import {storyOutputBudget,rememberStoryOutputLimit} from './storyOutputBudget';
import type {ApiConfig} from './api';
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
import {compileSimulatorRuntime,documentKnowledge} from './wizardSimulatorRuntime';
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
 const claim=await claimStory(worldId,actionInput,!!options.allowOldDefinition,options.expected,!!options.firstAttemptOnly,options.operation,simulatorPolicy?(simulatorPolicy.referenceOnly?5000:Math.min(24000,new TextEncoder().encode(JSON.stringify({rules:simulatorPolicy.publicRules,runtime:document?.runtime})).length+3000)):128),s=claim.session,token=s.pending!.token;
 const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;abort();},storyLimits.leaseMs);let failure:'cancelled'|'request'|'invalid'|'stale'|'budget'='request',phase:StoryFailureStage='configuration';
 let budgetConfig:ApiConfig|undefined;let knownModelLimit:number|undefined;
 let requestAttempts=0,configuredOutputTokens=0,diagnosticRecorded=false,credentialForRedaction='\u0000';
 let simulatorInput=claim.input,promptText=storyPrompt;
 let inputData:Record<string,any>={};
 const record=(outcome:'complete'|'failed',body?:string)=>{if(diagnosticRecorded||!requestAttempts)return;diagnosticRecorded=true;const info=structured!.getResponseInfo();recordStoryGeneration({requestAttempts,correctionAttempts:Math.max(0,requestAttempts-1),outcome,length:claim.length,inputBytes:new TextEncoder().encode(promptText+simulatorInput).length,configuredOutputTokens,outputTokenLimit:outputTokenLimit??0,...((info.modelOutputLimit??knownModelLimit)?{modelOutputLimit:info.modelOutputLimit??knownModelLimit}:{}),...(info.finishReason?{finishReason:info.finishReason}:{}),...(info.outputTokens!==undefined?{returnedOutputTokens:info.outputTokens}:{}),...(info.textCharacters!==undefined?{responseCharacters:info.textCharacters}:{}),...(body!==undefined?{bodyCharacters:Array.from(body.replace(/\s/gu,'')).length,chineseCharacters:(body.match(/\p{Script=Han}/gu)||[]).length,belowTarget:Array.from(body.replace(/\s/gu,'')).length<(inputData.outputRequirements?.length?.min??Number(storyLengths[claim.length].target.split('～')[0]))}:{}),recentNodes:inputData.confirmedHistory.length,omittedNodes:inputData.historyOmitted,memoryExcerpts:inputData.longTermStoryMemory?.excerpts.length??0});};
 let recoveryKey:string|undefined,result:ReturnType<typeof parseStoryReply>|undefined;
 let structured:ReturnType<typeof storyJSONTransport>|undefined,outputTokenLimit:number|undefined;
 try{
 const runtime=document?.runtime;const replay=runtime?replayDocumentState(claim.path,runtime):undefined;
 if(document)simulatorPolicy=await compileSimulatorRuntime(document.source.id,document,replay?.state,replay?.history);
 const simulation=!!simulatorPolicy?.simulation;
 const directives=resolveStoryDirectives(s.definition.script.perspective??'second',claim.guidance);
 if(directives.conflict)throw new StoryGenerationError(makeStoryFailure('directive-conflict','admission',false));
 if(hasStoryResult(worldId)){recoveryKey=await storyResultKey(claim);result=recoverStoryResult(worldId,recoveryKey,token);}
 if(!result){
  const simulatorPrompt=simulation?' 模拟器附加协议：除body、choices、segments外必须输出stateChanges数组；每项为key、op以及set/increment时的value，value必须是字符串、数字或布尔值。没有可确认的变化时返回空数组。仅记录正文已经发生的公开变化，不得编造玩家行动。':'';
  const effectivePrompt=storyPrompt+simulatorPrompt;
 promptText=effectivePrompt;
 simulatorInput=simulatorPolicy?JSON.stringify({...JSON.parse(claim.input),documentKnowledge:documentKnowledge(simulatorPolicy,[s.definition.participants?.protagonist.name??'',...s.definition.participants?.characters.map(c=>c.name)??[]].filter(Boolean),s.definition.participants?.protagonist.name),simulatorProgress:deriveSimulatorProgress(claim.path),...(simulation?{simulatorState:replay?.state??replaySimulatorState(claim.path),...(runtime?{runtimeDeclaration:runtime}: {})}:{}),simulatorRules:{sourceName:simulatorPolicy.sourceName,reviewedChunks:simulatorPolicy.reviewedChunks,rules:simulatorPolicy.publicRules.map(r=>({id:`${r.sourceStart}:${r.sourceEnd}`,kind:r.kind,text:r.text,certainty:r.certainty})),instruction:(simulatorPolicy.referenceOnly?'本剧本采用原文叙事，没有启用附加状态机制；提供的是按预算选取的原文参考，不是完整执行配置，不能声称程序已执行未提供的规则。uninterpreted表示未经结构化整理的原文，依据上下文区分设定、计划与已发生事实；不要编造缺失资料。':simulation?'状态引擎已启用。':'普通故事模式，不输出stateChanges或强制数值模拟。')+(simulatorPolicy.referenceOnly?'这是当前世界的原文参考，不代表已审核的执行规则':'这是当前世界已审核的引用')+'，不是全知视角授权；规则与人物背景不是已发生事件。certainty=uncertain/planned仅作未证实信息/计划，不得当成事实或确定硬规则。存在相互冲突且无法确定的条件时，不擅自选一条；只有当前行动确实依赖该条件才用普通语言向玩家澄清，其余暂缓。'+(simulatorPolicy.referenceOnly?'仅参考本次提供的公开原文':'仅使用已校验的公开规则')+'；缺失资料不编造成既定事实；只有状态引擎启用时才输出stateChanges。'}}):claim.input;
 inputData=JSON.parse(simulatorInput);
  const {config}=await reconcileApiDefault();if(!config)throw new StoryGenerationError(makeStoryFailure(await db.apiConfigs.count()?'config-invalid':'config-missing','configuration',false));const credential=await db.apiCredentials.get(config.id);if(!credential?.apiKey||!usableApi(config,credential.apiKey))throw new StoryGenerationError(makeStoryFailure('config-invalid','configuration',false));
  credentialForRedaction=credential.apiKey;
  configuredOutputTokens=config.maxTokens;
  budgetConfig=config;const budget=storyOutputBudget(config,claim.length);outputTokenLimit=budget.limit;knownModelLimit=budget.modelLimit;
  inputData.outputBudget={maxTokens:outputTokenLimit,includes:simulation?['body','choices','segments','stateChanges']:['body','choices','segments']};simulatorInput=JSON.stringify(inputData);
  try{if(simulatorPolicy){simulatorInput=fitDocumentInput(inputData,effectivePrompt,storyLimits.inputBytes);inputData=JSON.parse(simulatorInput);}else if(new TextEncoder().encode(storyPrompt+simulatorInput).length>storyLimits.inputBytes)throw Error('budget');}catch{throw new StoryGenerationError(makeStoryFailure('budget','admission',false));}
  if(controller.signal.aborted)throw Error('cancelled');
  const initialInput=simulatorInput;
  for(let attempt=0;attempt<2;attempt++){
  result=undefined;
  structured=storyJSONTransport(config,simulation?simulatorSchema:schema,async()=>{
   const admitted=await db.transaction('r',storyTables(),async()=>{
    const current=await db.storySessions.get(s.id),world=await db.worlds.get(worldId);
    return !controller.signal.aborted&&current?.pending?.token===token&&current.pending.expiresAt>Date.now()&&current.revision===s.revision&&current.headNodeId===s.headNodeId&&world?.script?.playMode==='story'&&JSON.stringify(await resolveStoryDefinition(world))===claim.worldSnapshot&&JSON.stringify(world.storyDocument??world.simulatorSource??null)===claim.documentSnapshot&&JSON.stringify(world.storyPreferences?.guidance??null)===claim.guidanceSnapshot&&(!claim.replacement||JSON.stringify(await db.storyNodes.get(claim.replacement.id))===JSON.stringify(claim.replacement));
   });
   if(!admitted)failure='stale';else requestAttempts++;return admitted;
  },true);


  const input=simulatorInput;if(new TextEncoder().encode(effectivePrompt+input).length>storyLimits.inputBytes)throw new StoryGenerationError(makeStoryFailure('budget','admission',false));
  const messages:ContextMessage[]=[{role:'system',content:effectivePrompt},{role:'user',content:input}];
  if(requestDebugEnabled())registerRequestDiagnostics('story',messages,[{source:'story-instruction',text:storyPrompt,role:'system'},{source:'story-input',text:input,role:'user'}]);
  phase='request';const raw=await requestReply({...config,maxTokens:outputTokenLimit},credential.apiKey,messages,controller.signal,structured.transport,false);
  failure='invalid';phase='parse';if(structured.getResponseInfo().transportInterrupted)throw new StoryGenerationError(makeStoryFailure('network','response',true));if(structured.getResponseInfo().blocked)throw new StoryResponseError('blocked');const participants=s.definition.participants;try{result=parseStoryReply(raw,participants?[participants.protagonist.name,...participants.characters.map(c=>c.name)]:[],simulation,runtime?.fields);}catch(error){if(structured.isTruncated())throw new StoryResponseError('truncated',{responseCharacters:raw.length});throw error;}
  phase='validation';
  if(result.stateChanges){if(runtime)runtimeTurn(replay!.state,result.stateChanges,runtime,new Set(replay!.fired));else applySimulatorChanges(replaySimulatorState(claim.path),result.stateChanges);}
  const violations=checkStoryDirectives(result.body,result.segments,directives,s.definition.participants?.characters.map(c=>c.name));
  if(!violations.length)break;
  if(attempt===1||structured.isTruncated())throw new StoryGenerationError(makeStoryFailure(violations[0].code,'validation',true));
  // Same action, immutable history and lease; no rejected candidate in history.
  simulatorInput=JSON.stringify({...JSON.parse(initialInput),directiveCorrection:{attempt:1,violations,instruction:'上一候选尚未提交。本请求仍是同一回合、同一玩家行动；只按原始资料和有效指令重新输出完整JSON，修正列出的明确不符。不增加玩家行动，不将候选当成历史；正文、四选项、segments与状态变化均须重新一致。'}});
  if(new TextEncoder().encode(effectivePrompt+simulatorInput).length>storyLimits.inputBytes)throw new StoryGenerationError(makeStoryFailure('directive-budget','admission',true));
  inputData=JSON.parse(simulatorInput);
  }
 }
  if(!result)throw new StoryGenerationError(makeStoryFailure('validation-failed','validation',requestAttempts>0));
  const remaining=checkStoryDirectives(result.body,result.segments,directives,s.definition.participants?.characters.map(c=>c.name));
  if(remaining.length)throw new StoryGenerationError(makeStoryFailure(remaining[0].code,'validation',requestAttempts>0));
  phase='validation';const simulatorChanges=result.stateChanges;
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
  discardStoryResult(worldId);try{record('complete',node.body);}catch{/* Diagnostics must never turn a committed node into an apparent failure. */}
  return node;
 }catch(error){
  const info=structured?.getResponseInfo(),details=describeReplyFailure(error);
  let code:StoryFailureCode='unknown',stage:StoryFailureStage=phase;
  const issue=controller.signal.aborted?undefined:error instanceof StoryResponseError?error:phase==='request'&&structured?.isTruncated()?new StoryResponseError('truncated'):info?.blocked?new StoryResponseError('blocked'):info?.invalidEnvelope?new StoryResponseError('envelope-invalid'):info?.invalidContent?new StoryResponseError('envelope-shape'):info?.textCharacters===0&&info.httpStatus===200&&!info.serviceError?new StoryResponseError('empty-response'):info?.textCharacters!==undefined&&info.textCharacters>storyLimits.outputChars?new StoryResponseError('response-too-long'):undefined;
  if(controller.signal.aborted){failure='cancelled';code=timedOut?'timeout':'cancelled';}
  else if(error instanceof StoryGenerationError){code=error.failure.code;stage=error.failure.stage;}
  else if(info?.contextWindow){failure='request';code='context-window';stage='response';}
  else if(info?.outputRejected){failure='request';code='output-limit';stage='response';if(budgetConfig&&info.modelOutputLimit)rememberStoryOutputLimit(budgetConfig,info.modelOutputLimit);}
  else if(info?.transportInterrupted){failure='request';code='network';stage='response';}
  else if(info?.serviceCode&&['invalid_api_key','permission_denied','insufficient_quota','insufficient_balance','credit_balance_too_low','billing_hard_limit_reached','rate_limit_exceeded','content_policy_violation','content_filter','safety','prohibited_content'].includes(info.serviceCode)){failure='request';stage='response';code=['invalid_api_key','permission_denied'].includes(info.serviceCode)?'auth':['content_policy_violation','content_filter','safety','prohibited_content'].includes(info.serviceCode)?'blocked':info.serviceCode==='rate_limit_exceeded'?'rate':'quota';}
  else if(issue){failure='invalid';recordStoryResponseFailure(issue,outputTokenLimit);code=issue.code==='segments-invalid'?'validation-failed':issue.code;stage=code.startsWith('json-')?'parse':['blocked','truncated','empty-response','envelope-invalid','envelope-shape','response-too-long'].includes(code)?'response':'validation';}
  else if(error instanceof Error&&error.message==='budget'){failure='budget';code='budget';stage='admission';}
  else if(error instanceof Error&&error.message==='stale'||failure==='stale'&&phase==='request'){failure='stale';code='stale';}
  else if(phase==='commit'){failure='request';code='storage-failed';}
  else if(phase==='validation'){failure='invalid';code='validation-failed';}
  else if(phase==='request'&&!info?.attempted){code='admission-failed';stage='admission';}
  else if(phase==='request'){
   stage=info?.httpStatus!==undefined?'response':'request';
   code=info?.httpStatus===401?'auth':info?.httpStatus!==undefined?(info.httpStatus>=500?'server':'http-error'):details.kind==='network'?'network':'unknown';
  }
  let measuredBody:string|undefined;try{const x=JSON.parse(structured?.getPartialText()??'');if(typeof x?.body==='string'&&x.body.length<=storyLimits.body)measuredBody=x.body;}catch{/* Incomplete JSON has no safely measurable body. */}
  if(code==='storage-failed'&&result){try{recoveryKey??=await storyResultKey(claim);retainStoryResult(worldId,recoveryKey,result,token);}catch{discardStoryResult(worldId,token);}}else discardStoryResult(worldId,token);
  try{record('failed',measuredBody);}catch{/* Best-effort, numeric diagnostics only. */}
  const diagnostic=makeStoryFailure(code,stage,requestAttempts>0,{httpStatus:info?.httpStatus??details.httpStatus,serviceCode:info?.serviceCode??details.serviceCode,finishReason:info?.finishReason,responseCharacters:info?.textCharacters??issue?.detail.responseCharacters,choiceCount:issue?.detail.choiceCount,outputTokenLimit,modelOutputLimit:info?.modelOutputLimit??knownModelLimit});
  await db.transaction('rw',db.storySessions,async()=>{const current=await db.storySessions.get(s.id);if(current?.pending?.token===token){const text=structured?.getPartialText().split(credentialForRedaction).join('[凭据已隐藏]');const interruptedOutput=text&&code!=='stale'&&current.revision===s.revision&&current.headNodeId===s.headNodeId&&(structured?.isTruncated()||info?.transportInterrupted)?{text,reason:(structured?.isTruncated()?'truncated':'transport') as 'truncated'|'transport',baseRevision:current.revision,createdAt:Date.now()}:current.interruptedOutput;await db.storySessions.put({...current,interruptedOutput,status:'failed',pending:undefined,error:failure,failureDetails:diagnostic,updatedAt:Date.now()});}}).catch(()=>{});
  throw new StoryGenerationError(diagnostic);
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
