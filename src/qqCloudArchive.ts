import {activeMessages} from './messagePath';
import {db} from './store';
import {wechatCloudFunctionRequest} from './wechatCloudIdentity';

/** Upload the current effective Daily timeline in bounded, restartable batches.
 * This is an explicit operation until cloud restore/deletion reconciliation ships.
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
  onProgress?.(done,messages.length);
 }
 return {uploaded:done,total:messages.length,timelineId};
}
