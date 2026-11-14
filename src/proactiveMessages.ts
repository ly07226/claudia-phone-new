import {db} from './store';
import {activeMessages} from './messagePath';
import {buildContext,contextLimits} from './chatContext';
import {resolveApi} from './chatService';
import {requestChatReply} from './chatProvider';
import {commitTimelineProjection,ensureTimelineInTransaction,timelineTables} from './timelines';
import {messageTables,addGeneratedVariant} from './messageOperations';
import type {Conversation} from './chatTypes';

export const proactiveEvent='claudia:proactive-message';
export const proactiveOpenEvent='claudia:open-proactive-chat';
export interface ProactiveNotice {conversationId:string;characterId:string;worldId?:string;name:string;avatar?:string;text:string}
const pending=new Set<string>();
let scanBusy=false;
const hour=3600000;
export function proactiveEligible(c:Conversation,latestUserAt:number,now:number){
 const s=c.chatSettings;
 if(c.mode!=='daily'||c.worldId||!s?.proactiveEnabled)return false;
 const interval=s.proactiveHours??3;
 if(!Number.isFinite(interval)||interval<0.5||interval>24)return false;
 const anchor=Math.max(c.createdAt,s.proactiveEnabledAt??c.createdAt,latestUserAt);
 return now-anchor>=interval*hour && s.proactiveAttemptFor!==anchor && !(c.sendingUntil&&c.sendingUntil>now);
}
/** A single attempt per inactivity period. Manual tests bypass the wait and probability, never the conversation guards. */
export async function sendProactiveMessage(id:string,force=false):Promise<boolean>{
 if(pending.has(id)||document.visibilityState!=='visible')return false;
 pending.add(id);
 let token='';
 try{
  const now=Date.now();
  const c=await db.conversations.get(id);
  if(!c||c.mode!=='daily'||c.worldId||!c.chatSettings?.proactiveEnabled)return false;
  const path=await activeMessages(id);
  const latestUserAt=[...path].reverse().find(m=>m.role==='user')?.createdAt??0;
  if(!force&&!proactiveEligible(c,latestUserAt,now))return false;
  const anchor=Math.max(c.createdAt,c.chatSettings.proactiveEnabledAt??c.createdAt,latestUserAt);
  const probability=c.chatSettings.proactiveProbability??50;
  token=crypto.randomUUID();
  const acquired=await db.transaction('rw',db.conversations,async()=>{
   const current=await db.conversations.get(id);
   if(!current?.chatSettings?.proactiveEnabled||current.mode!=='daily'||current.worldId||(current.sendingUntil??0)>Date.now())return false;
   if(!force&&current.chatSettings.proactiveAttemptFor===anchor)return false;
   await db.conversations.update(id,{sendingToken:token,sendingUntil:Date.now()+90000,chatSettings:{...current.chatSettings,proactiveAttemptFor:anchor}});
   return true;
  });
  if(!acquired)return false;
  if(!force&&Math.random()*100>=probability)return false;
  const locked=await db.conversations.get(id);
  if(!locked)return false;
  const {config,key}=await resolveApi(locked);
  const context=await buildContext(locked);
  const instruction='\n本次是角色主动发起聊天，而不是用户刚发送了新消息。用户已有一段时间没有主动联系你。请结合角色性格、当前关系和最近聊天，自然地发一条主动私信；不要固定套用责怪或撒娇话术，不要虚构用户刚才做了什么。仅输出角色要发送的消息。';
  if(context[0].content.length+instruction.length>contextLimits.systemChars)throw Error('角色设定过长，无法添加主动消息指令。');
  context[0]={...context[0],content:context[0].content+instruction};
  context.push({role:'user',content:'[系统触发：请主动向用户发送一条自然的私信。这不是用户发来的聊天消息。]'});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),60000);
  let text='';
  try{text=(await requestChatReply(config,key,context,controller.signal)).text.trim();}finally{clearTimeout(timer);}
  if(!text)throw Error('模型没有返回主动消息。');
  let saved=false;
  await db.transaction('rw',messageTables(),async()=>{
   const current=await db.conversations.get(id);
   if(!current||current.sendingToken!==token||current.activeTimelineId!==locked.activeTimelineId||(current.timelineEpoch??0)!==(locked.timelineEpoch??0))return;
   await ensureTimelineInTransaction(id);
   const rows=await activeMessages(id);
   if(rows.some(m=>m.role==='user'&&m.createdAt>latestUserAt))return;
   const last=rows.at(-1);
   const message={id:crypto.randomUUID(),conversationId:id,role:'assistant' as const,content:text,createdAt:Math.max(Date.now(),(last?.createdAt??0)+1)};
   await db.messages.add(message);
   await addGeneratedVariant(message,text,undefined);
   await commitTimelineProjection(id,'append');
   await db.conversations.update(id,{updatedAt:Date.now()});
   saved=true;
  });
  if(saved){
   const character=await db.characters.get(c.characterId);
   window.dispatchEvent(new CustomEvent<ProactiveNotice>(proactiveEvent,{detail:{conversationId:id,characterId:c.characterId,name:character?.name??'角色',avatar:character?.avatar,text}}));
  }
  return saved;
 }finally{
  if(token)await db.transaction('rw',db.conversations,async()=>{const c=await db.conversations.get(id);if(c?.sendingToken===token)await db.conversations.update(id,{sendingToken:undefined,sendingUntil:undefined});}).catch(()=>{});
  pending.delete(id);
 }
}
export async function scanProactiveMessages(){
 if(scanBusy||document.visibilityState!=='visible')return;
 scanBusy=true;
 try{
  const conversations=await db.conversations.toArray();
  for(const c of conversations){
   if(!c.chatSettings?.proactiveEnabled||c.mode!=='daily')continue;
   const path=await activeMessages(c.id);
   const latestUserAt=[...path].reverse().find(m=>m.role==='user')?.createdAt??0;
   if(proactiveEligible(c,latestUserAt,Date.now()))await sendProactiveMessage(c.id).catch(()=>{});
  }
 }finally{scanBusy=false;}
}
