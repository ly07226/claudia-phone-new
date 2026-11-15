import {db} from './store';
import {getMemoryScope} from './memoryStore';
import {activeMessages} from './messagePath';
import {nodesForHead} from './timelines';
import {visibleMessage} from './messageBubbles';
import {requestReply} from './chatProvider';
import type {MemoryScope} from './memoryTypes';
export interface DailyDigest {id:string;scope:MemoryScope;startDay:string;endDay:string;text:string;createdAt:number}
export function dayKey(date:Date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
function dayStart(day:string){return new Date(day+'T00:00:00').getTime();}
export async function saveDailyDigestSettings(scope:MemoryScope,enabled:boolean,days:1|2){await db.transaction('rw',db.conversations,async()=>{const c=await db.conversations.get(scope.conversationId);if(!c)throw Error('会话不存在');await db.conversations.update(c.id,{dailyDigestSettings:{enabled,days}});});}
export async function dailyDigestStatus(scope:MemoryScope){const c=await db.conversations.get(scope.conversationId);return {settings:c?.dailyDigestSettings??{enabled:false,days:1 as const},digests:(c?.dailyDigests??[]).filter(d=>JSON.stringify(d.scope)===JSON.stringify(scope))};}
const locks=new Set<string>();
export async function runDailyDigest(scope:MemoryScope){
 const lock=scope.conversationId;if(locks.has(lock))return;locks.add(lock);
 try{
  const c=await db.conversations.get(scope.conversationId);if(!c?.dailyDigestSettings?.enabled)return;
  const days=c.dailyDigestSettings.days,now=new Date(),today=dayKey(now);
  // Calendar boundaries: fixed local dates, never a rolling 24/48-hour timer.
  const anchor=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(days===2){const ordinal=Math.floor(Date.UTC(anchor.getFullYear(),anchor.getMonth(),anchor.getDate())/86400000);anchor.setDate(anchor.getDate()-(ordinal%2));}
  const end=dayKey(anchor);const startDate=new Date(anchor);startDate.setDate(startDate.getDate()-days);const start=dayKey(startDate);
  const latest=await db.conversations.get(scope.conversationId);if(latest?.dailyDigests?.some(d=>d.startDay===start&&d.endDay===end&&JSON.stringify(d.scope)===JSON.stringify(scope)))return;
  const messages=scope.mode==='world'?(await nodesForHead(c.id,(await db.timelines.get(scope.timelineId))?.headNodeId)).map(n=>visibleMessage(n.message)): (await activeMessages(c.id)).map(visibleMessage);
  const raw=messages.filter(m=>m.createdAt>=dayStart(start)&&m.createdAt<dayStart(end)&&(m.role==='user'||m.role==='assistant')).map(m=>`[${m.role==='user'?'用户':'角色'}] ${m.content}`);
  if(!raw.length)return;
  const selected=c.summaryApiConfigId;
  if(!selected)throw Error('请先在自动总结设置中选择独立总结 API');
  const config=await db.apiConfigs.get(selected),credential=await db.apiCredentials.get(selected);
  if(!config?.enabled||!credential?.apiKey)throw Error('总结专用 API 未启用或密钥缺失');
  const key=credential.apiKey;const pieces:string[]=[];let chunk='';
  for(const line of raw){if(line.length>20000)throw Error('单条消息过长，已暂停二级总结，未截断原文');if(chunk.length+line.length>16000&&chunk){pieces.push(chunk);chunk='';}chunk+=line+'\n';}if(chunk)pieces.push(chunk);
  if(pieces.length>40)throw Error('日期原文过长，超过单次总结安全上限，未读取不完整内容');
  const summaries:string[]=[];
  for(const piece of pieces){
   const result=await requestReply({...config,maxTokens:Math.max(1000,Math.min(config.maxTokens,2400))},key,[{role:'system',content:'你是剧情时间线总结器。只总结提供的聊天原文，区分已发生事实、角色猜测、未兑现承诺、关系变化、伏笔及最新状态。不得编造；按时间顺序，尽量精炼。'},{role:'user',content:piece}],new AbortController().signal);
   if(!result.trim())throw Error('二级总结返回空内容');summaries.push(result);
  }
  let text=summaries.join('\n\n');
  if(summaries.length>1){if(text.length>80000)throw Error('合并输入超过预算，已暂停且没有截断原文');
   text=await requestReply({...config,maxTokens:Math.max(1000,Math.min(config.maxTokens,3000))},key,[{role:'system',content:'将这些分片剧情摘要合并为一份按时间顺序的自然日总结。保留因果、关系变化、伏笔和未完成事项；不能虚构。'},{role:'user',content:text}],new AbortController().signal);
  }
  const scopeNow=await getMemoryScope(c.id);if(JSON.stringify(scopeNow)!==JSON.stringify(scope))return;
  await db.transaction('rw',db.conversations,async()=>{const current=await db.conversations.get(c.id);if(!current?.dailyDigestSettings?.enabled||current.dailyDigestSettings.days!==days)return;if((current.dailyDigests??[]).some(d=>d.startDay===start&&d.endDay===end&&JSON.stringify(d.scope)===JSON.stringify(scope)))return;await db.conversations.update(c.id,{dailyDigests:[...(current.dailyDigests??[]),{id:crypto.randomUUID(),scope:structuredClone(scope),startDay:start,endDay:end,text,createdAt:Date.now()}]});});
 }finally{locks.delete(lock);}
}
