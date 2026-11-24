import {compareQqCursor} from '../supabase/functions/_shared/qqContext.mjs';
/** QQ -> existing daily timeline. Backfills once, then reads only messages newer than the committed checkpoint.
 * Never imports a failed or unsent AI reply; never alters a story/world timeline.
 */
import {db} from './store';
import {wechatCloudFunctionRequest} from './wechatCloudIdentity';
import {listQqCloudBindings,newestQqBinding} from './qqQrLogin';
import {activeMessages} from './messagePath';
import {timelineTables,ensureTimelineInTransaction,commitTimelineProjection} from './timelines';
import type {Message,MessageVariant} from './chatTypes';
type Row={id:string;direction:string;status:string;body:string;received_at:string;local_message_id:string|null;part_index?:number|null;in_reply_to?:string|null;reply_body?:string|null;reply_ready?:boolean;reply_part_ids?:string[]};
type Cursor={at:string;id:string;part?:number};
/** Stable-ID restore maps an existing binding back to the same Daily character. */
export async function resolveQqLocalConversation(binding:{character_id:string;conversation_id:string;stable_sync_id?:string|null}){
 const direct=await db.conversations.get(binding.conversation_id);
 if(direct)return direct.mode==='daily'&&!direct.worldId&&direct.characterId===binding.character_id?direct:undefined;
 const stable=localStorage.getItem('claudia-qq-stable-sync-id');
 if(!stable||stable!==binding.stable_sync_id)return undefined;
 return (await db.conversations.where('characterId').equals(binding.character_id).toArray()).find(c=>c.mode==='daily'&&!c.worldId);
}
const busy=new Set<string>();
export async function syncQqDailyConversation(conversationId:string,bindingId?:string,fullBackfill=false):Promise<number>{
 if(busy.has(conversationId))return 0;
 busy.add(conversationId);
 try{
  let added=0,resume:Cursor|undefined;
  // Bounded work per foreground pass; successful pages never need re-downloading.
  for(let page=0;page<20;page++){
   const result=await syncQqDailyPage(conversationId,bindingId,fullBackfill&&page===0,resume,page===0);
   added+=result.added;
   if(!result.more||!result.after)break;
   resume=result.after;
  }
  return added;
 }finally{busy.delete(conversationId);}
}
async function syncQqDailyPage(conversationId:string,bindingId?:string,fullBackfill=false,resume?:Cursor,recheckPending=true):Promise<{added:number;more:boolean;after?:Cursor}>{
  const conversation=await db.conversations.get(conversationId);
  if(!conversation||conversation.mode!=='daily'||conversation.worldId)throw Error('当前不是可同步的日常聊天');
  const bindings=await listQqCloudBindings();
  const stableId=localStorage.getItem('claudia-qq-stable-sync-id');
  const candidates=bindings.filter(b=>b.status==='connected'&&b.character_id===conversation.characterId);
  const selected=newestQqBinding(candidates);
  // Never import a stale binding just because it shares the same character.
  const binding=selected&&(!bindingId||selected.id===bindingId)&&
   (selected.conversation_id===conversationId||
    !!stableId&&selected.stable_sync_id===stableId)?selected:undefined;
  if(!binding)throw Error('QQ 绑定与当前聊天不匹配，请核对固定用户 ID 和角色');
  const checkpointKey='claudia-qq-sync-checkpoint:'+binding.id+':'+conversationId;
  const stored=localStorage.getItem(checkpointKey);
  let saved:{version?:number;at?:string;id?:string;part?:number;pendingIds?:string[];restoreId?:string}={};
  try{if(stored)saved=JSON.parse(stored);}catch{/* invalid metadata restarts recovery */}
  let restoreId='';try{const r=JSON.parse(localStorage.getItem('claudia.restore.rollback.v1')||'null');if(r?.targetName===db.name&&typeof r.name==='string')restoreId=r.name;}catch{/* no successful restore marker */}
  let resetCursor=!resume&&(fullBackfill||saved.version!==2||saved.restoreId!==restoreId||!Array.isArray(saved.pendingIds));
  let after:Cursor|undefined=resume;
  if(!resume&&!resetCursor&&typeof saved.at==='string'&&Number.isFinite(Date.parse(saved.at))&&typeof saved.id==='string'&&/^[0-9a-f-]{36}$/i.test(saved.id))after={at:saved.at,id:saved.id,part:saved.part};
  const knownPending=Array.isArray(saved.pendingIds)?saved.pendingIds.filter(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)):[];
  const requestedPending=recheckPending?knownPending:[];
  const read=()=>wechatCloudFunctionRequest('claudia-qq-sync',{bindingId:binding.id,order:'asc',syncVersion:2,pendingIds:requestedPending,...(after?{after}:{})},true);
  let response=await read();
  if(response.status===409&&after){
   const failure=await response.clone().json().catch(()=>({}));
   if(failure.error==='sync_cursor_missing'){resetCursor=true;after=undefined;response=await read();}
  }
  if(!response.ok){
   const failure=await response.json().catch(()=>({}));
   throw Error(`QQ 云端消息读取失败（HTTP ${response.status}，${failure.error==='sync_cursor_missing'?'同步游标来源缺失，可使用手动历史恢复':'sync_failed'}）`);
  }
  const page=await response.json() as {ok?:boolean;binding?:{conversationId:string;characterId:string;status:string};order?:string;pendingAware?:boolean;pendingMessages?:Row[];messages?:Row[];hasMore?:boolean;nextCursor?:Cursor|null};
  if(!page.ok||page.binding?.conversationId!==binding.conversation_id||page.binding?.characterId!==conversation.characterId||page.binding?.status!=='connected'||!Array.isArray(page.messages))throw Error('QQ 云端消息校验失败');
  if(page.order!=='asc'||page.pendingAware!==true||!Array.isArray(page.pendingMessages))throw Error('QQ 云端分页服务需要更新，未推进同步游标');
  const rows=[...new Map([...page.messages,...page.pendingMessages!].map(row=>[row.id,row])).values()].sort((a,b)=>compareQqCursor({at:a.received_at,id:a.id,part:a.part_index??0},{at:b.received_at,id:b.id,part:b.part_index??0}));
  if(page.hasMore&&(!page.messages.length||!page.nextCursor))throw Error('QQ 云端分页未前进，已停止重复读取');
  // Only acknowledged replies become local AI messages. Other ready rows may
  // pass an old pending delivery because its ID is independently rechecked.
  const ready=rows.filter(m=>m.direction==='inbound'||m.direction==='outbound'&&m.status==='sent');
  if(ready.some(m=>!m.id||typeof m.body!=='string'||!Number.isFinite(Date.parse(m.received_at))))
   throw Error('QQ 消息格式错误');
  const result=await db.transaction('rw',timelineTables(),async()=>{
   const c=await db.conversations.get(conversationId);
   if(!c||c.mode!=='daily'||c.worldId||c.characterId!==binding.character_id||
      c.activeTimelineId!==conversation.activeTimelineId||(c.timelineEpoch??0)!==(conversation.timelineEpoch??0))
     throw Error('QQ 回填期间聊天时间线已改变');
   if(c.sendingToken&&c.sendingUntil&&c.sendingUntil>Date.now())return {added:0,committed:false};
   // Empty/pending-only polls must not create a timeline or reset an open input/menu.
   if(!ready.length)return {added:0,committed:true};
   await ensureTimelineInTransaction(c.id);
   const existing=await activeMessages(c.id,undefined,true);
   const activeIds=new Set(existing.map(m=>m.id));
   const additions:Message[]=[];
   const variants:MessageVariant[]=[];
   for(const row of ready){
    let canonicalId='qq:'+row.id,body=row.body;
    if(row.direction==='outbound'&&row.in_reply_to&&row.reply_ready&&row.reply_body&&Array.isArray(row.reply_part_ids)){
     const groupId='qq:reply:'+row.in_reply_to;
     if(activeIds.has(groupId)||activeIds.has(groupId+':timeline:'+c.activeTimelineId))continue;
     // Never replace old individually imported bubbles, including player edits.
     // Newly generated replies are imported as the original complete message,
     // so all bubbles participate in a single summary turn just like local AI.
     if(!row.reply_part_ids.some(id=>activeIds.has('qq:'+id)||activeIds.has('qq:'+id+':timeline:'+c.activeTimelineId))){
      canonicalId=groupId;body=row.reply_body;
     }
    }
    // Only a message visible on this active timeline counts as already synced.
    // A canonical QQ row can exist on another timeline; never overwrite it.
    if(activeIds.has(canonicalId))continue;
    if(row.local_message_id&&activeIds.has(row.local_message_id)){
     const source=existing.find(m=>m.id===row.local_message_id);
     // An ID collision alone is not proof of an echo. Preserve distinct content/roles.
     if(source?.conversationId===c.id&&source.role===(row.direction==='inbound'?'user':'assistant')&&source.content===body)continue;
    }
    const canonical=await db.messages.get(canonicalId);
    const id=canonical
     ?canonicalId+':timeline:'+c.activeTimelineId
     :canonicalId;
    if(activeIds.has(id))continue;
    // An existing timeline copy may belong to an inactive path: do not
    // overwrite it or silently report it as visible.
    if(await db.messages.get(id))throw Error('QQ 消息在当前时间线的其他历史路径中，暂停回填以避免覆盖');
    if(!row.body.trim())continue;
    // Keep PostgreSQL microseconds and a stable sub-millisecond bubble order.
    // Local timeline projection sorts by createdAt/id; UUID order must not undo SQL part order.
    const fractional=(/\.(\d+)/.exec(row.received_at)?.[1]??'').padEnd(6,'0');
    const createdAt=Date.parse(row.received_at)+Number(fractional.slice(3,6))/1000+(row.part_index??0)/1000;
    const m:Message={id,conversationId:c.id,role:row.direction==='inbound'?'user':'assistant',content:body,createdAt};
    if(m.role==='assistant'){
     m.activeVariantId='qq-variant:'+id;
     variants.push({id:m.activeVariantId,conversationId:c.id,messageId:id,content:m.content,source:'generated',createdAt});
    }
    additions.push(m);activeIds.add(id);
   }
   if(!additions.length)return {added:0,committed:true};
   await db.messages.bulkAdd(additions);
   if(variants.length)await db.messageVariants.bulkAdd(variants);
   await commitTimelineProjection(c.id,'append');
   await db.conversations.update(c.id,{updatedAt:Date.now()});
   return {added:additions.length,committed:true};
  });
  if(!result.committed)return {added:0,more:false};
  let latest:typeof saved={};try{latest=JSON.parse(localStorage.getItem(checkpointKey)||'{}');}catch{/* retained below only if valid */}
  const pendingIds=new Set([...(Array.isArray(latest.pendingIds)?latest.pendingIds:[]),...knownPending]);
  for(const id of requestedPending)if(!page.pendingMessages!.some(m=>m.id===id))pendingIds.delete(id);
  for(const row of rows)if(row.direction==='outbound'&&row.status!=='sent'&&row.status!=='failed')pendingIds.add(row.id);else pendingIds.delete(row.id);
  if(pendingIds.size>1000)throw Error('QQ 待确认发送超过1000条，已保留消息与旧游标，请先检查QQ发送服务');
  let position=page.nextCursor??after;
  if(!resetCursor&&typeof latest.at==='string'&&Number.isFinite(Date.parse(latest.at))&&typeof latest.id==='string'&&(!position||compareQqCursor(latest as Cursor,position)>0))position={at:latest.at,id:latest.id,part:latest.part};
  if(resetCursor&&stored)localStorage.setItem(checkpointKey+':previous',stored);
  localStorage.setItem(checkpointKey,JSON.stringify({version:2,...position,pendingIds:[...pendingIds],restoreId}));
  localStorage.setItem('claudia-qq-pending-count:'+binding.id,String(pendingIds.size));
  return {added:result.added,more:page.hasMore===true,after:page.nextCursor??after};

}
