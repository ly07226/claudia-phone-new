import {summaryCapacityKey,summaryCapacityRecovered,summaryCapacityFull} from './summaryCapacity';
import {memoryScopeKey} from './memoryScopeKey';
import {withSummaryLock} from './summaryLock';
import {getSummaryApi} from './dedicatedSummaryApi';
import {classifySummaryError} from './memorySummaryErrors';
import {describeReplyFailure} from './replyFailure';
import {activeMessages} from './messagePath';
import {db} from './store';
import {getMemoryScope,listMemories,listMemoryRevisions,createMemory,sealMemorySummaryForks,visibleSummaryReceipts} from './memoryStore';
import {timelineTables,ensureTimelineInTransaction,nodesForHead} from './timelines';
import {visibleMessage} from './messageBubbles';
import {summaryDuplicateIndex} from './memorySummaryQuality';
import {requestSummary,SummaryResponseError} from './memorySummaryRequest';
import {maybeBuildCoreMemory} from './memoryCoreBuilder';
import {SummaryFormatError,parseSimpleSummary,summaryPrompt} from './memorySummaryFormat';
export {parseSummary} from './memorySummaryFormat';
import {memoryTokenCost} from './memoryContext';
import {buildSummaryInputs} from './memorySummaryChunks';
import {taggedSummaryFingerprint as summarySourceFingerprint,summaryVerifier} from './summarySourceFingerprint';
import {memoryLimits,type MemoryScope} from './memoryTypes';
import {emptySummaryState,summaryLimits,summaryRejectionText,type SummaryFact,type SummaryTurn,type SummaryFailure,type MemorySummaryJob,type SummaryDiagnostic} from './memorySummaryTypes';
class SummaryReadError extends Error{constructor(){super('当前会话聊天记录读取失败，未调用模型；原聊天和已有记忆未修改。');this.name='SummaryReadError';}}
const tables=()=>[...timelineTables(),db.characters,db.worlds,db.worldProfiles];
const key=(turn:SummaryTurn)=>JSON.stringify([turn.userIds,turn.assistantId]);
const scopeKey=memoryScopeKey;
const labels={fact:'已发生事实',belief:'人物主观判断',speculation:'猜测（未证实）',pending:'未完成事项'};
const system=summaryPrompt;

