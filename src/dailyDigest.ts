import {describeReplyFailure} from './replyFailure';
import {summaryRequestBudget} from './memorySummaryPlan';
import {memoryTokenCost} from './memoryContext';
import {enqueueAutomation} from './automationQueue';
import {requestAutomationReply,setAutomationPreflight,armAutomationTimeout} from './automationRequests';
import {sourceHash,messageSourceFingerprint,sourceVisibleMessage} from './summarySourceFingerprint';
import {memoryScopeKey} from './memoryScopeKey';
import {withSummaryLock} from './summaryLock';
import {getSummaryApi} from './dedicatedSummaryApi';
import {db} from './store';
import {getMemoryScope} from './memoryStore';
import {activeMessages} from './messagePath';
import {nodesForHead,timelineTables} from './timelines';
import {visibleMessage} from './messageBubbles';
import {requestReply} from './chatProvider';
import type {MemoryScope} from './memoryTypes';
export interface DailyDigestCheckpoint {scope:MemoryScope;startDay:string;endDay:string;sourceSignature:string;pieces:string[];completed:string[];merges?:Record<string,string>;updatedAt:number}
export interface DailyDigest {id:string;scope:MemoryScope;startDay:string;endDay:string;text:string;createdAt:number;sourceMessageIds?:string[];sourceFingerprint?:string}
async function digestReply(config:Parameters<typeof requestReply>[0],key:string,messages:Parameters<typeof requestReply>[2],guard?:()=>Promise<void>){
 const controller=new AbortController(),timer=armAutomationTimeout(controller,190000);let incomplete=false;if(guard)setAutomationPreflight(controller.signal,guard);
 try{const text=await requestAutomationReply({...config,maxTokens:summaryRequestBudget(config).output},key,messages,controller.signal,undefined,false,reason=>{incomplete=!!reason;});if(incomplete)throw Error('二级总结输出未完整结束，未提交结果');return text;}finally{timer();}
}
export function dayKey(date:Date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
function dayStart(day:string){return new Date(day+'T00:00:00').getTime();}
export async function saveDailyDigestSettings(scope:MemoryScope,enabled:boolean,days:1|2|3|7|14){if(typeof enabled!=='boolean'||![1,2,3,7,14].includes(days))throw Error('总结周期无效');await db.transaction('rw',[...timelineTables(),db.characters,db.worlds,db.worldProfiles],async()=>{const c=await db.conversations.get(scope.conversationId);if(!c||memoryScopeKey(await getMemoryScope(c.id))!==memoryScopeKey(scope))throw Error('记忆作用域已变化');await db.conversations.update(c.id,{dailyDigestSettings:{enabled,days}});});}
export async function digestSourceMatches(d:DailyDigest,messages:ReturnType<typeof visibleMessage>[]){
 if(!d.sourceMessageIds||!d.sourceFingerprint)return false;
 const source=messages.filter(m=>m.createdAt>=dayStart(d.startDay)&&m.createdAt<dayStart(d.endDay)&&(m.role==='user'||m.role==='assistant'));
 if(source.length!==d.sourceMessageIds.length||source.some((m,i)=>m.id!==d.sourceMessageIds![i]))return false;
 const hash=await messageSourceFingerprint(source);
 return hash===d.sourceFingerprint||'s3:'+hash===d.sourceFingerprint;
}
export async function dailyDigestStatus(scope:MemoryScope){
 const c=await db.conversations.get(scope.conversationId);
 const messages=c?(scope.mode==='world'?(await nodesForHead(c.id,(await db.timelines.get(scope.timelineId))?.headNodeId)).map(n=>sourceVisibleMessage(n.message)):(await activeMessages(c.id,undefined,true)).map(sourceVisibleMessage)):[];
 const digests:DailyDigest[]=[];
 for(const d of c?.dailyDigests??[])if(memoryScopeKey(d.scope)===memoryScopeKey(scope)&&await digestSourceMatches(d,messages))digests.push(d);
 return {settings:c?.dailyDigestSettings??{enabled:false,days:1 as const},digests,records:(c?.dailyDigests??[]).filter(d=>memoryScopeKey(d.scope)===memoryScopeKey(scope)).map(d=>({digest:d,status:digests.some(v=>v.id===d.id)?'verified' as const:!d.sourceFingerprint?'unverified' as const:'changed' as const})),attempt:c?.dailyDigestAttempt&&memoryScopeKey(c.dailyDigestAttempt.scope)===memoryScopeKey(scope)?c.dailyDigestAttempt:undefined};
}
const locks=new Set<string>();
async function runDailyDigestLocked(scope:MemoryScope,manual=false,admitted:()=>boolean=()=>true){
 const token=crypto.randomUUID();const lock=scope.conversationId;if(locks.has(lock))return;locks.add(lock);
 try{
  const c=await db.conversations.get(scope.conversationId);if(!c?.dailyDigestSettings?.enabled)return;
  if(memoryScopeKey(await getMemoryScope(c.id))!==memoryScopeKey(scope))throw Error('记忆作用域已变化');
  const days=c.dailyDigestSettings.days,now=new Date();
  const messages=scope.mode==='world'?(await nodesForHead(c.id,(await db.timelines.get(scope.timelineId))?.headNodeId)).map(n=>sourceVisibleMessage(n.message)): (await activeMessages(c.id,undefined,true)).map(sourceVisibleMessage);
  const first=messages.filter(m=>m.role==='user'||m.role==='assistant').reduce((min,m)=>Math.min(min,m.createdAt),Infinity);
  if(!Number.isFinite(first))return;
  const endAnchor=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const firstDate=new Date(first);
  const cursor=new Date(firstDate.getFullYear(),firstDate.getMonth(),firstDate.getDate());
  const ordinal=(d:Date)=>Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);
  if(days>1){cursor.setDate(cursor.getDate()-(ordinal(cursor)%days));endAnchor.setDate(endAnchor.getDate()-(ordinal(endAnchor)%days));}
  const status=await dailyDigestStatus(scope);
 const existing=manual?status.digests:status.records.map(r=>r.digest);
  let start='',end='';
  // Pick the oldest unsummarized completed calendar window, never skip a missed day.
  for(let i=0;i<5000&&cursor.getTime()<endAnchor.getTime();i++){
   const next=new Date(cursor);next.setDate(next.getDate()+days);
   const from=dayKey(cursor),to=dayKey(next);
   if(!existing.some(d=>d.startDay===from&&d.endDay===to&&memoryScopeKey(d.scope)===memoryScopeKey(scope))){start=from;end=to;break;}
   cursor.setDate(cursor.getDate()+days);
  }
  if(!start)return;
  const sourceMessages=messages.filter(m=>m.createdAt>=dayStart(start)&&m.createdAt<dayStart(end)&&(m.role==='user'||m.role==='assistant'));
  const sourceSnapshot=JSON.stringify(sourceMessages.map(m=>[m.id,m.role,m.createdAt,m.content,m.activeVariantId??null,(m.attachments??[]).map(a=>a.assetId)]));
  const sourceFingerprint='s3:'+await sourceHash(sourceSnapshot);
  const attempt=c.dailyDigestAttempt;
  if(!manual&&attempt?.status==='running'&&memoryScopeKey(attempt.scope)===memoryScopeKey(scope)){
   if(Date.now()-attempt.startedAt<30*60000)return;
   await db.conversations.update(c.id,{dailyDigestAttempt:{...attempt,status:'failed',startedAt:Date.now()}});return;
  }
  if(!manual&&attempt?.status==='failed'&&memoryScopeKey(attempt.scope)===memoryScopeKey(scope)&&attempt.startDay===start&&attempt.endDay===end&&Date.now()-attempt.startedAt<30*60000)return;
  if((c.dailyDigests?.length??0)>=5000)throw Error('二级总结达到容量保护上限，原记录保留；未调用 API。');
  const raw=sourceMessages.map(m=>`[${m.role==='user'?'用户':'角色'}] ${visibleMessage(m).content}`);
  if(!raw.length){
   await db.transaction('rw',[...timelineTables(),db.characters,db.worlds,db.worldProfiles],async()=>{const current=await db.conversations.get(c.id);if(!current?.dailyDigestSettings?.enabled||current.dailyDigestSettings.days!==days)return;if(memoryScopeKey(await getMemoryScope(c.id))!==memoryScopeKey(scope))throw Error('总结作用域已变化');
    const fresh=scope.mode==='world'?(await nodesForHead(c.id,(await db.timelines.get(scope.timelineId))?.headNodeId)).map(n=>sourceVisibleMessage(n.message)):(await activeMessages(c.id,undefined,true)).map(sourceVisibleMessage);
    const currentSource=fresh.filter(m=>m.createdAt>=dayStart(start)&&m.createdAt<dayStart(end)&&(m.role==='user'||m.role==='assistant'));
    if(currentSource.length||scope.mode==='world'&&current.activeTimelineId!==scope.timelineId)return;
    await db.conversations.update(c.id,{dailyDigests:[...(current.dailyDigests??[]),{id:crypto.randomUUID(),scope:structuredClone(scope),startDay:start,endDay:end,text:'',createdAt:Date.now(),sourceMessageIds:[],sourceFingerprint}]});});
   return;
  }
  if(!manual&&attempt?.status==='failed'&&(attempt.tries??1)>=2)return;
  const tries=manual?1:attempt&&attempt.startDay===start&&attempt.endDay===end?(attempt.tries??1)+1:1;
  const {config,key}=await getSummaryApi(scope);
  const inputLimit=Math.max(128,summaryRequestBudget(config).input-1024);
  // Split by Unicode code points: never discard any part of an oversized message.
  // Keep stable part labels so a resumed checkpoint matches exactly.
  const pieces:string[]=[];let chunk='';
  const flush=()=>{if(chunk){pieces.push(chunk);chunk='';}};
  for(let messageIndex=0;messageIndex<raw.length;messageIndex++){
   const chars=Array.from(raw[messageIndex]);
   for(let offset=0,part=0;offset<chars.length;part++){
    const label='[消息 '+(messageIndex+1)+' · 片段 '+(part+1)+'] ';
    let low=1,high=chars.length-offset;
    while(low<high){const mid=Math.ceil((low+high)/2);if(memoryTokenCost(label+chars.slice(offset,offset+mid).join('')+'\n')<=inputLimit)low=mid;else high=mid-1;}
    const capacity=low;
    const segment=label+chars.slice(offset,offset+capacity).join('')+'\n';
    offset+=capacity;
    if(memoryTokenCost(chunk+segment)>inputLimit)flush();
    chunk+=segment;
   }
  }
  flush();
  if(pieces.length>500)throw Error('该自然日超过500个片段的单次处理保护上限；已保留原文，请分日期处理');
  const bytes=new TextEncoder().encode(JSON.stringify([scope,start,end,sourceSnapshot,pieces]));
  const signature=await sourceHash(new TextDecoder().decode(bytes));
  await db.conversations.update(c.id,{dailyDigestAttempt:{token,scope:structuredClone(scope),startDay:start,endDay:end,tries,status:'running',startedAt:Date.now()}});
  const saved=(await db.conversations.get(c.id))?.dailyDigestCheckpoint;
  const resume=saved&&saved.startDay===start&&saved.endDay===end&&memoryScopeKey(saved.scope)===memoryScopeKey(scope)&&saved.sourceSignature===signature&&JSON.stringify(saved.pieces)===JSON.stringify(pieces);
  const completed=resume?saved.completed.slice():[];
  if(resume&&saved.sourceSignature!==signature)await db.conversations.update(c.id,{dailyDigestCheckpoint:{...saved,sourceSignature:signature,updatedAt:Date.now()}});
  if(!resume){
   const current=(await db.conversations.get(c.id))!;
   const archives=current.dailyDigestCheckpointArchive??[];
   if(saved?.completed.some(Boolean)&&archives.length>=3)throw Error('旧自然日检查点归档已达保护上限，原文和成功片段均保留，未调用 API');
   const update={dailyDigestCheckpointArchive:saved?.completed.some(Boolean)?[...archives,saved]:archives,dailyDigestCheckpoint:{scope:structuredClone(scope),startDay:start,endDay:end,sourceSignature:signature,pieces,completed:[],updatedAt:Date.now()}};
   if(memoryTokenCost(JSON.stringify({...current,...update}))>14*1024*1024)throw Error('自然日检查点达到容量保护，已有结果保留，未调用 API');
   await db.conversations.update(c.id,update);
  }
  const assertSource=async()=>{const current=await db.conversations.get(c.id);if(!current||current.dailyDigestAttempt?.token!==token||current.dailyDigestAttempt.status!=='running'||!current.dailyDigestSettings?.enabled||current.dailyDigestSettings.days!==days||current.characterId!==scope.characterId||current.mode!==scope.mode||current.worldId!==scope.worldId||(scope.mode==='world'&&(current.activeTimelineId!==scope.timelineId||(current.timelineEpoch??0)!==scope.epoch)))throw Error('总结任务或作用域已变化');const rows=scope.mode==='world'?(await nodesForHead(c.id,(await db.timelines.get(scope.timelineId))?.headNodeId)).map(n=>sourceVisibleMessage(n.message)):(await activeMessages(c.id,undefined,true)).map(sourceVisibleMessage);const source=rows.filter(m=>m.createdAt>=dayStart(start)&&m.createdAt<dayStart(end)&&(m.role==='user'||m.role==='assistant'));if(JSON.stringify(source.map(m=>[m.id,m.role,m.createdAt,m.content,m.activeVariantId??null,(m.attachments??[]).map(a=>a.assetId)]))!==sourceSnapshot)throw Error('总结原文已变化');};
  const beforeRequest=async()=>{if(!admitted())throw Error('自然日调度已停止，未发送请求');await assertSource()};
  const sourceTables=[...timelineTables(),db.characters,db.worlds,db.worldProfiles];
  const summaries:string[]=[];
  for(let index=0;index<pieces.length;index++){
   if(completed[index]){summaries.push(completed[index]);continue;}
   await db.transaction('r',sourceTables,assertSource);
   const piece=pieces[index];
   const result=await digestReply({...config,maxTokens:Math.max(1000,Math.min(config.maxTokens,2400))},key,[{role:'system',content:'你是剧情时间线总结器。只总结提供的聊天原文，区分已发生事实、角色猜测、未兑现承诺、关系变化、伏笔及最新状态。不得编造；按时间顺序，尽量精炼。'},{role:'user',content:piece}],beforeRequest);
   if(!result.trim())throw Error('二级总结返回空内容');
   summaries.push(result);completed[index]=result;
   await db.transaction('rw',sourceTables,async()=>{
    await assertSource();const current=await db.conversations.get(c.id),checkpoint=current?.dailyDigestCheckpoint;
    if(current?.dailyDigestAttempt?.token!==token||current.dailyDigestAttempt.status!=='running'||!checkpoint||checkpoint.sourceSignature!==signature||memoryScopeKey(checkpoint.scope)!==memoryScopeKey(scope))throw Error('总结原文已变化，暂停保存');
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
    await db.transaction('r',sourceTables,assertSource);
    const mergeId=await sourceHash(JSON.stringify(group));
    const cached=(await db.conversations.get(c.id))?.dailyDigestCheckpoint?.merges?.[mergeId];
    const merged=cached??await digestReply({...config,maxTokens:Math.max(1000,Math.min(config.maxTokens,3000))},key,[{role:'system',content:'将按时间顺序的剧情片段摘要合并，保留因果、人物关系变化、伏笔和未完成事项。不能虚构，也不能把猜测写成事实。'},{role:'user',content:group.join('\n\n')}],beforeRequest);
    if(!merged.trim())throw Error('二级总结合并结果为空');
    if(!cached)await db.transaction('rw',sourceTables,async()=>{await assertSource();const cp=(await db.conversations.get(c.id))?.dailyDigestCheckpoint;if(!cp||cp.sourceSignature!==signature)throw Error('二级总结检查点已变化');await db.conversations.update(c.id,{dailyDigestCheckpoint:{...cp,merges:{...cp.merges,[mergeId]:merged},updatedAt:Date.now()}})});
    next.push(merged);group=[];
   };
   for(const summary of layer){
    if(memoryTokenCost(summary)>inputLimit)throw Error('单片段摘要超出合并预算，保留检查点并暂停');
    if(group.length&&memoryTokenCost(group.join('\n\n')+'\n\n'+summary)>inputLimit)await flush();
    group.push(summary);
   }
   await flush();
   if(next.length>=layer.length)throw Error('摘要合并未能收敛，保留检查点并暂停');
   layer=next;
  }
  const text=layer[0]??'';
  const scopeNow=await getMemoryScope(c.id);if(memoryScopeKey(scopeNow)!==memoryScopeKey(scope))return;
  const latestConversation=await db.conversations.get(c.id);if(!latestConversation)return;
  const latestMessages=scope.mode==='world'?(await nodesForHead(c.id,(await db.timelines.get(scope.timelineId))?.headNodeId)).map(n=>sourceVisibleMessage(n.message)):(await activeMessages(c.id,undefined,true)).map(sourceVisibleMessage);
  const latestSource=latestMessages.filter(m=>m.createdAt>=dayStart(start)&&m.createdAt<dayStart(end)&&(m.role==='user'||m.role==='assistant'));
  if(JSON.stringify(latestSource.map(m=>[m.id,m.role,m.createdAt,m.content,m.activeVariantId??null,(m.attachments??[]).map(a=>a.assetId)]))!==sourceSnapshot)throw Error('总结期间历史原文已修改，已保留分片检查点，请重新检查');
  await db.transaction('rw',[...timelineTables(),db.characters,db.worlds,db.worldProfiles],async()=>{const current=await db.conversations.get(c.id);if(!current?.dailyDigestSettings?.enabled||current.dailyDigestSettings.days!==days)return;if(memoryScopeKey(await getMemoryScope(c.id))!==memoryScopeKey(scope))throw Error('总结作用域已变化');
   if(current.dailyDigestAttempt?.token!==token||current.dailyDigestAttempt.status!=='running')throw Error('总结任务已失效');
   const fresh=scope.mode==='world'?(await nodesForHead(c.id,(await db.timelines.get(scope.timelineId))?.headNodeId)).map(n=>sourceVisibleMessage(n.message)):(await activeMessages(c.id,undefined,true)).map(sourceVisibleMessage);
   const currentSource=fresh.filter(m=>m.createdAt>=dayStart(start)&&m.createdAt<dayStart(end)&&(m.role==='user'||m.role==='assistant'));
   if(JSON.stringify(currentSource.map(m=>[m.id,m.role,m.createdAt,m.content,m.activeVariantId??null,(m.attachments??[]).map(a=>a.assetId)]))!==sourceSnapshot)throw Error('二级总结保存时原文发生变化，未写入旧摘要');
   if(scope.mode==='world'&&current.activeTimelineId!==scope.timelineId)return;
   await db.conversations.update(c.id,{dailyDigests:[...(current.dailyDigests??[]),{id:crypto.randomUUID(),scope:structuredClone(scope),startDay:start,endDay:end,text,createdAt:Date.now(),sourceMessageIds:sourceMessages.map(m=>m.id),sourceFingerprint}],dailyDigestCheckpoint:undefined,dailyDigestAttempt:undefined});});
 }catch(error){const current=await db.conversations.get(scope.conversationId);const attempt=current?.dailyDigestAttempt;if(attempt?.token===token&&attempt.status==='running'&&memoryScopeKey(attempt.scope)===memoryScopeKey(scope))await db.conversations.update(scope.conversationId,{dailyDigestAttempt:{...attempt,status:'failed',error:describeReplyFailure(error).reason,startedAt:Date.now()}});throw error;}finally{locks.delete(lock);}
}

/** Cross-tab exclusive lock. If another tab owns the job, skip rather than duplicate a paid call. */
export async function runDailyDigest(scope:MemoryScope,options:{manual?:boolean;admitted?:()=>boolean}={}){
 const name='claudia-daily-digest:'+scope.conversationId;
 await withSummaryLock(name,async()=>{
  // Catch up missed completed calendar windows, without blocking normal chat.
  for(let i=0;i<(options.manual?7:1);i++){
   if(options.admitted?.()===false||typeof document!=='undefined'&&document.hidden)break;
   const before=(await dailyDigestStatus(scope)).digests.length;
   await runDailyDigestLocked(scope,!!options.manual,options.admitted);
   const after=(await dailyDigestStatus(scope)).digests.length;
   if(after<=before)break;
   if(!options.manual&&options.admitted?.()!==false)setTimeout(()=>{if(options.admitted?.()!==false)void enqueueAutomation('digest:'+scope.conversationId,()=>runDailyDigest(scope,options))},0);
  }
 });
}
