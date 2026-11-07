import {db} from './store';
import {reconcileApiDefault} from './apiSelection';
import {storyJSONTransport} from './storyJSON';
import {requestReply} from './chatProvider';
import {claimStory,resolveStoryDefinition,storyTables} from './storyStore';
import {validateStoryNode} from './storyValidation';
import {storyLimits,storyLengths,type StoryNode,type StoryAction,type StoryExpectedProgress} from './storyTypes';
import {storyPrompt} from './storyContext';
export {storyPrompt,storyInput} from './storyContext';
const schema={type:'OBJECT',properties:{body:{type:'STRING'},choices:{type:'ARRAY',items:{type:'OBJECT',properties:{id:{type:'STRING',enum:['A','B','C','D']},text:{type:'STRING'}},required:['id','text']}}},required:['body','choices']};
export function parseStoryReply(raw:string){
 if(raw.length>storyLimits.outputChars)throw Error('invalid');
 let value:any;try{value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'));}catch{throw Error('invalid');}
 const keys=(o:any,expected:string[])=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join()===expected.sort().join();
 if(!keys(value,['body','choices'])||typeof value.body!=='string'||!value.body.trim()||value.body.length>storyLimits.body||!Array.isArray(value.choices)||value.choices.length!==4)throw Error('invalid');
 value.choices.forEach((c:any,i:number)=>{if(!keys(c,['id','text'])||c.id!=='ABCD'[i]||typeof c.text!=='string'||!c.text.trim()||c.text.length>storyLimits.choice)throw Error('invalid');});
 if(new Set(value.choices.map((c:any)=>c.text.trim())).size!==4)throw Error('invalid');return value as {body:string;choices:{id:'A'|'B'|'C'|'D';text:string}[]};
}

export async function generateStory(worldId:string,actionInput?:string|StoryAction,options:{signal?:AbortSignal;allowOldDefinition?:boolean;expected?:StoryExpectedProgress;firstAttemptOnly?:boolean}={}){
 if(options.signal?.aborted)throw Error('生成已取消，原主线未改变。');
 const claim=await claimStory(worldId,actionInput,!!options.allowOldDefinition,options.expected,!!options.firstAttemptOnly),s=claim.session,token=s.pending!.token;
 const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 const timer=setTimeout(abort,storyLimits.leaseMs);let failure:'cancelled'|'request'|'invalid'|'stale'|'budget'='request';
 try{
  const input=claim.input;
  const {config}=await reconcileApiDefault();if(!config)throw Error('request');const credential=await db.apiCredentials.get(config.id);if(!credential?.apiKey)throw Error('request');
  if(controller.signal.aborted)throw Error('cancelled');
  const structured=storyJSONTransport(config,schema,async()=>{
   const admitted=await db.transaction('r',storyTables(),async()=>{
    const current=await db.storySessions.get(s.id),world=await db.worlds.get(worldId);
    return !controller.signal.aborted&&current?.pending?.token===token&&current.pending.expiresAt>Date.now()&&current.revision===s.revision&&current.headNodeId===s.headNodeId&&world?.script?.playMode==='story'&&JSON.stringify(await resolveStoryDefinition(world))===claim.worldSnapshot;
   });
   if(!admitted)failure='stale';return admitted;
  });
  const raw=await requestReply({...config,maxTokens:Math.min(config.maxTokens,storyLengths[claim.length].tokens,storyLimits.outputTokens)},credential.apiKey,[{role:'system',content:storyPrompt},{role:'user',content:input}],controller.signal,structured.transport,false);
  failure='invalid';if(structured.isTruncated())throw Error('invalid');const result=parseStoryReply(raw);const id=crypto.randomUUID();
  const node:StoryNode={id,worldId,sessionId:s.id,body:result.body,choices:result.choices.map(c=>({id:`${id}:${c.id}`,label:c.id,text:c.text})),...(s.headNodeId?{parentNodeId:s.headNodeId,action:claim.action,...(claim.action?.kind==='choice'?{fromChoiceId:claim.action.choiceId}:{})}:{}),narrativeLength:claim.length,requestId:token,createdAt:Date.now(),definitionRevision:s.definitionRevision,sequence:s.revision+1};validateStoryNode(node);
  failure='stale';let abortCommit=()=>{};const cancelCommit=()=>abortCommit();controller.signal.addEventListener('abort',cancelCommit,{once:true});
  try{await db.transaction('rw',storyTables(),async tx=>{
   abortCommit=()=>{try{tx.abort();}catch{/* Transaction already settled. */}};
   const current=await db.storySessions.get(s.id),world=await db.worlds.get(worldId);
   if(controller.signal.aborted||!current||current.pending?.token!==token||current.revision!==s.revision||current.headNodeId!==s.headNodeId||Date.now()>=s.pending!.expiresAt||!world||JSON.stringify(await resolveStoryDefinition(world))!==claim.worldSnapshot)throw Error('stale');
   await db.storyNodes.add(node);await db.storySessions.put({...current,headNodeId:node.id,revision:current.revision+1,status:'ready',pending:undefined,error:undefined,actionDraft:undefined,updatedAt:Date.now()});
  });}finally{controller.signal.removeEventListener('abort',cancelCommit);}
  return node;
 }catch(error){if(controller.signal.aborted)failure='cancelled';else if(error instanceof Error&&error.message==='budget')failure='budget';
  await db.transaction('rw',db.storySessions,async()=>{const current=await db.storySessions.get(s.id);if(current?.pending?.token===token)await db.storySessions.put({...current,status:'failed',pending:undefined,error:failure,updatedAt:Date.now()});}).catch(()=>{});
  throw Error(failure==='budget'?'世界设定或当前节点超过安全输入预算，未调用模型。':failure==='invalid'?'模型未返回有效正文及四个选项，原进度未改变。':failure==='stale'?'世界设定或主线进度已变化，过期结果未保存。':failure==='cancelled'?'生成已中断，原进度保留；不会自动重试。':'主线请求失败，请检查默认 API 配置和网络；原进度保留，手动重试可能再次计费。');
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
