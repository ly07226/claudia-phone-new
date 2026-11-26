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
 // A checkpoint is scoped to the exact project, owner token identity, binding,
 // conversation and timeline. Re-upload the last 50 to cover recent edits.
 // The checkpoint only advances after the server acknowledges the batch.
 const identity=await cloudOwnerId();
 const key='claudia-chat-archive-v1:'+identity+':'+bindingId+':'+conversationId+':'+timelineId;
 const checkpoint=Number(localStorage.getItem(key)||0);
 const start=Number.isSafeInteger(checkpoint)&&checkpoint>=0&&checkpoint<=messages.length?Math.max(0,checkpoint-50):0;
 let done=start;
 for(let offset=start;offset<messages.length;){
  const fresh=await db.conversations.get(conversationId);
  if(!fresh||fresh.activeTimelineId!==conversation.activeTimelineId||(fresh.timelineEpoch??0)!==epoch)
   throw Error('聊天时间线已变化，已停止旧时间线的云端上传');
  const batch=[] as typeof messages;
  let bytes=0;
  while(offset+batch.length<messages.length&&batch.length<50){
   const item=messages[offset+batch.length];
   const size=new TextEncoder().encode(JSON.stringify(item)).length;
   if(size>500000)throw Error('单条聊天消息超出云端归档容量，未跳过该消息');
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
  localStorage.setItem(key,String(done));
  onProgress?.(done,messages.length);
 }
 return {uploaded:done,total:messages.length,timelineId};
}
