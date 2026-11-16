/** Explicit, opt-in sync driver for an existing daily conversation.
 * No automatic background polling. Call only after the user has connected
 * a binding and the UI has confirmed the target daily conversation.
 */
import {db} from './store';
import {fetchWechatSyncPage} from './wechatSyncClient';
import {mergeWechatDailyPage} from './wechatDailyMerge';

export async function syncWechatDailyConversation(
 bindingId:string,conversationId:string,characterId:string,maxPages=20
):Promise<{added:number;nextSeq:number;hasMore:boolean}>{
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>100)
   throw Error('同步批次数无效。');
 let total=0;
 for(let i=0;i<maxPages;i++){
  const c=await db.conversations.get(conversationId);
  if(!c||c.mode!=='daily'||!!c.worldId||c.characterId!==characterId)
   throw Error('微信同步目标不是当前日常会话。');
  if(c.wechatSync&&c.wechatSync.bindingId!==bindingId)
   throw Error('微信绑定与本地记录不一致。');
  const cursor=c.wechatSync?.nextSeq??0;
  const page=await fetchWechatSyncPage(bindingId,cursor);
  const result=await mergeWechatDailyPage(page,{
   conversationId,characterId,timelineId:c.activeTimelineId,epoch:c.timelineEpoch??0,afterSeq:cursor
  });
  total+=result.added;
  if(!result.hasMore)return {added:total,nextSeq:result.nextSeq,hasMore:false};
  // A not-yet-sent outbound row blocks the cursor; avoid a busy loop.
  if(result.nextSeq===cursor)return {added:total,nextSeq:cursor,hasMore:true};
 }
 const c=await db.conversations.get(conversationId);
 return {added:total,nextSeq:c?.wechatSync?.nextSeq??0,hasMore:true};
}
