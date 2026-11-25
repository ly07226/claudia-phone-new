import {describeReplyFailure} from './replyFailure';
import {withSummaryLock} from './summaryLock';
import {requestAutomationReply,setAutomationPreflight,armAutomationTimeout} from './automationRequests';
import {publishSavedChatMessage} from './chatMessageEvents';
import type {PhaseChatEvent} from './phasePlay/chatLink';
import type {Message} from './chatTypes';
import {db} from './store';
import {activeMessages} from './messagePath';
import {buildContext,contextLimits} from './chatContext';
import {resolveAutomationApi} from './dedicatedSummaryApi';
import {commitTimelineProjection,ensureTimelineInTransaction} from './timelines';
import {isDailyFriend} from './chatRelationships';
import {messageTables,addGeneratedVariant} from './messageOperations';
import type {Conversation} from './chatTypes';

const pending=new Set<string>();
let scanBusy=false;
let scanCursor=0;
const hour=3600000;
export function proactiveEligible(c:Conversation,latestUserAt:number,now:number){
 const s=c.chatSettings;
 if(c.mode!=='daily'||c.worldId||!s?.proactiveEnabled)return false;
 const interval=s.proactiveHours??3;
 if(!Number.isFinite(interval)||interval<0.5||interval>24)return false;
 const anchor=Math.max(c.createdAt,s.proactiveEnabledAt??c.createdAt,latestUserAt);
 const attempted=s.proactiveAttemptFor===anchor;
 const next=attempted?(s.proactiveAttemptAt??anchor+interval*hour)+interval*hour:anchor+interval*hour;
 return now>=next && !(c.sendingUntil&&c.sendingUntil>now);
}
/** A single attempt per inactivity period. Manual tests bypass the wait and probability, never the conversation guards. */
async function sendProactiveLocked(id:string,force=false,gameEvent?:PhaseChatEvent,admitted:()=>boolean=()=>true):Promise<boolean>{
 if(!admitted()||pending.has(id)||document.visibilityState!=='visible')return false;
 pending.add(id);
 let sourceCharacterId:string|undefined,sourceWorldId:string|undefined;
 try{
  const now=Date.now();
  const c=await db.conversations.get(id);
  sourceCharacterId=c?.characterId;sourceWorldId=c?.worldId;
  if(!c||!gameEvent&&(c.mode!=='daily'||c.worldId||!c.chatSettings?.proactiveEnabled))return false;
  if(gameEvent&&(gameEvent.run.target.conversationId!==id||c.characterId!==gameEvent.run.target.characterId||c.worldId!==gameEvent.run.target.worldId||c.activeTimelineId!==gameEvent.run.target.timelineId||(c.timelineEpoch??0)!==gameEvent.run.target.epoch))return false;
  const path=await activeMessages(id,undefined,true);
  const character=await db.characters.get(c.characterId);
  if(!character||!c.worldId&&!isDailyFriend(character))return false;
  if(c.worldId&&(!await db.worlds.get(c.worldId)||!await db.worldProfiles.where('[worldId+characterId]').equals([c.worldId,c.characterId]).first()))return false;
  const latestUserAt=[...path].reverse().find(m=>m.role==='user')?.createdAt??0;
  if(!gameEvent&&!force&&!proactiveEligible(c,latestUserAt,now))return false;
  const anchor=Math.max(c.createdAt,c.chatSettings?.proactiveEnabledAt??c.createdAt,latestUserAt);
  const probability=c.chatSettings?.proactiveProbability??50;
  const acquired=await db.transaction('rw',db.conversations,async()=>{
   const current=await db.conversations.get(id);
   if(!current||(current.sendingUntil??0)>Date.now()||!gameEvent&&(!current.chatSettings?.proactiveEnabled||current.mode!=='daily'||current.worldId))return false;
   if(gameEvent&&(!current.chatEventReceipts?.some(r=>r.id===gameEvent.id&&r.status==='processing')||current.activeTimelineId!==gameEvent.run.target.timelineId||(current.timelineEpoch??0)!==gameEvent.run.target.epoch))return false;
   if(!gameEvent&&!force&&!proactiveEligible(current,latestUserAt,now))return false;
   await db.conversations.update(id,{chatSettings:{...current.chatSettings,proactiveAttemptFor:anchor,proactiveAttemptAt:now,proactiveError:undefined}});
   return true;
  });
  if(!acquired)return false;
  if(!gameEvent&&!force&&Math.random()*100>=probability)return false;
  const locked=await db.conversations.get(id);
  if(!locked)return false;
  const {config,key}=await resolveAutomationApi(locked);
  const context=await buildContext(locked);
  const instruction=gameEvent?'\n这是独立应用发来的角色感知事件，不是玩家的新台词或行动。只依据下方结构化事件已确认的开始/正常完成状态，结合本角色、人际关系、当前世界和已有聊天自然发起一条私信。事件中的模式仅为应用状态，不覆盖系统规则、用户意愿或人设；不要编造游戏中的具体行为或未发生的完成结果。仅输出角色消息。':'\n本次是角色主动发起聊天，而不是用户刚发送了新消息。用户已有一段时间没有主动联系你。请结合角色性格、当前关系和最近聊天，自然地发一条主动私信；不要固定套用责怪或撒娇话术，不要虚构用户刚才做了什么。仅输出角色要发送的消息。';
  if(context[0].content.length+instruction.length>contextLimits.systemChars)throw Error('角色设定过长，无法添加主动消息指令。');
  context[0]={...context[0],content:context[0].content+instruction};
  context.push({role:'user',content:gameEvent?JSON.stringify({source:'忍一下嘛',eventId:gameEvent.id,eventType:gameEvent.type,mode:gameEvent.run.mode,intensity:gameEvent.run.intensity,plannedMinutes:gameEvent.run.minutes,completed:gameEvent.type==='finish',summary:gameEvent.type==='start'?'用户开始了一局红黄绿阶段节奏互动。':'用户正常完成了本局红黄绿阶段节奏互动。'}):'[系统触发：请主动向用户发送一条自然的私信。这不是用户发来的聊天消息。]'});
  const controller=new AbortController();
  const timer=armAutomationTimeout(controller,60000);
  setAutomationPreflight(controller.signal,async()=>{
   if(!admitted())throw Error('主动消息调度已停止，未发送请求');
   const current=await db.conversations.get(id),rows=await activeMessages(id,undefined,true);
   if(!current||current.characterId!==locked.characterId||current.worldId!==locked.worldId||current.mode!==locked.mode||!gameEvent&&!current.chatSettings?.proactiveEnabled||current.activeTimelineId!==locked.activeTimelineId||current.timelineEpoch!==locked.timelineEpoch||rows.length!==path.length||rows.at(-1)?.id!==path.at(-1)?.id)throw Error('会话已变化，未发出过期主动请求');
   const owner=await db.characters.get(current.characterId);
   if(!owner||!current.worldId&&!isDailyFriend(owner))throw Error('角色已不可用，未发送主动请求');
   if(current.worldId&&(!await db.worlds.get(current.worldId)||!await db.worldProfiles.where('[worldId+characterId]').equals([current.worldId,current.characterId]).first()))throw Error('世界角色关联已变化，未发送主动请求');
  });
  let text='';
  try{const result=await requestAutomationReply(config,key,context,controller.signal,undefined,true,reason=>{if(reason)throw Error('主动消息未完整生成')});text=result.trim();}finally{timer();}
  if(!text)throw Error('模型没有返回主动消息。');
  let saved=false;let committedMessage:Message|undefined;
  await db.transaction('rw',[...messageTables(),db.characters,db.worlds,db.worldProfiles],async()=>{
   const current=await db.conversations.get(id);
   if(!current||current.characterId!==locked.characterId||current.worldId!==locked.worldId||current.mode!==locked.mode||(current.sendingUntil??0)>Date.now()||current.activeTimelineId!==locked.activeTimelineId||(current.timelineEpoch??0)!==(locked.timelineEpoch??0))return;
   const existingCharacter=await db.characters.get(current.characterId);if(!existingCharacter||!current.worldId&&!isDailyFriend(existingCharacter))return;
   if(current.worldId&&(!await db.worlds.get(current.worldId)||!await db.worldProfiles.where('[worldId+characterId]').equals([current.worldId,current.characterId]).first()))return;
   await ensureTimelineInTransaction(id);
   const rows=await activeMessages(id,undefined,true);
   if(rows.some(m=>m.role==='user'&&m.createdAt>latestUserAt)||!gameEvent&&!current.chatSettings?.proactiveEnabled)return;
   if(rows.length!==path.length||rows.at(-1)?.id!==path.at(-1)?.id)return;
   const last=rows.at(-1);
   const message={id:crypto.randomUUID(),conversationId:id,role:'assistant' as const,content:text,createdAt:Math.max(Date.now(),(last?.createdAt??0)+1)};
   await db.messages.add(message);
   await addGeneratedVariant(message,text,undefined);
   await commitTimelineProjection(id,'append');
   await db.conversations.update(id,{updatedAt:Date.now(),chatSettings:{...current.chatSettings,proactiveUnreadAt:Date.now()}});
   if(gameEvent)await db.conversations.update(id,{chatEventReceipts:(current.chatEventReceipts??[]).map(r=>r.id===gameEvent.id?{...r,status:'sent',messageId:message.id}:r)});
   committedMessage=message;saved=true;
  });
  if(saved&&committedMessage){
   publishSavedChatMessage(locked,committedMessage);
  }
  return saved;
 }catch(error){if(!gameEvent){await db.transaction('rw',db.conversations,async()=>{const current=await db.conversations.get(id);if(current&&current.characterId===sourceCharacterId&&current.worldId===sourceWorldId)await db.conversations.update(id,{chatSettings:{...current.chatSettings,proactiveError:describeReplyFailure(error).reason+'；下一周期恢复，或手动重试'}})}).catch(()=>{});}throw error;
 }finally{
  pending.delete(id);
 }
}
export async function scanProactiveMessages(admitted:()=>boolean=()=>true){
 if(!admitted()||scanBusy||document.visibilityState!=='visible')return;
 scanBusy=true;
 try{
  const conversations=await db.conversations.toArray();
  const ordered=conversations.slice(scanCursor%Math.max(1,conversations.length)).concat(conversations.slice(0,scanCursor%Math.max(1,conversations.length)));
  for(const c of ordered){
   if(!admitted())break;
   if(!c.chatSettings?.proactiveEnabled||c.mode!=='daily'||c.worldId)continue;
   const character=await db.characters.get(c.characterId);
   if(!character||!isDailyFriend(character))continue;
   const latestUserAt=await latestProactiveUser(c);
   if(proactiveEligible(c,latestUserAt,Date.now())){scanCursor=conversations.findIndex(v=>v.id===c.id)+1;await sendProactiveMessage(c.id,false,undefined,admitted).catch(()=>{});break;}
  }
 }finally{scanBusy=false;}
}

