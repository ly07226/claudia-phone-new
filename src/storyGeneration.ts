import {parseStoryReply,StoryResponseError,recordStoryResponseFailure} from './storyResponse';
export {parseStoryReply,getStoryResponseDiagnostics} from './storyResponse';
import {db} from './store';
import {reconcileApiDefault} from './apiSelection';
import {storyJSONTransport} from './storyJSON';
import {requestReply} from './chatProvider';
import {claimStory,resolveStoryDefinition,storyTables} from './storyStore';
import {validateStoryNode} from './storyValidation';
import {storyLimits,storyLengths,type StoryNode,type StoryAction,type StoryExpectedProgress} from './storyTypes';
import {storyPrompt} from './storyContext';
export {storyPrompt,storyInput} from './storyContext';
const schema={type:'OBJECT',properties:{body:{type:'STRING'},choices:{type:'ARRAY',minItems:4,maxItems:4,items:{type:'OBJECT',properties:{id:{type:'STRING',enum:['A','B','C','D']},text:{type:'STRING'}},required:['id','text']}}},required:['body','choices']};

export async function generateStory(worldId:string,actionInput?:string|StoryAction,options:{signal?:AbortSignal;allowOldDefinition?:boolean;expected?:StoryExpectedProgress;firstAttemptOnly?:boolean}={}){
 if(options.signal?.aborted)throw Error('生成已取消，原主线未改变。');
 const claim=await claimStory(worldId,actionInput,!!options.allowOldDefinition,options.expected,!!options.firstAttemptOnly),s=claim.session,token=s.pending!.token;
 const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 const timer=setTimeout(abort,storyLimits.leaseMs);let failure:'cancelled'|'request'|'invalid'|'stale'|'budget'='request';
 let structured:ReturnType<typeof storyJSONTransport>|undefined,outputTokenLimit:number|undefined;
 try{
  const input=claim.input;
  const {config}=await reconcileApiDefault();if(!config)throw Error('request');const credential=await db.apiCredentials.get(config.id);if(!credential?.apiKey)throw Error('request');
  if(controller.signal.aborted)throw Error('cancelled');
  structured=storyJSONTransport(config,schema,async()=>{
   const admitted=await db.transaction('r',storyTables(),async()=>{
    const current=await db.storySessions.get(s.id),world=await db.worlds.get(worldId);
    return !controller.signal.aborted&&current?.pending?.token===token&&current.pending.expiresAt>Date.now()&&current.revision===s.revision&&current.headNodeId===s.headNodeId&&world?.script?.playMode==='story'&&JSON.stringify(await resolveStoryDefinition(world))===claim.worldSnapshot&&JSON.stringify(world.storyPreferences?.guidance??null)===claim.guidanceSnapshot;
   });
   if(!admitted)failure='stale';return admitted;
  });
  outputTokenLimit=Math.min(config.maxTokens,storyLengths[claim.length].tokens,storyLimits.outputTokens);
  const raw=await requestReply({...config,maxTokens:outputTokenLimit},credential.apiKey,[{role:'system',content:storyPrompt},{role:'user',content:input}],controller.signal,structured.transport,false);
  failure='invalid';if(structured.getResponseInfo().blocked)throw new StoryResponseError('blocked');if(structured.isTruncated())throw new StoryResponseError('truncated',{responseCharacters:raw.length});const result=parseStoryReply(raw);const id=crypto.randomUUID();
  const node:StoryNode={id,worldId,sessionId:s.id,body:result.body,choices:result.choices.map(c=>({id:`${id}:${c.id}`,label:c.id,text:c.text})),...(s.headNodeId?{parentNodeId:s.headNodeId,action:claim.action,...(claim.action?.kind==='choice'?{fromChoiceId:claim.action.choiceId}:{})}:{}),narrativeLength:claim.length,requestId:token,createdAt:Date.now(),definitionRevision:s.definitionRevision,sequence:s.revision+1};validateStoryNode(node);
  failure='stale';let abortCommit=()=>{};const cancelCommit=()=>abortCommit();controller.signal.addEventListener('abort',cancelCommit,{once:true});
  try{await db.transaction('rw',storyTables(),async tx=>{
   abortCommit=()=>{try{tx.abort();}catch{/* Transaction already settled. */}};
   const current=await db.storySessions.get(s.id),world=await db.worlds.get(worldId);
   if(controller.signal.aborted||!current||current.pending?.token!==token||current.revision!==s.revision||current.headNodeId!==s.headNodeId||Date.now()>=s.pending!.expiresAt||!world||JSON.stringify(await resolveStoryDefinition(world))!==claim.worldSnapshot||JSON.stringify(world.storyPreferences?.guidance??null)!==claim.guidanceSnapshot)throw Error('stale');
   if(claim.guidance?.enabled&&claim.guidance.mode==='once')await db.worlds.update(worldId,{storyPreferences:{...world.storyPreferences!,guidance:{...claim.guidance,enabled:false,revision:claim.guidance.revision+1}}});
   await db.storyNodes.add(node);await db.storySessions.put({...current,headNodeId:node.id,revision:current.revision+1,status:'ready',pending:undefined,error:undefined,actionDraft:undefined,updatedAt:Date.now()});
  });}finally{controller.signal.removeEventListener('abort',cancelCommit);}
  return node;
 }catch(error){
  if(!controller.signal.aborted){
   const info=structured?.getResponseInfo();
   const issue=error instanceof StoryResponseError?error:structured?.isTruncated()?new StoryResponseError('truncated'):info?.blocked?new StoryResponseError('blocked'):info?.invalidEnvelope?new StoryResponseError('envelope-invalid'):info?.textCharacters===0&&info.httpStatus===200&&!info.serviceError?new StoryResponseError('empty-response'):undefined;
   if(issue){failure='invalid';recordStoryResponseFailure(issue,outputTokenLimit);}
  }
  if(controller.signal.aborted)failure='cancelled';else if(error instanceof Error&&error.message==='budget')failure='budget';
  await db.transaction('rw',db.storySessions,async()=>{const current=await db.storySessions.get(s.id);if(current?.pending?.token===token)await db.storySessions.put({...current,status:'failed',pending:undefined,error:failure,updatedAt:Date.now()});}).catch(()=>{});
  throw Error(failure==='budget'?'世界设定或当前节点超过安全输入预算，未调用模型。':failure==='invalid'?'模型未返回有效正文及四个选项，原进度未改变。':failure==='stale'?'世界设定或主线进度已变化，过期结果未保存。':failure==='cancelled'?'生成已中断，原进度保留；不会自动重试。':'主线请求失败，请检查默认 API 配置和网络；原进度保留，手动重试可能再次计费。');
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
