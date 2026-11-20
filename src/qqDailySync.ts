/** QQ -> existing daily timeline. Backfills once, then reads only messages newer than the committed checkpoint.
 * Never imports a failed or unsent AI reply; never alters a story/world timeline.
 */
import {db} from './store';
import {wechatCloudFunctionRequest} from './wechatCloudIdentity';
import {listQqCloudBindings,newestQqBinding} from './qqQrLogin';
import {activeMessages} from './messagePath';
import {timelineTables,ensureTimelineInTransaction,commitTimelineProjection} from './timelines';
import type {Message,MessageVariant} from './chatTypes';
type Row={id:string;direction:string;status:string;body:string;received_at:string;local_message_id:string|null};
const busy=new Set<string>();
export async function syncQqDailyConversation(conversationId:string,bindingId?:string):Promise<number>{
 if(busy.has(conversationId))return 0;
 busy.add(conversationId);
 try{
  const conversation=await db.conversations.get(conversationId);
  if(!conversation||conversation.mode!=='daily'||conversation.worldId)return 0;
  const bindings=await listQqCloudBindings();
  const stableId=localStorage.getItem('claudia-qq-stable-sync-id');
  const candidates=bindings.filter(b=>b.status==='connected'&&b.character_id===conversation.characterId);
  const selected=newestQqBinding(candidates);
  // Never import a stale binding just because it shares the same character.
  const binding=selected&&(!bindingId||selected.id===bindingId)&&
   (selected.conversation_id===conversationId||
    !!stableId&&selected.stable_sync_id===stableId)?selected:undefined;
  if(!binding)return 0;
  const checkpointKey='claudia-qq-sync-checkpoint:'+binding.id+':'+conversationId;
  const stored=localStorage.getItem(checkpointKey);
  let after:{at:string;id:string}|undefined;
  if(stored){try{const value=JSON.parse(stored);if(typeof value.at==='string'&&typeof value.id==='string')after=value;}catch{/* Restart full recovery on corrupt checkpoint. */}}
  const pages:Row[][]=[];
  let cursor:{at:string;id:string}|undefined;
  let completed=false;
  // Fetch older pages first, then commit all at once. Never partially import a
  // truncated history or advance an implicit cursor past pending sends.
  for(let n=0;n<30;n++){
   const response=await wechatCloudFunctionRequest('claudia-qq-sync',{bindingId:binding.id,...(after?{after}:{}),...(cursor?{cursor}:{})});
   if(!response.ok)throw Error('QQ 云端消息读取失败：'+response.status);
   const page=await response.json() as {ok?:boolean;binding?:{conversationId:string;characterId:string;status:string};messages?:Row[];hasMore?:boolean;nextCursor?:{at:string;id:string}|null};
   if(!page.ok||page.binding?.conversationId!==binding.conversation_id||page.binding?.characterId!==conversation.characterId||
      page.binding?.status!=='connected'||!Array.isArray(page.messages))throw Error('QQ 云端消息校验失败');
   pages.unshift(page.messages);
   if(!page.hasMore){completed=true;break;}
   if(!page.nextCursor||page.nextCursor.at===cursor?.at&&page.nextCursor.id===cursor?.id)
     throw Error('QQ 云端分页游标异常');
   cursor=page.nextCursor;
  }
  if(!completed)throw Error('QQ 历史超过本次安全同步容量，未修改本地记录');
  const rows=pages.flat();
  // Pending deliveries must not appear as sent. Terminal failures do not block
  // later independent turns; they are skipped, not silently treated as replies.
  const firstPending=rows.findIndex(m=>m.direction==='outbound'&&m.status!=='sent'&&m.status!=='failed');
  const ready=rows.slice(0,firstPending<0?rows.length:firstPending)
   .filter(m=>m.direction==='inbound'||m.direction==='outbound'&&m.status==='sent');
  if(ready.some(m=>!m.id||typeof m.body!=='string'||!Number.isFinite(Date.parse(m.received_at))))
   throw Error('QQ 消息格式错误');
  const added=await db.transaction('rw',timelineTables(),async()=>{
   const c=await db.conversations.get(conversationId);
   if(!c||c.mode!=='daily'||c.worldId||c.characterId!==binding.character_id||
      c.activeTimelineId!==conversation.activeTimelineId||(c.timelineEpoch??0)!==(conversation.timelineEpoch??0))
     throw Error('QQ 回填期间聊天时间线已改变');
   if(c.sendingToken&&c.sendingUntil&&c.sendingUntil>Date.now())return 0;
   await ensureTimelineInTransaction(c.id);
   const existing=await activeMessages(c.id);
   const activeIds=new Set(existing.map(m=>m.id));
   const additions:Message[]=[];
   const variants:MessageVariant[]=[];
   for(const row of ready){
    const id='qq:'+row.id;
    if(activeIds.has(id))continue;
    if(await db.messages.get(id))throw Error('QQ 消息已在其他聊天分支，暂停回填');
    if(row.local_message_id&&await db.messages.get(row.local_message_id))continue;
    if(!row.body.trim())continue;
    const createdAt=Date.parse(row.received_at);
    const m:Message={id,conversationId:c.id,role:row.direction==='inbound'?'user':'assistant',content:row.body,createdAt};
    if(m.role==='assistant'){
     m.activeVariantId='qq-variant:'+row.id;
     variants.push({id:m.activeVariantId,conversationId:c.id,messageId:id,content:m.content,source:'generated',createdAt});
    }
    additions.push(m);activeIds.add(id);
   }
   if(!additions.length)return 0;
   await db.messages.bulkAdd(additions);
   if(variants.length)await db.messageVariants.bulkAdd(variants);
   await commitTimelineProjection(c.id,'append');
   await db.conversations.update(c.id,{updatedAt:Date.now()});
   return additions.length;
  });
  // Do not advance past an unresolved outbound send: it may become sent later.
  // Failed rows are terminal and safe to skip. Checkpoint only after commit.
  const safe=firstPending<0?rows:rows.slice(0,firstPending);
  const newest=safe.at(-1);
  if(newest){
   const next={at:newest.received_at,id:newest.id};
   if(!after||Date.parse(next.at)>Date.parse(after.at)||next.at===after.at&&next.id>after.id)
    localStorage.setItem(checkpointKey,JSON.stringify(next));
  }
  return added;
 }finally{busy.delete(conversationId);}
}
