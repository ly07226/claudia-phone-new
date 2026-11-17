import {db,defaultTheme} from '../store';
import {getConversation} from '../chatService';
import {getCurrentTimeline} from '../timelines';
import {isDailyFriend} from '../chatRelationships';
import type {PhaseSettings} from './engine';
import {validPhaseChatRun,validPhaseChatSettings,defaultPhaseChatSettings,type PhaseChatSettings,type PhaseChatRun,type PhaseChatEvent} from './chatLinkTypes';
export * from './chatLinkTypes';
export async function savePhaseChatSettings(settings:PhaseChatSettings){if(!validPhaseChatSettings(settings))throw Error('联动设置无效');await db.transaction('rw',db.themes,async()=>{const current=await db.themes.get('global');await db.themes.put({...defaultTheme,...current,id:'global',phaseChatLink:settings});});}
/** Merge only the operated fields against the current persisted settings. */
export async function patchPhaseChatSettings(patch:Partial<PhaseChatSettings>){return db.transaction('rw',db.themes,async()=>{const current=await db.themes.get('global');const next={...(current?.phaseChatLink??defaultPhaseChatSettings()),...patch};if(!validPhaseChatSettings(next))throw Error('联动设置无效');await db.themes.put({...defaultTheme,...current,id:'global',phaseChatLink:next});return next;});}
export async function preparePhaseChatRun(settings:PhaseSettings):Promise<PhaseChatRun|undefined>{
 const link=(await db.themes.get('global'))?.phaseChatLink;if(!link?.enabled)return;
 if(!validPhaseChatSettings(link)||!link.characterId)return;
 const character=await db.characters.get(link.characterId);if(!character||!link.worldId&&!isDailyFriend(character))return;
 if(link.worldId&&(!await db.worlds.get(link.worldId)||!await db.worldProfiles.where('[worldId+characterId]').equals([link.worldId,link.characterId]).first()))return;
 const c=await getConversation(link.characterId,link.worldId);const timeline=await getCurrentTimeline(c.id);
 return {id:crypto.randomUUID(),target:{characterId:c.characterId,worldId:c.worldId,conversationId:c.id,timelineId:timeline.id,epoch:timeline.epoch},settings:structuredClone(link),mode:settings.sweetMode?'sweet':settings.commandMode?'dirty':'default',intensity:settings.intensity??'medium',minutes:settings.gameMinutes??10};
}
export function phaseChatEvent(run:PhaseChatRun,type:'start'|'finish'):PhaseChatEvent{return {id:run.id+':'+type,run,type};}
/** Claim before probability or API work. Restarts, duplicate renders and other tabs cannot rebill. */
export async function dispatchPhaseChatEvent(event:PhaseChatEvent,random=Math.random){
 if(!validPhaseChatRun(event.run)||event.id!==event.run.id+':'+event.type||!['start','finish'].includes(event.type))return 'skipped';
 const {run}=event;if(!run.settings.enabled||!(event.type==='start'?run.settings.onStart:run.settings.onFinish))return 'skipped';
 // The current master switch can stop pending finish events, never redirect them.
 if(!(await db.themes.get('global'))?.phaseChatLink?.enabled)return 'skipped';
 const claimed=await db.transaction('rw',db.conversations,async()=>{
  const c=await db.conversations.get(run.target.conversationId);if(!c||c.characterId!==run.target.characterId||c.worldId!==run.target.worldId)return false;
  const receipts=c.chatEventReceipts??[];if(receipts.some(r=>r.id===event.id))return false;if(receipts.length>=2000)throw Error('联动事件记录已达安全容量，未请求 API；游戏继续。');
  const hit=run.settings.probability===100||Math.max(0,Math.min(1,random()))*100<run.settings.probability;
  await db.conversations.update(c.id,{chatEventReceipts:[...receipts,{id:event.id,status:hit?'processing':'skipped',createdAt:Date.now()}]});return hit;
 });if(!claimed)return 'skipped';
 try{
  const {sendProactiveMessage}=await import('../proactiveMessages');
  const sent=await sendProactiveMessage(run.target.conversationId,false,event);
  if(!sent)throw Error('目标会话忙碌、已切换分支或当前不在前台；游戏继续，未自动重试。');
  return 'sent';
 }catch(error){
  const {describeReplyFailure}=await import('../replyFailure');const failure=describeReplyFailure(error);
  await db.transaction('rw',db.conversations,async()=>{const c=await db.conversations.get(run.target.conversationId);if(c)await db.conversations.update(c.id,{chatEventReceipts:(c.chatEventReceipts??[]).map(r=>r.id===event.id&&r.status==='processing'?{...r,status:'failed',reason:failure.reason}:r)});});
  const {retainGenerationFailure}=await import('../generationTasks');await retainGenerationFailure({id:event.id,conversationId:run.target.conversationId,characterId:run.target.characterId,worldId:run.target.worldId,timelineId:run.target.timelineId,epoch:run.target.epoch,startedAt:Date.now(),status:'failed',saved:false},error);
  throw Error(failure.reason);
 }
}
