import {activeMessages} from './messagePath';
import {db} from './store';
import {wechatCloudFunctionRequest,wechatCloudAccessToken} from './wechatCloudIdentity';
import {readWechatCloudConfig} from './wechatCloudConfig';

async function cloudOwnerId(){
 const token=await wechatCloudAccessToken();
 const payload=token.split('.')[1];
 if(!payload)throw Error('云端身份无效，已停止聊天归档');
 try{
  const decoded=JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/'))) as {sub?:string};
  if(typeof decoded.sub!=='string'||!/^[0-9a-f-]{36}$/i.test(decoded.sub))throw Error();
  return new URL(readWechatCloudConfig()!.url).host+':'+decoded.sub;
 }catch{throw Error('云端身份无效，已停止聊天归档');}
}


/** Upload the current effective Daily timeline in bounded, restartable batches.
 * Automatic on existing QQ context sync; cloud restore/deletion reconciliation is separate.
 * A failed batch leaves the local source intact and can be safely retried.
 */
export async function uploadQqChatArchive(bindingId:string,conversationId:string,onProgress?:(done:number,total:number)=>void){
 const conversation=await db.conversations.get(conversationId);
 if(!conversation||conversation.mode!=='daily'||conversation.worldId)throw Error('仅支持日常聊天云端归档');
 const timelineId=conversation.activeTimelineId||'legacy';
 const epoch=conversation.timelineEpoch??0;
 const path=await activeMessages(conversationId,undefined,true);
 const messages=path.filter(m=>m.role==='user'||m.role==='assistant').map(m=>({
  id:m.id,role:m.role,content:m.content,createdAt:m.createdAt
 }));
 // The acknowledged content signature is scoped to the project, verified owner,
 // binding, conversation and timeline; never reuse another account's cursor.
 const identity=await cloudOwnerId();
 const key='claudia-chat-archive-v1:'+identity+':'+bindingId+':'+conversationId+':'+timelineId;
 // Index-only cursors are unsafe: edits, deletions and timeline rewrites shift
 // message positions. Hash the complete effective path and only skip when it
 // exactly matches a previously acknowledged upload.
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(messages))));
 const signature=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
 const existingSignature=localStorage.getItem(key);
 if(existingSignature===signature)return {uploaded:0,total:messages.length,timelineId};
 const chunksKey=key+':chunks';
 const idsKey=key+':ids';
 const currentIds=new Set(messages.map(m=>m.id));
 let previousIds:string[]=[];
 try{const stored=JSON.parse(localStorage.getItem(idsKey)||'[]');if(Array.isArray(stored)&&stored.every(x=>typeof x==='string'))previousIds=stored;}catch{}
 let previous:Record<string,string>={};
 try{const value=JSON.parse(localStorage.getItem(chunksKey)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))previous=value;}catch{}
 const next:Record<string,string>={};
 let done=0;
 for(let offset=0;offset<messages.length;){
  const fresh=await db.conversations.get(conversationId);
  if(!fresh||fresh.activeTimelineId!==conversation.activeTimelineId||(fresh.timelineEpoch??0)!==epoch)
   throw Error('聊天时间线已变化，已停止旧时间线的云端上传');
  const batch=[] as typeof messages;
  let bytes=0;
  while(offset+batch.length<messages.length&&batch.length<50){
   const item=messages[offset+batch.length];
   const size=new TextEncoder().encode(JSON.stringify(item)).length;
   if(item.content.length>24000||size>450000)throw Error('单条聊天消息超出云端归档容量，未跳过该消息');
   if(batch.length&&bytes+size>450000)break;
   bytes+=size;batch.push(item);
  }
  const batchDigest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(batch))));
  const batchHash=Array.from(batchDigest,b=>b.toString(16).padStart(2,'0')).join('');
  const chunkKey=String(offset);
  if(previous[chunkKey]===batchHash){
   next[chunkKey]=batchHash;
   offset+=batch.length;done=offset;onProgress?.(done,messages.length);
   continue;
  }
  const response=await wechatCloudFunctionRequest('claudia-chat-archive',{
   action:'upsert',bindingId,conversationId,timelineId,messages:batch
  },true);
  const data=await response.json().catch(()=>null) as {ok?:boolean;error?:string}|null;
  if(!response.ok||data?.ok!==true)throw Error('云端聊天归档失败：'+(data?.error||response.status));
  next[chunkKey]=batchHash;
  localStorage.setItem(chunksKey,JSON.stringify({...previous,...next}));
  offset+=batch.length;
  done=offset;
  onProgress?.(done,messages.length);
 }
 // Only publish the checkpoint if the same timeline and epoch still exist.
 const latest=await db.conversations.get(conversationId);
 if(!latest||latest.activeTimelineId!==conversation.activeTimelineId||(latest.timelineEpoch??0)!==epoch)
  throw Error('聊天时间线已变化，未确认云端归档完成');
 // Tombstone only IDs that this same owner and timeline previously uploaded.
 // Never infer another user's history or delete unrelated timelines.
 const removed=previousIds.filter(id=>!currentIds.has(id));
 for(let i=0;i<removed.length;i+=100){
  const response=await wechatCloudFunctionRequest('claudia-chat-archive',{
   action:'tombstone',bindingId,conversationId,timelineId,messageIds:removed.slice(i,i+100)
  },true);
  const result=await response.json().catch(()=>null) as {ok?:boolean;error?:string}|null;
  if(!response.ok||result?.ok!==true)throw Error('云端历史删除同步失败：'+(result?.error||response.status));
 }
 const final=await db.conversations.get(conversationId);
 if(!final||final.activeTimelineId!==conversation.activeTimelineId||(final.timelineEpoch??0)!==epoch)
  throw Error('聊天时间线发生变化，等待下一轮同步');
 const finalPath=(await activeMessages(conversationId,undefined,true))
  .filter(m=>m.role==='user'||m.role==='assistant')
  .map(m=>({id:m.id,role:m.role,content:m.content,createdAt:m.createdAt}));
 const finalDigest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(finalPath))));
 const finalSignature=Array.from(finalDigest,b=>b.toString(16).padStart(2,'0')).join('');
 if(finalSignature!==signature)throw Error('上传期间聊天内容发生变化，等待下一轮同步');
 localStorage.setItem(idsKey,JSON.stringify([...currentIds]));
 localStorage.setItem(chunksKey,JSON.stringify(next));
 localStorage.setItem(key,signature);
 return {uploaded:done,total:messages.length,timelineId};
}
