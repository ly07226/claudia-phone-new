/** Explicit, opt-in WeChat message paging. This helper does not mutate Dexie.
 * Call only for an authorized daily binding, then apply through a separately
 * reviewed timeline-aware merge (not ordinary chatService.sendMessage).
 */
import {cloudFunctionRequest} from './cloudIdentity';
export interface WechatSyncedMessage {
 id:string;sync_seq:number;change_seq?:number;external_message_id:string;direction:'inbound'|'outbound';
 body:string;status:string;local_message_id:string|null;received_at:string;in_reply_to:string|null;
}
export interface WechatSyncPage {
 ok:true;mode:'incremental';cursorType:'commit_ordered';
 binding:{id:string;conversationId:string;characterId:string;status:string};
 messages:WechatSyncedMessage[];nextSeq:number;hasMore:boolean;
}
export async function fetchWechatSyncPage(bindingId:string,afterSeq=0):Promise<WechatSyncPage>{
 if(!/^[0-9a-f-]{36}$/i.test(bindingId)||!Number.isSafeInteger(afterSeq)||afterSeq<0)
   throw Error('微信同步游标无效。');
 const response=await cloudFunctionRequest('claudia-wechat-sync','POST',{bindingId,afterSeq});
 const value:unknown=await response.json();
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('微信同步数据格式无效。');
 const page=value as Partial<WechatSyncPage>;
 if(page.ok!==true||page.mode!=='incremental'||page.cursorType!=='commit_ordered'||
   !page.binding||page.binding.id!==bindingId||!Array.isArray(page.messages)||
   typeof page.nextSeq!=='number'||!Number.isSafeInteger(page.nextSeq)||
   page.nextSeq<afterSeq||typeof page.hasMore!=='boolean')throw Error('微信同步数据不完整。');
 let previous=afterSeq;
 for(const message of page.messages){
   if(!message||typeof message.id!=='string'||typeof message.sync_seq!=='number'||
     !Number.isSafeInteger(message.sync_seq)||message.sync_seq<=previous||
     typeof message.body!=='string'||!['inbound','outbound'].includes(message.direction))
     throw Error('微信消息顺序或内容无效。');
   previous=message.sync_seq;
 }
 if(page.messages.length&&page.nextSeq!==previous||page.hasMore&&!page.messages.length)
   throw Error('微信同步游标不一致。');
 return page as WechatSyncPage;
}
export async function collectWechatSyncPages(
 bindingId:string,afterSeq:number,onPage:(page:WechatSyncPage)=>Promise<void>,
 maxPages=100
):Promise<{nextSeq:number;hasMore:boolean}>{
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw Error('同步批次数无效。');
 let cursor=afterSeq;
 for(let i=0;i<maxPages;i++){
   const page=await fetchWechatSyncPage(bindingId,cursor);
   // The caller MUST persist message merge and cursor in one local transaction.
   // Never advance the cursor when onPage throws.
   await onPage(page);
   cursor=page.nextSeq;
   if(!page.hasMore)return {nextSeq:cursor,hasMore:false};
 }
 return {nextSeq:cursor,hasMore:true};
}

/** Independent status-change stream. Do not use its cursor as the message cursor. */
export async function fetchWechatStatusPage(bindingId:string,afterSeq=0):Promise<WechatSyncPage>{
 if(!/^[0-9a-f-]{36}$/i.test(bindingId)||!Number.isSafeInteger(afterSeq)||afterSeq<0)
   throw Error('微信状态同步游标无效。');
 const response=await cloudFunctionRequest('claudia-wechat-sync','POST',{
  bindingId,afterSeq,mode:'changes'
 });
 const value:unknown=await response.json();
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw Error('微信状态数据格式无效。');
 const page=value as WechatSyncPage;
 if(page.ok!==true||(page.mode as string)!=='changes'||page.binding?.id!==bindingId||
  !Array.isArray(page.messages)||!Number.isSafeInteger(page.nextSeq)||
  page.nextSeq<afterSeq||typeof page.hasMore!=='boolean')
  throw Error('微信状态数据不完整。');
 let previous=afterSeq;
 for(const row of page.messages){
  if(!row||!Number.isSafeInteger(row.change_seq)||row.change_seq!<=previous)
   throw Error('微信状态变化顺序错误。');
  previous=row.change_seq!;
 }
 if(page.messages.length&&page.nextSeq!==previous||page.hasMore&&!page.messages.length)
  throw Error('微信状态游标不一致。');
 return page;
}
