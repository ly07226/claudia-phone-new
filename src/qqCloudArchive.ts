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
  const response=await wechatCloudFunctionRequest('claudia-chat-archive',{
   action:'upsert',bindingId,conversationId,timelineId,messages:batch
  },true);
  const data=await response.json().catch(()=>null) as {ok?:boolean;error?:string}|null;
  if(!response.ok||data?.ok!==true)throw Error('云端聊天归档失败：'+(data?.error||response.status));
  offset+=batch.length;
  done=offset;
  onProgress?.(done,messages.length);
 }
 // Only publish the checkpoint if the same timeline and epoch still exist.
 const latest=await db.conversations.get(conversationId);
 if(!latest||latest.activeTimelineId!==conversation.activeTimelineId||(latest.timelineEpoch??0)!==epoch)
  throw Error('聊天时间线已变化，未确认云端归档完成');
 localStorage.setItem(key,signature);
 return {uploaded:done,total:messages.length,timelineId};
}