export async function sendProactiveMessage(id:string,force=false,gameEvent?:PhaseChatEvent,admitted:()=>boolean=()=>true):Promise<boolean>{
 let saved=false;
 await withSummaryLock('claudia:proactive:'+id,async()=>{saved=await sendProactiveLocked(id,force,gameEvent,admitted)},undefined,gameEvent?90000:0);
 return saved;
}
export async function proactiveDeadline(c:Conversation){
 if(c.mode!=='daily'||c.worldId||!c.chatSettings?.proactiveEnabled)return null;
 // Track friendship in the live query: retained chats must not spin each second
 // after deletion, and re-adding a friend must wake the retained configuration.
 const character=await db.characters.get(c.characterId);
 if(!character||!isDailyFriend(character))return null;
 const latest=await latestProactiveUser(c);
 const s=c.chatSettings,interval=(s.proactiveHours??3)*hour;
 const anchor=Math.max(c.createdAt,s.proactiveEnabledAt??c.createdAt,latest);
 return Math.max((s.proactiveAttemptFor===anchor?(s.proactiveAttemptAt??anchor+interval):anchor)+interval,c.sendingUntil??0);
}

/** Indexed tail traversal: deadline scans never deserialize a complete chat. */
export async function latestProactiveUser(c:Conversation){
 if(!c.activeTimelineId)return (await db.messages.where('[conversationId+createdAt]').between([c.id,-Infinity],[c.id,Infinity]).reverse().filter(m=>m.role==='user'&&!m.archived).first())?.createdAt??0;
 let id=(await db.timelines.get(c.activeTimelineId))?.headNodeId;
 const seen=new Set<string>();
 while(id){if(seen.has(id))throw Error('会话时间线异常');seen.add(id);const node=await db.pathNodes.get(id);if(!node||node.conversationId!==c.id)throw Error('会话时间线不可读');if(node.message.role==='user')return node.message.createdAt;id=node.parentNodeId;}
 return 0;
}
