import {withSummaryLock} from './summaryLock';
import {getSummaryApi} from './dedicatedSummaryApi';
import {classifySummaryError} from './memorySummaryErrors';
import {activeMessages} from './messagePath';
import {db} from './store';
import {getMemoryScope,listMemories,listMemoryRevisions,createMemory,sealMemorySummaryForks,visibleSummaryReceipts} from './memoryStore';
import {timelineTables,ensureTimelineInTransaction,nodesForHead} from './timelines';
import {visibleMessage} from './messageBubbles';
import {selectSummaryCandidates,summaryDuplicateIndex} from './memorySummaryQuality';
import {requestSummary,requestChunkEvents,requestGroupDigest,SummaryResponseError} from './memorySummaryRequest';
import {parseSummary,summaryPrompt,SummaryFormatError} from './memorySummaryFormat';
export {parseSummary} from './memorySummaryFormat';
import {memoryTokenCost} from './memoryContext';
import {buildSummaryInputs} from './memorySummaryChunks';
import {summarySourceFingerprint} from './summarySourceFingerprint';
import type {MemoryScope} from './memoryTypes';
import {emptySummaryState,summaryLimits,type SummaryFact,type SummaryTurn,type SummaryFailure,type MemorySummaryJob,type SummaryDiagnostic} from './memorySummaryTypes';
const tables=()=>[...timelineTables(),db.characters,db.worlds,db.worldProfiles];
const key=(turn:SummaryTurn)=>JSON.stringify([turn.userIds,turn.assistantId]);
const scopeKey=(scope:MemoryScope)=>JSON.stringify(scope);
const labels={fact:'已发生事实',belief:'人物主观判断',speculation:'猜测（未证实）',pending:'未完成事项'};
const system=summaryPrompt;
export async function saveSummarySettings(scope:MemoryScope,enabled:boolean,interval:number){
 if(typeof enabled!=='boolean'||!Number.isInteger(interval)||interval<20||interval>100||interval%10)throw Error('总结间隔须为20～100轮，每10轮一级。');
 await db.transaction('rw',tables(),async()=>{await listMemories(scope);const c=(await db.conversations.get(scope.conversationId))!,state=structuredClone(c.memorySummary??emptySummaryState());state.enabled=enabled;state.interval=interval;await db.conversations.update(c.id,{memorySummary:state});});
}
async function snapshot(scope:MemoryScope,initialize=false){
 const c=(await db.conversations.get(scope.conversationId))!;
 const t=initialize?await ensureTimelineInTransaction(c.id):c.activeTimelineId?await db.timelines.get(c.activeTimelineId):undefined;
 const nodes=t?await nodesForHead(c.id,t.headNodeId):(await activeMessages(c.id)).map(message=>({id:'',message}));
 const turns:{ref:SummaryTurn;nodeId:string;messages:{role:string;content:string;images:number}[]}[]=[];let users:string[]=[],messages:{role:string;content:string;images:number}[]=[];
 for(const n of nodes){const m=visibleMessage(n.message);if(m.role==='user'){users.push(m.id);messages.push({role:'user',content:m.content,images:m.attachments?.length??0});}else if(m.role==='assistant'&&users.length){messages.push({role:'assistant',content:m.content,images:0});turns.push({ref:{userIds:users,assistantId:m.id},nodeId:n.id,messages});users=[];messages=[];}}
 const done=new Set((await visibleSummaryReceipts(scope)).flatMap(r=>r.turns.map(key)));
 return {t,nodes,turns:turns.filter(turn=>!done.has(key(turn.ref)))};
}
export async function summaryStatus(scope:MemoryScope){
 return db.transaction('r',tables(),async()=>{await listMemories(scope);const c=(await db.conversations.get(scope.conversationId))!,state=c.memorySummary??emptySummaryState();const data=await snapshot(scope);const job=state.job&&scopeKey(state.job.scope)===scopeKey(scope)?state.job:undefined;
  return {enabled:state.enabled,interval:state.interval,pending:data.turns.length,deferUntilPending:state.deferUntilPending,receipts:(await visibleSummaryReceipts(scope)).length,busy:state.job?.status==='running'&&Date.now()<state.job.leaseUntil,job};
 });
}
interface Claim {job:MemorySummaryJob;turns:SummaryTurn[];inputs:string[]}
async function claim(scope:MemoryScope,manual:boolean):Promise<Claim|undefined>{
 return db.transaction('rw',tables(),async()=>{
  await listMemories(scope);const c=(await db.conversations.get(scope.conversationId))!,state=structuredClone(c.memorySummary??emptySummaryState());
  if(!manual&&!state.enabled)return;
  if(state.job?.status==='running'&&Date.now()<state.job.leaseUntil)return;
  // A failed job is terminal for that attempt, never a permanent disable.
  // The next successful chat turn may claim a fresh job; completed chunks resume.

  const data=await snapshot(scope,true);if(!data.t?.headNodeId)throw Error('state');
  if(!manual&&state.deferUntilPending!==undefined&&data.turns.length>=state.deferUntilPending){state.autoAttempt=undefined;state.deferUntilPending=undefined;}
  if(!data.turns.length||(!manual&&(data.turns.length<state.interval||data.turns.length<(state.deferUntilPending??0))))return;
  await sealMemorySummaryForks(scope);
  const full=state.receipts.length>=summaryLimits.receipts;
  // The configured interval is the logical group. Split only the API inputs;
  // do not advance the receipt until every chunk of the group succeeds.
  const group=full?[]:data.turns.slice(0,state.interval);
  let inputs:string[]=[];let attemptedTokens=memoryTokenCost(system),oversized=false;
  if(group.length){
   try{inputs=buildSummaryInputs(group,system,summaryLimits.inputTokens);}
   catch{oversized=true;}
  }
  // Preserve the full configured turn group; oversized turns are split into resumable bounded chunks.
  // Never silently discard raw turns to fit the budget.
  if(inputs.length>100)oversized=true;
  const fits=group.length>0&&!oversized;
  const previous=state.checkpoint;
  const resume=previous&&scopeKey(previous.scope)===scopeKey(scope)&&previous.timelineId===data.t.id&&previous.throughNodeId===group.at(-1)?.nodeId&&JSON.stringify(previous.turns)===JSON.stringify(group.map(x=>x.ref))&&JSON.stringify(previous.inputs)===JSON.stringify(inputs);
  if(fits&&!resume)state.checkpoint={scope:structuredClone(scope),timelineId:data.t.id,throughNodeId:group.at(-1)!.nodeId,turns:group.map(x=>x.ref),inputs,completed:[]};
  const job:MemorySummaryJob={id:crypto.randomUUID(),scope:structuredClone(scope),epoch:c.timelineEpoch??0,timelineId:data.t.id,snapshotHeadId:data.t.headNodeId!,throughNodeId:group.at(-1)?.nodeId??data.t.headNodeId!,status:fits?'running':'failed',startedAt:Date.now(),leaseUntil:Date.now()+Math.max(summaryLimits.leaseMs,inputs.length*210000+90000),...(!fits?{...(!full?{diagnostic:{version:1 as const,stage:'input' as const,code:'input-budget' as const,inputRounds:inputs.length,pendingRounds:data.turns.length,inputTokenEstimate:attemptedTokens}}:{}),error:full?'capacity' as const:'input-too-large' as const,finishedAt:Date.now()}:{})};
  if(!manual&&fits){
   const previous=state.autoAttempt;
   const count=previous?.throughNodeId===job.throughNodeId?previous.count+1:1;
   state.autoAttempt={throughNodeId:job.throughNodeId,count,pendingAtStart:data.turns.length};
  }
  if(!manual&&!fits){
   // A terminal local failure must not be retried on every foreground wake or chat turn.
   // Preserve all unsummarized turns and reconsider after one additional interval.
   state.deferUntilPending=data.turns.length+state.interval;
   state.autoAttempt=undefined;
  }
  state.job=job;await db.conversations.update(c.id,{memorySummary:state});
  return fits?{job,turns:group.map(x=>x.ref),inputs}:undefined;
 });
}
async function fail(job:MemorySummaryJob,error:SummaryFailure,diagnostic?:SummaryDiagnostic,decision?:ReturnType<typeof classifySummaryError>){
 await db.transaction('rw',db.conversations,async()=>{const c=await db.conversations.get(job.scope.conversationId);if(c?.memorySummary?.job?.id!==job.id)return;const state=structuredClone(c.memorySummary);state.job={...state.job!,status:'failed',error,...(decision?{retryable:decision.retry,failureKind:decision.kind}:{}),...(diagnostic?{diagnostic}:{}),finishedAt:Date.now()};
  if(state.autoAttempt?.throughNodeId===job.throughNodeId&&state.autoAttempt.count>=2){state.deferUntilPending=state.autoAttempt.pendingAtStart+state.interval;}
  await db.conversations.update(c.id,{memorySummary:state});});
}
async function execute(scope:MemoryScope,manual:boolean){
 let claimed:Claim|undefined;try{claimed=await claim(scope,manual);}catch(e){if(manual)throw e;return;}if(!claimed)return;
 const {job}=claimed;let failure:SummaryFailure='provider',diagnostic:SummaryDiagnostic|undefined;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(60000,claimed.inputs.length*200000+90000));
 try{
  const c=await db.conversations.get(scope.conversationId);if(!c)throw Error('stale-path');
  const {config,key:apiKey}=await getSummaryApi(scope);

  failure='format';const facts:SummaryFact[]=[],events:string[]=[];
  const stats={candidates:0,accepted:0,rejected:0,reasons:{} as Record<string,number>};
  for(let index=0;index<claimed.inputs.length;index++){
   const input=claimed.inputs[index];
   const saved=(await db.conversations.get(scope.conversationId))?.memorySummary?.checkpoint;
   if(saved&&saved.throughNodeId===job.throughNodeId&&saved.timelineId===job.timelineId&&saved.completed[index]&&saved.completed[index].eventSummary!==undefined){const part=saved.completed[index];facts.push(...part.facts);if(part.eventSummary)events.push(part.eventSummary);stats.candidates+=part.candidates;stats.accepted+=part.accepted;stats.rejected+=part.rejected;for(const [reason,count] of Object.entries(part.reasons))stats.reasons[reason]=(stats.reasons[reason]??0)+count;continue;}
   const before=facts.length;
   const combined=claimed.inputs.length===1;
   const raw=await requestSummary(config,apiKey,input,controller.signal,combined);
   if(controller.signal.aborted||Date.now()>job.leaseUntil){failure='interrupted';throw Error('interrupted');}
   try{
    let memoryJson=raw,eventSummary='';
    if(combined){
     let result:unknown;
     try{result=JSON.parse(raw.trim());}catch{throw new SummaryResponseError({version:1,stage:'parse',code:'json-syntax'});}
     if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='memories,summary'||typeof (result as {summary?:unknown}).summary!=='string')throw new SummaryResponseError({version:1,stage:'validate',code:'response-shape'});
     const response=result as {memories:unknown;summary:string};
     if(response.summary.length>1200)throw new SummaryResponseError({version:1,stage:'validate',code:'output-limit'});
     eventSummary=response.summary.trim();
     memoryJson=JSON.stringify({memories:response.memories});
    }
    const parsed=parseSummary(memoryJson),selected=selectSummaryCandidates(parsed,input);
    if(!combined)eventSummary=await requestChunkEvents(config,apiKey,input,controller.signal);
    if(eventSummary)events.push(eventSummary);
    facts.push(...selected.accepted);stats.candidates+=parsed.length;stats.accepted+=selected.accepted.length;
    stats.rejected+=selected.rejected.length;
    const reasons:Record<string,number>={};
    for(const r of selected.rejected){stats.reasons[r.reason]=(stats.reasons[r.reason]??0)+1;reasons[r.reason]=(reasons[r.reason]??0)+1;}
    await db.transaction('rw',db.conversations,async()=>{const latest=await db.conversations.get(scope.conversationId);const state=latest?.memorySummary;if(!state||state.job?.id!==job.id||!state.checkpoint||state.checkpoint.throughNodeId!==job.throughNodeId)throw Error('stale-path');const next=structuredClone(state);next.checkpoint!.completed[index]={facts:facts.slice(before),eventSummary,candidates:parsed.length,accepted:selected.accepted.length,rejected:selected.rejected.length,reasons};await db.conversations.update(scope.conversationId,{memorySummary:next});});
   }catch(e){if((e as Error).message==='empty')failure='empty';if(e instanceof SummaryFormatError)diagnostic={...e.diagnostic,receivedChars:raw.length,outputTokenLimit:Math.min(config.maxTokens,summaryLimits.outputTokens)};throw e;}
  }
  job.selection=stats;
  // A single bounded, chronological event digest belongs to the whole configured
  // interval, never to an individual API chunk. It is separate from raw messages.
  const uniqueEvents=events.filter(Boolean);
  const previousSummaries=(await visibleSummaryReceipts(scope)).filter(r=>r.shortSummary?.trim()).slice(-2).map(r=>r.shortSummary!);
  let groupSummary=uniqueEvents[0]??'';
  if(claimed.inputs.length>1){
   let layer=uniqueEvents.slice();let depth=0;
   while(layer.length>1){
    if(++depth>12)throw Error('一级总结事件合并超过层级上限');
    const next:string[]=[];
    for(let i=0;i<layer.length;i+=6){
     const batch=layer.slice(i,i+6);
     next.push(batch.length===1?batch[0]:await requestGroupDigest(config,apiKey,batch,controller.signal,depth===1?previousSummaries:[]));
    }
    layer=next;
   }
   groupSummary=layer[0]??'';
  }

  failure='stale-path';
  await db.transaction('rw',tables(),async()=>{
   if(controller.signal.aborted||Date.now()>job.leaseUntil){failure='interrupted';throw Error('interrupted');}
   const current=(await db.conversations.get(scope.conversationId));if(!current||current.memorySummary?.job?.id!==job.id||current.memorySummary.job.status!=='running'||current.activeTimelineId!==job.timelineId||(current.timelineEpoch??0)!==job.epoch)throw Error('stale-path');
   const nodes=await nodesForHead(current.id,(await db.timelines.get(job.timelineId))?.headNodeId);if(!nodes.some(n=>n.id===job.snapshotHeadId))throw Error('stale-path');
   await sealMemorySummaryForks(scope);
   const state=structuredClone((await db.conversations.get(current.id))!.memorySummary!);if(state.receipts.length>=summaryLimits.receipts){failure='capacity';throw Error('capacity');}
   // Include tombstones/previous revisions too: a deleted or manually edited auto
   // fact must not be recreated merely because a later summary repeats its text.
   const all=await listMemoryRevisions(scope);
   const known=summaryDuplicateIndex(all.map(e=>e.content));
   let added=0,duplicates=0;
   for(const fact of facts){if(known.has(fact)){duplicates++;continue;}failure='capacity';await createMemory(scope,{kind:fact.quality?.importance==='high'&&['major-event','relationship','identity','boundary','ongoing-conflict','continuity'].includes(fact.quality.category)?'core':'long',source:'auto',sourceReceiptId:job.id,content:`【${labels[fact.type]}】${fact.content}`});known.add(fact);added++;}
   const sourceFingerprint=await summarySourceFingerprint({turns:claimed!.turns},nodes.map(n=>n.message));
   if(!sourceFingerprint){failure='stale-path';throw Error('summary source missing');}
   state.checkpoint=undefined;state.autoAttempt=undefined;state.deferUntilPending=undefined;state.revision++;state.receipts.push({id:job.id,revision:state.revision,scope:structuredClone(scope),epoch:job.epoch,timelineId:job.timelineId,throughNodeId:job.throughNodeId,turns:claimed!.turns,sourceFingerprint,shortSummary:groupSummary,createdAt:Date.now(),added,duplicates,selection:job.selection});state.job={...job,status:'succeeded',finishedAt:Date.now(),added,duplicates};await db.conversations.update(current.id,{memorySummary:state});
  });
 }catch(error){if(error instanceof SummaryResponseError){diagnostic=error.diagnostic;failure=diagnostic.code==='truncated'?'format':'provider';}if(diagnostic)diagnostic={...diagnostic,inputRounds:claimed.turns.length,inputTokenEstimate:memoryTokenCost(system)+Math.max(...claimed.inputs.map(memoryTokenCost))};await fail(job,failure,diagnostic,{...classifySummaryError(error,navigator.onLine),retry:manual&&classifySummaryError(error,navigator.onLine).retry}).catch(()=>{});}finally{clearTimeout(timer);}
}
const running=new Map<string,Promise<void>>();
export function runMemorySummary(scope:MemoryScope,manual=true){
 const old=running.get(scope.conversationId);if(old)return old;
 const task=Promise.resolve().then(()=>withSummaryLock('claudia-primary-summary:'+scope.conversationId,()=>execute(scope,manual))).finally(()=>{if(running.get(scope.conversationId)===task)running.delete(scope.conversationId);});running.set(scope.conversationId,task);return task;
}
/** One initial attempt and at most one retry per due group.
 * After two failures, defer until a whole additional interval of completed turns.
 * The failed group's turns are not marked as summarized.
 */