export async function saveSummarySettings(scope:MemoryScope,enabled:boolean,interval:number){
 if(typeof enabled!=='boolean'||!Number.isInteger(interval)||interval<20||interval>100||interval%10)throw Error('总结间隔须为20～100轮，每10轮一级。');
 await db.transaction('rw',tables(),async()=>{await listMemories(scope);const c=(await db.conversations.get(scope.conversationId))!,state=structuredClone(c.memorySummary??emptySummaryState());state.enabled=enabled;state.interval=interval;await db.conversations.update(c.id,{memorySummary:state});});
}
async function snapshot(scope:MemoryScope,initialize=false){
 let c,t,nodes;try{c=(await db.conversations.get(scope.conversationId))!;
 t=initialize?await ensureTimelineInTransaction(c.id):c.activeTimelineId?await db.timelines.get(c.activeTimelineId):undefined;
 nodes=t?await nodesForHead(c.id,t.headNodeId):(await activeMessages(c.id)).map(message=>({id:'',message}));}catch{throw new SummaryReadError();}
 const turns:{ref:SummaryTurn;nodeId:string;messages:{role:string;content:string;images:number}[]}[]=[];let users:string[]=[],messages:{role:string;content:string;images:number}[]=[];
 for(const n of nodes){const m=visibleMessage(n.message);if(m.role==='user'){users.push(m.id);messages.push({role:'user',content:m.content,images:m.attachments?.length??0});}else if(m.role==='assistant'&&!m.replyInterruption&&users.length){messages.push({role:'assistant',content:m.content,images:0});turns.push({ref:{userIds:users,assistantId:m.id},nodeId:n.id,messages});users=[];messages=[];}}
 const done=new Set<string>();let unverified=0,changed=0;const coveredAssistantIds=new Set<string>();const verify=summaryVerifier(nodes.map(n=>n.message));
 const receipts=await visibleSummaryReceipts(scope);const validityById=new Map<string,Awaited<ReturnType<typeof verify>>>();
 for(let i=0;i<receipts.length;i+=64){const batch=receipts.slice(i,i+64);if(batch.every(r=>r.sourceFingerprint?.startsWith('s3:'))){const values=batch.map(verify);const results=values.every(v=>typeof v==='string')?values:await Promise.all(values);batch.forEach((r,j)=>validityById.set(r.id,results[j] as Awaited<ReturnType<typeof verify>>));}else for(const r of batch){const value=verify(r);validityById.set(r.id,typeof value==='string'?value:await value);}}
 for(const receipt of receipts){
  for(const turn of receipt.turns)coveredAssistantIds.add(turn.assistantId);
  const validity=validityById.get(receipt.id)!;
  // Preserve old progress without trusting old facts or billing a silent rebuild.
  if(validity==='unverified'){unverified++;}
  else if(validity==='changed'){changed++;continue;}
  for(const turn of receipt.turns)done.add(key(turn));
 }
 const read={messages:nodes.length,characters:nodes.reduce((n,row)=>n+visibleMessage(row.message).content.length,0),rounds:turns.length,unanswered:users.length};
 return {read,t,nodes,unverified,changed,coveredAssistantIds,turns:turns.filter(turn=>!done.has(key(turn.ref)))};
}
export async function summaryStatus(scope:MemoryScope){
 return db.transaction('r',tables(),async()=>{await listMemories(scope);const c=(await db.conversations.get(scope.conversationId))!,state=c.memorySummary??emptySummaryState();const data=await snapshot(scope);const job=state.job&&scopeKey(state.job.scope)===scopeKey(scope)?state.job:undefined;
  return {read:data.read,enabled:state.enabled,interval:state.interval,pending:data.turns.length,unverified:data.unverified,changed:data.changed,requiresManualResume:state.requiresManualResume,deferUntilPending:state.deferUntilPending,receipts:(await visibleSummaryReceipts(scope)).length,busy:state.job?.status==='running'&&Date.now()<state.job.leaseUntil,job,coreAttempt:c.memoryCoreAttempt};
 });
}
async function assertSummarySource(job:MemorySummaryJob,manual:boolean){
 const c=await db.conversations.get(job.scope.conversationId);if(!c||c.activeTimelineId!==job.timelineId||(c.timelineEpoch??0)!==job.epoch||c.memorySummary?.job?.id!==job.id||c.memorySummary.job.status!=='running'||(!manual&&!c.memorySummary.enabled)||Date.now()>job.leaseUntil)throw Error('stale-path');
 const t=await db.timelines.get(job.timelineId);const nodes=await nodesForHead(c.id,t?.headNodeId);if(await summarySourceFingerprint({turns:(c.memorySummary.checkpoint?.turns??[])},nodes.map(n=>n.message))!==job.sourceFingerprint)throw Error('stale-path');
}
interface Claim {job:MemorySummaryJob;turns:SummaryTurn[];inputs:string[];reviewTurns:{messages:{role:string;content:string}[]}[]}
async function claim(scope:MemoryScope,manual:boolean):Promise<Claim|undefined>{
 return db.transaction('rw',tables(),async()=>{
  await listMemories(scope);const c=(await db.conversations.get(scope.conversationId))!,state=structuredClone(c.memorySummary??emptySummaryState());
  if(summaryCapacityRecovered(c)&&state.job?.chunks===0&&!state.checkpoint?.completed.length){state.capacityBlocked=undefined;state.deferUntilPending=undefined;state.autoAttempt=undefined;state.requiresManualResume=undefined;}
  if(manual)state.requiresManualResume=undefined;
  if(state.job?.status==='running'){if(Date.now()<state.job.leaseUntil)return;if(!manual){state.job={...state.job,status:'failed',error:'interrupted',finishedAt:Date.now()};state.requiresManualResume=true;await db.conversations.update(c.id,{memorySummary:state});return;}}
  if(!manual&&(!state.enabled||state.requiresManualResume))return;
  // A failed job is terminal for that attempt, never a permanent disable.
  // Explicit recovery resumes completed chunks; failed paid calls never retry on a new turn.

  const data=await snapshot(scope,true);if(!data.t?.headNodeId)throw Error('state');
  // An edited/regenerated old round is not a new completed round. Only an
  // explicit manual request may rebuild its invalidated, preserved receipt.
  if(!manual)data.turns=data.turns.filter(t=>!data.coveredAssistantIds.has(t.ref.assistantId));
  // Legacy pending-count backoff is obsolete; new turns must not be a recovery prerequisite.
  if(state.deferUntilPending!==undefined){state.deferUntilPending=undefined;state.autoAttempt=undefined;}
  if(!data.turns.length||(!manual&&data.turns.length<state.interval))return;
  await sealMemorySummaryForks(scope);
  const full=summaryCapacityFull(c);if(full)state.capacityBlocked=summaryCapacityKey(c);
  // Commit one API-sized, complete-turn group at a time. A later failed
  // request cannot roll back an earlier successful receipt or its progress.
  // The configured interval is an upper bound, not an all-or-nothing batch.
  let group=full?[]:data.turns.slice(0,state.interval);
  if(group.length>1){
   let low=1,high=group.length,best=0;
   while(low<=high){
    const mid=Math.floor((low+high)/2);
    try{
     if(buildSummaryInputs(group.slice(0,mid),system,summaryLimits.inputTokens).length===1){best=mid;low=mid+1;}
     else high=mid-1;
    }catch{high=mid-1;}
   }
   if(best>0)group=group.slice(0,best);
  }
  let inputs:string[]=[];let attemptedTokens=memoryTokenCost(system),oversized=false;
  if(group.length){
   attemptedTokens=memoryTokenCost(system)+memoryTokenCost(JSON.stringify(group.map(x=>x.messages)));
   try{inputs=buildSummaryInputs(group,system,summaryLimits.inputTokens);}
   catch{oversized=true;}
  }
  // Preserve the full configured turn group; oversized turns are split into resumable bounded chunks.
  // Never silently discard raw turns to fit the budget.
  if(inputs.length>100)oversized=true;
  const fits=group.length>0&&!oversized;
  const claimedSourceFingerprint=group.length?await summarySourceFingerprint({turns:group.map(x=>x.ref)},data.nodes.map(n=>n.message)):undefined;
  const previous=state.checkpoint;
  const resume=previous&&scopeKey(previous.scope)===scopeKey(scope)&&previous.timelineId===data.t.id&&previous.throughNodeId===group.at(-1)?.nodeId&&JSON.stringify(previous.turns)===JSON.stringify(group.map(x=>x.ref))&&JSON.stringify(previous.inputs)===JSON.stringify(inputs)&&state.job?.sourceFingerprint===claimedSourceFingerprint;
  if(fits&&!resume&&previous?.completed.length){if((state.checkpointArchive?.length??0)>=3)throw Error('历史检查点保留容量已满，未丢弃原结果，也未请求模型。');state.checkpointArchive=[...(state.checkpointArchive??[]),previous];}
  if(fits&&!resume)state.checkpoint={scope:structuredClone(scope),timelineId:data.t.id,throughNodeId:group.at(-1)!.nodeId,turns:group.map(x=>x.ref),inputs,completed:[]};
  const job:MemorySummaryJob={read:data.read,chunks:inputs.length,completedChunks:resume?previous!.completed.length:0,...(claimedSourceFingerprint?{sourceFingerprint:claimedSourceFingerprint}:{}),id:crypto.randomUUID(),scope:structuredClone(scope),epoch:c.timelineEpoch??0,timelineId:data.t.id,snapshotHeadId:data.t.headNodeId!,throughNodeId:group.at(-1)?.nodeId??data.t.headNodeId!,status:fits?'running':'failed',startedAt:Date.now(),leaseUntil:Date.now()+Math.max(summaryLimits.leaseMs,inputs.length*210000+90000),...(!fits?{...(!full?{diagnostic:{version:1 as const,stage:'input' as const,code:'input-budget' as const,inputRounds:inputs.length,pendingRounds:data.turns.length,inputTokenEstimate:attemptedTokens}}:{}),error:full?'capacity' as const:'input-too-large' as const,finishedAt:Date.now()}:{})};
  if(!manual&&fits){
   const previous=state.autoAttempt;
   const count=previous?.throughNodeId===job.throughNodeId?previous.count+1:1;
   state.autoAttempt={throughNodeId:job.throughNodeId,count,pendingAtStart:data.turns.length};
  }
  if(!manual&&!fits){
   // A terminal local failure must not be retried on every foreground wake or chat turn.
   // Only a confirmed pre-request capacity block may reopen automatically.
   state.requiresManualResume=true;
   state.deferUntilPending=undefined;
   state.autoAttempt=undefined;
  }
  state.job=job;await db.conversations.update(c.id,{memorySummary:state});
  return fits?{job,turns:group.map(x=>x.ref),inputs,reviewTurns:group}:undefined;
 });
}
async function fail(job:MemorySummaryJob,error:SummaryFailure,diagnostic?:SummaryDiagnostic,decision?:ReturnType<typeof classifySummaryError>,manual=false){
 await db.transaction('rw',db.conversations,async()=>{const c=await db.conversations.get(job.scope.conversationId);if(c?.memorySummary?.job?.id!==job.id)return;const state=structuredClone(c.memorySummary);// Failed automatic jobs pause for explicit recovery, not additional chat turns.
  state.requiresManualResume=true;state.deferUntilPending=undefined;if(error==='capacity')state.capacityBlocked=summaryCapacityKey(c);state.job={...state.job!,status:'failed',error,...(decision?{retryable:decision.retry,failureKind:decision.kind}:{}),...(job.failureHttpStatus?{failureHttpStatus:job.failureHttpStatus}:{}),...(job.failureReason?{failureReason:job.failureReason}:{}),...(job.failureServiceCode?{failureServiceCode:job.failureServiceCode}:{}),...(diagnostic?{diagnostic}:{}),finishedAt:Date.now()};
  if(state.autoAttempt?.throughNodeId===job.throughNodeId)state.autoAttempt=undefined;
  await db.conversations.update(c.id,{memorySummary:state});});
}
async function execute(scope:MemoryScope,manual:boolean){
 let claimed:Claim|undefined;try{claimed=await claim(scope,manual);}catch(e){if(manual)throw e;return;}if(!claimed)return;
 const {job}=claimed;let failure:SummaryFailure='provider',diagnostic:SummaryDiagnostic|undefined;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(60000,claimed.inputs.length*200000+90000));
 try{
  const c=await db.conversations.get(scope.conversationId);if(!c)throw Error('stale-path');
  const {config,key:apiKey}=await getSummaryApi(scope);

  failure='format';const facts:SummaryFact[]=[],events:string[]=[];const inputForFact=new Map<SummaryFact,number>();
  const stats={candidates:0,accepted:0,rejected:0,reasons:{} as Record<string,number>};
  for(let index=0;index<claimed.inputs.length;index++){
   failure='stale-path';await db.transaction('r',tables(),()=>assertSummarySource(job,manual));
   const input=claimed.inputs[index];
   const saved=(await db.conversations.get(scope.conversationId))?.memorySummary?.checkpoint;
   if(saved&&saved.throughNodeId===job.throughNodeId&&saved.timelineId===job.timelineId&&saved.completed[index]){
    try{const part=saved.completed[index],reviewed=parseSimpleSummary(JSON.stringify({memories:part.facts}));
    for(const f of reviewed.facts)inputForFact.set(f,index);facts.push(...reviewed.facts);const event=reviewed.facts.map(f=>`【${labels[f.type]}】${f.content}`).join('\n');if(event)events.push(event);
    const countsValid=[part.candidates,part.accepted,part.rejected].every(n=>Number.isSafeInteger(n)&&n>=0)&&part.accepted===part.facts.length&&part.candidates===part.accepted+part.rejected&&part.reasons&&Object.entries(part.reasons).every(([k,n])=>Object.hasOwn(summaryRejectionText,k)&&Number.isSafeInteger(n)&&n>=0)&&Object.values(part.reasons).reduce((a,b)=>a+b,0)===part.rejected;
    stats.candidates+=countsValid?part.candidates:part.facts.length;stats.accepted+=reviewed.facts.length;stats.rejected+=(countsValid?part.rejected:0);for(const [reason,count] of Object.entries(countsValid?part.reasons:{}))stats.reasons[reason]=(stats.reasons[reason]??0)+count;continue;
    }catch(e){if(!manual||!(e instanceof SummaryFormatError))throw e;/* Explicit recovery may regenerate an invalid old fragment, never a verified one. */}
   }
   const before=facts.length;
   failure='provider';const raw=await requestSummary(config,apiKey,input,controller.signal);
   if(controller.signal.aborted||Date.now()>job.leaseUntil){failure='interrupted';throw Error('interrupted');}
   failure='format';try{
    // Semantic extraction is model-owned; no citation or keyword gate.
    const batch=parseSimpleSummary(raw);
    const selected={accepted:batch.facts,rejected:[] as {index:number;reason:string}[]};
    const eventSummary=selected.accepted.map(f=>`【${labels[f.type]}】${f.content}`).join('\n').slice(0,2500);
    if(eventSummary)events.push(eventSummary);
    for(const f of selected.accepted)inputForFact.set(f,index);facts.push(...selected.accepted);stats.candidates+=batch.candidates;stats.accepted+=selected.accepted.length;
    stats.rejected+=batch.rejected;if(batch.rejected)stats.reasons['invalid-candidate']=(stats.reasons['invalid-candidate']??0)+batch.rejected;
    const reasons:Record<string,number>=batch.rejected?{'invalid-candidate':batch.rejected}:{};

    failure='stale-path';await db.transaction('rw',tables(),async()=>{await assertSummarySource(job,manual);const latest=await db.conversations.get(scope.conversationId);const state=latest?.memorySummary;if(!state||state.job?.id!==job.id||!state.checkpoint||state.checkpoint.throughNodeId!==job.throughNodeId)throw Error('stale-path');const next=structuredClone(state);if(next.job)next.job.completedChunks=index+1;next.checkpoint!.completed[index]={facts:facts.slice(before),eventSummary,candidates:batch.candidates,accepted:selected.accepted.length,rejected:batch.rejected,reasons};await db.conversations.update(scope.conversationId,{memorySummary:next});});
   }catch(e){if((e as Error).message==='empty')failure='empty';if(e instanceof SummaryFormatError)diagnostic={...e.diagnostic,receivedChars:raw.length,outputTokenLimit:Math.min(config.maxTokens,summaryLimits.outputTokens)};throw e;}
  }
  job.completedChunks=claimed.inputs.length;job.selection=stats;
  // A single bounded, chronological event digest belongs to the whole configured
  // interval, never to an individual API chunk. It is separate from raw messages.
  const uniqueEvents=events.filter(Boolean);
  let groupSummary=uniqueEvents[0]??'';
  if(claimed.inputs.length>1){
   // Merge already-paid-for chunk summaries locally. Secondary/core synthesis
   // runs independently and must never block first-pass persistence.
   groupSummary=uniqueEvents.join('\n').slice(0,2500);
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
   // Validate the exact source BEFORE writing any derived facts. The original
   // immutable path may still exist after an edit or branch change.
   const currentPath=await nodesForHead(current.id,(await db.timelines.get(job.timelineId))?.headNodeId);
   const sourceFingerprint=await summarySourceFingerprint({turns:claimed!.turns},currentPath.map(n=>n.message));
   if(!sourceFingerprint||!job.sourceFingerprint||sourceFingerprint!==job.sourceFingerprint){failure='stale-path';throw Error('summary source changed');}
   // The active timeline is the authoritative source for this claimed batch.
   // activeMessages() already resolves the selected timeline when one exists.
   // A second projection read is redundant after verifying this same snapshot.
   // Do not reject a verified immutable batch merely because that projection differs.
   const all=await listMemoryRevisions(scope);
   const known=summaryDuplicateIndex(all.map(e=>e.content));
   const pending:SummaryFact[]=[];
   for(const fact of facts){if(known.has(fact)){continue;}known.add(fact);pending.push(fact);}
   // Capacity is checked for the whole batch, before the first memory write.
   // Never leave a partially committed group when storage fills up.
   const memoryState=(await db.conversations.get(current.id))?.memoryStore;
   const used=memoryState?.entries.length??0;
   const chars=(memoryState?.entries??[]).reduce((n,e)=>n+e.content.length,0);
   const requiredChars=pending.reduce((n,f)=>n+`【${labels[f.type]}】${f.content}`.length,0);
   if(used+pending.length>memoryLimits.events||chars+requiredChars>memoryLimits.totalChars||pending.some(f=>`【${labels[f.type]}】${f.content}`.length>memoryLimits.entryChars)){failure='capacity';throw Error('capacity');}
   let added=0,duplicates=facts.length-pending.length;
   for(const fact of pending){failure='state';const input=JSON.parse(claimed!.inputs[inputForFact.get(fact)!]) as {role:string;content:string;turnIndex?:number}[][];const quality=fact.quality?{...fact.quality,evidence:fact.quality.evidence.map(e=>{const part=input[e.turn-1]?.find(m=>m.role===e.role&&m.content.includes(e.quote));const turn=part?.turnIndex??claimed!.reviewTurns.findIndex(t=>t.messages.some(m=>m.role===e.role&&m.content===part?.content));if(turn<0){failure='stale-path';throw Error('stale-path');}return {...e,turn:turn+1};})}:undefined;await createMemory(scope,{type:fact.type,quality,kind:fact.kind??(fact.quality?.importance==='high'&&['major-event','relationship','identity','boundary','ongoing-conflict','continuity'].includes(fact.quality.category)?'core':'long'),source:'auto',sourceReceiptId:job.id,content:`【${labels[fact.type]}】${fact.content}`});added++;}
   state.capacityBlocked=undefined;state.checkpoint=undefined;state.autoAttempt=undefined;state.deferUntilPending=undefined;state.revision++;state.receipts.push({id:job.id,revision:state.revision,scope:structuredClone(scope),epoch:job.epoch,timelineId:job.timelineId,throughNodeId:job.throughNodeId,turns:claimed!.turns,sourceFingerprint,shortSummary:groupSummary,createdAt:Date.now(),added,duplicates,selection:job.selection});state.job={...job,status:'succeeded',finishedAt:Date.now(),added,duplicates};await db.conversations.update(current.id,{memorySummary:state});
  });
  // Second pass is best-effort and never changes a successful primary receipt.
  try{await maybeBuildCoreMemory(scope);}catch{/* Core synthesis is independent of primary progress. */}
 }catch(error){
   const decision=classifySummaryError(error,navigator.onLine);
   const providerDetail=describeReplyFailure(error);
   // Persist only a fixed diagnostic category and numeric HTTP status, never provider body or credentials.
   if(providerDetail.httpStatus)job.failureHttpStatus=providerDetail.httpStatus;
    if(providerDetail.serviceCode)job.failureServiceCode=providerDetail.serviceCode;
   job.failureReason=controller.signal.aborted?'timeout':decision.reason==='unknown'?'unknown':decision.reason;
   // An aborted request is a timeout/interruption, not an unspecified provider error.
   if(controller.signal.aborted||error instanceof Error&&/abort|timeout|timed out|超时/i.test(error.message)){
    failure='timeout';
   }
   // Preserve the actual failure category. A stale timeline/checkpoint or local
   // state error must not be reported as a provider failure after switching APIs.
   if(error instanceof SummaryResponseError){diagnostic=error.diagnostic;if(failure!=='timeout')failure=diagnostic.stage==='response'&&diagnostic.code!=='truncated'?'provider':'format';}
   else if(failure==='timeout'){/* Preserve explicit timeout classification. */}
   else if(decision.kind==='state'){
    // Do not overwrite the stage recorded immediately before the failing operation.
    // The previous catch collapsed capacity, interruption, checkpoint and source
    // validation failures into a misleading generic stale-path status.
    if(!['capacity','stale-path','interrupted','input-too-large','format','empty','timeout','state'].includes(failure))failure='stale-path';
   }
   else if(decision.kind==='format')failure='format';
   else if(!['capacity','stale-path','interrupted','input-too-large','format','empty','state'].includes(failure))failure='provider';
   if(diagnostic)diagnostic={...diagnostic,inputRounds:claimed.turns.length,inputTokenEstimate:memoryTokenCost(system)+Math.max(...claimed.inputs.map(memoryTokenCost))};
   await fail(job,failure,diagnostic,{...decision,retry:manual&&decision.retry},manual).catch(()=>{});
  }finally{clearTimeout(timer);}
}
const running=new Map<string,Promise<void>>();
export function runMemorySummary(scope:MemoryScope,manual=true){
 const old=running.get(scope.conversationId);if(old)return old;
 const task=Promise.resolve().then(()=>withSummaryLock('claudia-primary-summary:'+scope.conversationId,()=>execute(scope,manual))).finally(()=>{if(running.get(scope.conversationId)===task)running.delete(scope.conversationId);});running.set(scope.conversationId,task);return task;
}
/** One automatic attempt per due group.
 * Paid failures remain paused for explicit recovery.
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
   const owner=await db.conversations.get(conversationId);const state=owner?.memorySummary;const recovered=owner&&summaryCapacityRecovered(owner)&&state?.job?.chunks===0&&!state.checkpoint?.completed.length;
   if(!state?.enabled||state.requiresManualResume&&!recovered||before.pending<before.interval)break;
   // One attempt per due cycle. A failure is terminal for this cycle:
   // do not silently issue another paid API request, even for transient errors.
   // No pending-count backoff: failed work is paused until explicit recovery.
   if(!navigator.onLine||document.hidden)return;
   await runMemorySummary(scope,false);
   const current=(await db.conversations.get(conversationId))?.memorySummary;
   if(current?.job?.id===before.job?.id)return;
   const succeeded=current?.job?.status==='succeeded';
   if(!succeeded&&current?.job?.status!=='failed')return;
   if(!succeeded){
    // No extra-turn penalty and no unattended repeated paid calls.
    break;
   }
  }
 })().catch(()=>{}).finally(()=>autoLoops.delete(conversationId));
}

export async function catchUpMemorySummaries(scope:MemoryScope){
 const initial=await summaryStatus(scope),groups=Math.min(100,Math.ceil(initial.pending/initial.interval));
 for(let i=0;i<groups;i++){const before=await summaryStatus(scope);if(!before.pending)break;await runMemorySummary(scope,true);const after=await summaryStatus(scope);if(after.job?.status!=='succeeded'||after.receipts<=before.receipts)break;}
}
