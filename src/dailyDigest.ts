import {getSummaryApi} from './dedicatedSummaryApi';
import {db} from './store';
import {getMemoryScope} from './memoryStore';
import {activeMessages} from './messagePath';
import {nodesForHead} from './timelines';
import {visibleMessage} from './messageBubbles';
import {requestReply} from './chatProvider';
import type {MemoryScope} from './memoryTypes';
export interface DailyDigestCheckpoint {scope:MemoryScope;startDay:string;endDay:string;sourceSignature:string;pieces:string[];completed:string[];updatedAt:number}
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
  const days=c.dailyDigestSettings.days,now=new Date();
  const messages=scope.mode==='world'?(await nodesForHead(c.id,(await db.timelines.get(scope.timelineId))?.headNodeId)).map(n=>visibleMessage(n.message)): (await activeMessages(c.id)).map(visibleMessage);
  const first=messages.filter(m=>m.role==='user'||m.role==='assistant').reduce((min,m)=>Math.min(min,m.createdAt),Infinity);
  if(!Number.isFinite(first))return;
  const endAnchor=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const firstDate=new Date(first);
  const cursor=new Date(firstDate.getFullYear(),firstDate.getMonth(),firstDate.getDate());
  const ordinal=(d:Date)=>Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);
  if(days===2){cursor.setDate(cursor.getDate()-(ordinal(cursor)%2));endAnchor.setDate(endAnchor.getDate()-(ordinal(endAnchor)%2));}
  const existing=c.dailyDigests??[];
  let start='',end='';
  // Pick the oldest unsummarized completed calendar window, never skip a missed day.
  for(let i=0;i<5000&&cursor.getTime()<endAnchor.getTime();i++){
   const next=new Date(cursor);next.setDate(next.getDate()+days);
   const from=dayKey(cursor),to=dayKey(next);
   if(!existing.some(d=>d.startDay===from&&d.endDay===to&&JSON.stringify(d.scope)===JSON.stringify(scope))){start=from;end=to;break;}
   cursor.setDate(cursor.getDate()+days);
  }
  if(!start)return;
  const raw=messages.filter(m=>m.createdAt>=dayStart(start)&&m.createdAt<dayStart(end)&&(m.role==='user'||m.role==='assistant')).map(m=>`[${m.role==='user'?'用户':'角色'}] ${m.content}`);
  if(!raw.length)return;
  const {config,key}=await getSummaryApi(scope);
const pieces:string[]=[];let chunk='';
  for(const line of raw){if(line.length>20000)throw Error('单条消息过长，已暂停二级总结，未截断原文');if(chunk.length+line.length>16000&&chunk){pieces.push(chunk);chunk='';}chunk+=line+'\n';}if(chunk)pieces.push(chunk);
  if(pieces.length>40)throw Error('日期原文过长，超过单次总结安全上限，未读取不完整内容');
  const signature=JSON.stringify([scope,start,end,pieces]);
  const saved=(await db.conversations.get(c.id))?.dailyDigestCheckpoint;
  const resume=saved&&saved.startDay===start&&saved.endDay===end&&JSON.stringify(saved.scope)===JSON.stringify(scope)&&saved.sourceSignature===signature&&JSON.stringify(saved.pieces)===JSON.stringify(pieces);
  const completed=resume?saved.completed.slice():[];
  if(!resume)await db.conversations.update(c.id,{dailyDigestCheckpoint:{scope:structuredClone(scope),startDay:start,endDay:end,sourceSignature:signature,pieces,completed:[],updatedAt:Date.now()}});
  const summaries:string[]=[];
  for(let index=0;index<pieces.length;index++){
   if(completed[index]){summaries.push(completed[index]);continue;}
   const piece=pieces[index];
   const result=await requestReply({...config,maxTokens:Math.max(1000,Math.min(config.maxTokens,2400))},key,[{role:'system',content:'你是剧情时间线总结器。只总结提供的聊天原文，区分已发生事实、角色猜测、未兑现承诺、关系变化、伏笔及最新状态。不得编造；按时间顺序，尽量精炼。'},{role:'user',content:piece}],new AbortController().signal);
   if(!result.trim())throw Error('二级总结返回空内容');
   summaries.push(result);completed[index]=result;
   await db.transaction('rw',db.conversations,async()=>{
    const current=await db.conversations.get(c.id),checkpoint=current?.dailyDigestCheckpoint;
    if(!checkpoint||checkpoint.sourceSignature!==signature||JSON.stringify(checkpoint.scope)!==JSON.stringify(scope))throw Error('总结原文已变化，暂停保存');
    await db.conversations.update(c.id,{dailyDigestCheckpoint:{...checkpoint,completed:completed.slice(),updatedAt:Date.now()}});
   });
  }
  let text=summaries.join('\n\n');
  if(summaries.length>1){if(text.length>80000)throw Error('合并输入超过预算，已暂停且没有截断原文');
   text=await requestReply({...config,maxTokens:Math.max(1000,Math.min(config.maxTokens,3000))},key,[{role:'system',content:'将这些分片剧情摘要合并为一份按时间顺序的自然日总结。保留因果、关系变化、伏笔和未完成事项；不能虚构。'},{role:'user',content:text}],new AbortController().signal);
  }
  const scopeNow=await getMemoryScope(c.id);if(JSON.stringify(scopeNow)!==JSON.stringify(scope))return;
  await db.transaction('rw',db.conversations,async()=>{const current=await db.conversations.get(c.id);if(!current?.dailyDigestSettings?.enabled||current.dailyDigestSettings.days!==days)return;if((current.dailyDigests??[]).some(d=>d.startDay===start&&d.endDay===end&&JSON.stringify(d.scope)===JSON.stringify(scope)))return;await db.conversations.update(c.id,{dailyDigests:[...(current.dailyDigests??[]),{id:crypto.randomUUID(),scope:structuredClone(scope),startDay:start,endDay:end,text,createdAt:Date.now()}],dailyDigestCheckpoint:undefined});});
 }finally{locks.delete(lock);}
}