const autoLoops=new Set<string>();
export async function tryAutoSummary(conversationId:string){
 if(autoLoops.has(conversationId)||!navigator.onLine||document.hidden)return;
 const c=await db.conversations.get(conversationId);
 if(!c?.memorySummary?.enabled)return;
 const scope=await getMemoryScope(conversationId);
 if(autoLoops.has(conversationId))return;
 autoLoops.add(conversationId);
 void (async()=>{
  for(let group=0;group<3;group++){
   if(!navigator.onLine||document.hidden)break;
   const before=await summaryStatus(scope);
   const state=(await db.conversations.get(conversationId))?.memorySummary;
   if(!state?.enabled||before.pending<before.interval||before.pending<(state.deferUntilPending??0))break;
   // One attempt per due cycle. A failure is terminal for this cycle:
   // do not silently issue another paid API request, even for transient errors.
   const attemptState=(await db.conversations.get(conversationId))?.memorySummary;
   if((attemptState?.deferUntilPending??0)>before.pending)return;
   if(!navigator.onLine||document.hidden)return;
   await runMemorySummary(scope,false);
   const current=(await db.conversations.get(conversationId))?.memorySummary;
   const succeeded=current?.job?.status==='succeeded';
   if(!succeeded&&current?.job?.status!=='failed')return;
   if(!succeeded){
    if(!navigator.onLine||document.hidden)return;
    await db.transaction('rw',db.conversations,async()=>{
     const latest=await db.conversations.get(conversationId);
     if(!latest?.memorySummary?.enabled||latest.memorySummary.job?.status!=='failed')return;
     const next=structuredClone(latest.memorySummary);
     next.deferUntilPending=Math.max(before.pending+before.interval,next.deferUntilPending??0);
     await db.conversations.update(conversationId,{memorySummary:next});
    });
    break;
   }
  }
 })().catch(()=>{}).finally(()=>autoLoops.delete(conversationId));
}
