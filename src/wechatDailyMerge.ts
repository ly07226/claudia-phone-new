/** Conservative WeChat -> existing DAILY timeline merge.
 * Never create a second conversation; never touch world/story scope.
 * This function intentionally fails closed when the local timeline moved.
 * Caller must not advance its remote cursor unless this transaction commits.
 */
import {db} from './store';
import {activeMessages} from './messagePath';
import {timelineTables,ensureTimelineInTransaction,commitTimelineProjection} from './timelines';
import type {WechatSyncPage,WechatSyncedMessage} from './wechatSyncClient';
import type {Message,MessageVariant} from './chatTypes';

const messageId=(id:string)=>'wechat:'+id;
const variantId=(id:string)=>'wechat-variant:'+id;
function eligible(row:WechatSyncedMessage):boolean {
 // Unknown means delivery was attempted but the provider receipt was inconclusive.\n // Mirror the generated reply locally without claiming it was delivered to WeChat.\n // Do not mirror unsent/generated/failed replies or retry an unknown delivery.\n return row.direction==='inbound'||row.direction==='outbound'&&['sent','unknown'].includes(row.status);
}
export async function mergeWechatDailyPage(
 page:WechatSyncPage,
 expected:{conversationId:string;characterId:string;timelineId?:string;epoch:number;afterSeq?:number}
):Promise<{added:number;skipped:number;nextSeq:number;hasMore:boolean}>{
 if(page.binding.conversationId!==expected.conversationId||
    page.binding.characterId!==expected.characterId||
    page.binding.status!=='connected')
   throw Error('微信绑定已变化，请重新确认日常角色。');
 const seen=new Set<string>();
 let lastSeq=0;
 for(const row of page.messages){
  if(!row||!row.id||seen.has(row.id)||typeof row.body!=='string'||
     !['inbound','outbound'].includes(row.direction)||
     !Number.isSafeInteger(row.sync_seq)||row.sync_seq<=lastSeq)
   throw Error('微信同步消息无效。');
  seen.add(row.id);
  lastSeq=row.sync_seq;
 }
 return db.transaction('rw',timelineTables(),async()=>{
  const c=await db.conversations.get(expected.conversationId);
  if(!c||c.mode!=='daily'||c.worldId||c.characterId!==expected.characterId)
    throw Error('微信只能写入匹配的日常会话。');
  if(c.activeTimelineId!==expected.timelineId||(c.timelineEpoch??0)!==expected.epoch)
    throw Error('聊天时间线已切换，请重新同步。');
  if(c.sendingToken&&c.sendingUntil&&c.sendingUntil>Date.now())
    throw Error('角色正在回复，暂不合并微信消息。');
  await ensureTimelineInTransaction(c.id);
  const stored=c.wechatSync;
  if(stored&&stored.bindingId!==page.binding.id)
    throw Error('微信绑定已改变，禁止复用旧同步游标。');
  const cursor=stored?.nextSeq??0;
  if(expected.afterSeq!==undefined&&cursor!==expected.afterSeq)
    throw Error('微信同步游标已被其他窗口更新，请重新拉取。');
  if(page.nextSeq<cursor||(page.messages.length&&page.messages[0].sync_seq<=cursor))
    throw Error('微信同步页面与本地游标不匹配。');
  const existing=await activeMessages(c.id);
  const activeIds=new Set(existing.map(m=>m.id));
  const additions:Message[]=[];
  const variants:MessageVariant[]=[];
  let skipped=0;
  let nextSeq=cursor;
  for(const row of page.messages){
   // Pending outbound replies block the cursor; an attempted, unconfirmed\n   // delivery is mirrored locally, without treating it as a send receipt.
   if(!eligible(row))break;
   nextSeq=row.sync_seq;
   const id=messageId(row.id);
   if(activeIds.has(id)){skipped++;continue;}
   // If a previous sync inserted this message on a now-inactive branch,
   // never silently resurrect it onto a new branch.
   if(await db.messages.get(id))throw Error('微信消息属于另一条时间线，需人工处理冲突。');
   if(row.local_message_id&&await db.messages.get(row.local_message_id)){
    skipped++;continue;
   }
   const timestamp=Date.parse(row.received_at);
   if(!Number.isFinite(timestamp)||!row.body.trim())throw Error('微信消息时间或内容无效。');
   const m:Message={id,conversationId:c.id,role:row.direction==='inbound'?'user':'assistant',
     content:row.body,createdAt:timestamp};
   if(m.role==='assistant'){
    m.activeVariantId=variantId(row.id);
    variants.push({id:m.activeVariantId,conversationId:c.id,messageId:id,
      content:m.content,source:'generated',createdAt:timestamp});
   }
   additions.push(m);
   activeIds.add(id);
  }
  if(!additions.length){
   await db.conversations.update(c.id,{wechatSync:{bindingId:page.binding.id,nextSeq}});
   return {added:0,skipped,nextSeq,hasMore:page.hasMore||nextSeq<page.nextSeq};
  }
  // Do not reorder an existing local timeline based on delayed remote timestamps.
  // New remote messages append in server commit sequence.
  await db.messages.bulkAdd(additions);
  if(variants.length)await db.messageVariants.bulkAdd(variants);
  await commitTimelineProjection(c.id,'append');
  await db.conversations.update(c.id,{updatedAt:Date.now(),wechatSync:{bindingId:page.binding.id,nextSeq}});
  return {added:additions.length,skipped,nextSeq,hasMore:page.hasMore||nextSeq<page.nextSeq};
 });
}
