import {withSummaryLock} from './summaryLock';
import {getSummaryApi} from './dedicatedSummaryApi';
import {db} from './store';
import {getMemoryScope} from './memoryStore';
import {activeMessages} from './messagePath';
import {nodesForHead} from './timelines';
import {visibleMessage} from './messageBubbles';
import {requestReply} from './chatProvider';
import type {MemoryScope} from './memoryTypes';
export interface DailyDigestCheckpoint {scope:MemoryScope;startDay:string;endDay:string;sourceSignature:string;pieces:string[];completed:string[];updatedAt:number}
export interface DailyDigest {id:string;scope:MemoryScope;startDay:string;endDay:string;text:string;createdAt:number;sourceMessageIds?:string[];sourceFingerprint?:string}
export function dayKey(date:Date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
function dayStart(day:string){return new Date(day+'T00:00:00').getTime();}
export async function saveDailyDigestSettings(scope:MemoryScope,enabled:boolean,days:1|2|3|7|14){await db.transaction('rw',db.conversations,async()=>{const c=await db.conversations.get(scope.conversationId);if(!c)throw Error('会话不存在');await db.conversations.update(c.id,{dailyDigestSettings:{enabled,days}});});}
async function digestSourceMatches(d:DailyDigest,messages:ReturnType<typeof visibleMessage>[]){
 if(!d.sourceMessageIds||!d.sourceFingerprint)return false;
 const source=messages.filter(m=>m.createdAt>=dayStart(d.startDay)&&m.createdAt<dayStart(d.endDay)&&(m.role==='user'||m.role==='assistant'));
 if(source.length!==d.sourceMessageIds.length||source.some((m,i)=>m.id!==d.sourceMessageIds![i]))return false;
 const payload=JSON.stringify(source.map(m=>[m.id,m.role,m.createdAt,m.content]));
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
 return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('')===d.sourceFingerprint;
}
export async function dailyDigestStatus(scope:MemoryScope){
 const c=await db.conversations.get(scope.conversationId);
 const messages=c?(scope.mode==='world'?(await nodesForHead(c.id,(await db.timelines.get(scope.timelineId))?.headNodeId)).map(n=>visibleMessage(n.message)):(await activeMessages(c.id)).map(visibleMessage)):[];
 const digests:DailyDigest[]=[];
 for(const d of c?.dailyDigests??[])if(JSON.stringify(d.scope)===JSON.stringify(scope)&&await digestSourceMatches(d,messages))digests.push(d);
 return {settings:c?.dailyDigestSettings??{enabled:false,days:1 as const},digests};
}
const locks=new Set<string>();
async function runDailyDigestLocked(scope:MemoryScope){
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
  if(days>1){cursor.setDate(cursor.getDate()-(ordinal(cursor)%days));endAnchor.setDate(endAnchor.getDate()-(ordinal(endAnchor)%days));}
  const existing=(await dailyDigestStatus(scope)).digests;
  let start='',end='';
  // Pick the oldest unsummarized completed calendar window, never skip a missed day.
  for(let i=0;i<5000&&cursor.getTime()<endAnchor.getTime();i++){
   const next=new Date(cursor);next.setDate(next.getDate()+days);
   const from=dayKey(cursor),to=dayKey(next);
   if(!existing.some(d=>d.startDay===from&&d.endDay===to&&JSON.stringify(d.scope)===JSON.stringify(scope))){start=from;end=to;break;}
   cursor.setDate(cursor.getDate()+days);
  }
  if(!start)return;
  const sourceMessages=messages.filter(m=>m.createdAt>=dayStart(start)&&m.createdAt<dayStart(end)&&(m.role==='user'||m.role==='assistant'));
  const sourceSnapshot=JSON.stringify(sourceMessages.map(m=>[m.id,m.role,m.createdAt,m.content]));
  const sourceHash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sourceSnapshot));
  const sourceFingerprint=Array.from(new Uint8Array(sourceHash),v=>v.toString(16).padStart(2,'0')).join('');
  const raw=sourceMessages.map(m=>`[${m.role==='user'?'用户':'角色'}] ${m.content}`);
  if(!raw.length){
   await db.transaction('rw',db.conversations,async()=>{const current=await db.conversations.get(c.id);if(!current)return;await db.conversations.update(c.id,{dailyDigests:[...(current.dailyDigests??[]).filter(d=>!(d.startDay===start&&d.endDay===end&&JSON.stringify(d.scope)===JSON.stringify(scope))),{id:crypto.randomUUID(),scope:structuredClone(scope),startDay:start,endDay:end,text:'',createdAt:Date.now(),sourceMessageIds:[],sourceFingerprint}]});});
   return;
  }
  const {config,key}=await getSummaryApi(scope);
  // Split by Unicode code points: never discard any part of an oversized message.
  // Keep stable part labels so a resumed checkpoint matches exactly.
  const pieces:string[]=[];let chunk='';
  const flush=()=>{if(chunk){pieces.push(chunk);chunk='';}};
  for(let messageIndex=0;messageIndex<raw.length;messageIndex++){
   const chars=Array.from(raw[messageIndex]);
   for(let offset=0,part=0;offset<chars.length;part++){
    const label='[消息 '+(messageIndex+1)+' · 片段 '+(part+1)+'] ';
    const capacity=16000-label.length-2;
    const segment=label+chars.slice(offset,offset+capacity).join('')+'\n';
    offset+=capacity;
    if(chunk.length+segment.length>16000)flush();
    chunk+=segment;
   }
  }
  flush();
  if(pieces.length>500)throw Error('该自然日超过500个片段的单次处理保护上限；已保留原文，请分日期处理');
  const bytes=new TextEncoder().encode(JSON.stringify([scope,start,end,pieces]));
  const fingerprint=await crypto.subtle.digest('SHA-256',bytes);
  const signature=Array.from(new Uint8Array(fingerprint),v=>v.toString(16).padStart(2,'0')).join('');
  const saved=(await db.conversations.get(c.id))?.dailyDigestCheckpoint;
  const resume=saved&&saved.startDay===start&&saved.endDay===end&&JSON.stringify(saved.scope)===JSON.stringify(scope)&&(saved.sourceSignature===signature||(saved.sourceSignature.startsWith('[')&&saved.sourceSignature===JSON.stringify([scope,start,end,pieces])))&&JSON.stringify(saved.pieces)===JSON.stringify(pieces);
  const completed=resume?saved.completed.slice():[];
  if(resume&&saved.sourceSignature!==signature)await db.conversations.update(c.id,{dailyDigestCheckpoint:{...saved,sourceSignature:signature,updatedAt:Date.now()}});
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
  // Hierarchical reduction: no 80k hard-stop and no silent truncation.
  // Each merge request stays under its own input budget.
  let layer=summaries.slice(),depth=0;
  while(layer.length>1){
   if(++depth>20)throw Error('二级总结合并层级超过保护上限，已保留分片检查点');
   const next:string[]=[];let group:string[]=[];
   const flush=async()=>{
    if(!group.length)return;
    if(group.length===1){next.push(group[0]);group=[];return;}
    const merged=await requestReply({...config,maxTokens:Math.max(1000,Math.min(config.maxTokens,3000))},key,[{role:'system',content:'将按时间顺序的剧情片段摘要合并，保留因果、人物关系变化、伏笔和未完成事项。不能虚构，也不能把猜测写成事实。'},{role:'user',content:group.join('\n\n')}],new AbortController().signal);
    if(!merged.trim())throw Error('二级总结合并结果为空');
    next.push(merged);group=[];
   };
   for(const summary of layer){
    if(summary.length>30000)throw Error('单片段摘要超出合并预算，保留检查点并暂停');
    if(group.length&&group.join('\n\n').length+summary.length+2>30000)await flush();
    group.push(summary);
   }
   await flush();
   if(next.length>=layer.length)throw Error('摘要合并未能收敛，保留检查点并暂停');
   layer=next;
  }
  const text=layer[0]??'';
  const scopeNow=await getMemoryScope(c.id);if(JSON.stringify(scopeNow)!==JSON.stringify(scope))return;
  const latestConversation=await db.conversations.get(c.id);if(!latestConversation)return;
  const latestMessages=scope.mode==='world'?(await nodesForHead(c.id,(await db.timelines.get(scope.timelineId))?.headNodeId)).map(n=>visibleMessage(n.message)):(await activeMessages(c.id)).map(visibleMessage);
  const latestSource=latestMessages.filter(m=>m.createdAt>=dayStart(start)&&m.createdAt<dayStart(end)&&(m.role==='user'||m.role==='assistant'));
  if(JSON.stringify(latestSource.map(m=>[m.id,m.role,m.createdAt,m.content]))!==sourceSnapshot)throw Error('总结期间历史原文已修改，已保留分片检查点，请重新检查');
  await db.transaction('rw',db.conversations,async()=>{const current=await db.conversations.get(c.id);if(!current?.dailyDigestSettings?.enabled||current.dailyDigestSettings.days!==days)return;await db.conversations.update(c.id,{dailyDigests:[...(current.dailyDigests??[]).filter(d=>!(d.startDay===start&&d.endDay===end&&JSON.stringify(d.scope)===JSON.stringify(scope))),{id:crypto.randomUUID(),scope:structuredClone(scope),startDay:start,endDay:end,text,createdAt:Date.now(),sourceMessageIds:sourceMessages.map(m=>m.id),sourceFingerprint}],dailyDigestCheckpoint:undefined});});
 }finally{locks.delete(lock);}
}

/** Cross-tab exclusive lock. If another tab owns the job, skip rather than duplicate a paid call. */
export async function runDailyDigest(scope:MemoryScope){
 const name='claudia-daily-digest:'+scope.conversationId;
 await withSummaryLock(name,async()=>{
  // Catch up missed completed calendar windows, without blocking normal chat.
  for(let i=0;i<7;i++){
   if(typeof document!=='undefined'&&document.hidden)break;
   const before=(await dailyDigestStatus(scope)).digests.length;
   await runDailyDigestLocked(scope);
   const after=(await dailyDigestStatus(scope)).digests.length;
   if(after<=before)break;
  }
 });
}
