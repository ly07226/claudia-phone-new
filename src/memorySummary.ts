import {activeMessages} from './messagePath';
import {db} from './store';
import {getMemoryScope,listMemories,listMemoryRevisions,createMemory,sealMemorySummaryForks,visibleSummaryReceipts} from './memoryStore';
import {timelineTables,ensureTimelineInTransaction,nodesForHead} from './timelines';
import {visibleMessage} from './messageBubbles';
import {resolveApi} from './chatService';
import {selectSummaryCandidates,summaryDuplicateIndex} from './memorySummaryQuality';
import {requestSummary,SummaryResponseError} from './memorySummaryRequest';
import {parseSummary,summaryPrompt,SummaryFormatError} from './memorySummaryFormat';
export {parseSummary} from './memorySummaryFormat';
import {memoryTokenCost} from './memoryContext';
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
  return {enabled:state.enabled,interval:state.interval,pending:data.turns.length,receipts:(await visibleSummaryReceipts(scope)).length,busy:state.job?.status==='running'&&Date.now()<state.job.leaseUntil,job};
 });
}
interface Claim {job:MemorySummaryJob;turns:SummaryTurn[];inputs:string[]}
async function claim(scope:MemoryScope,manual:boolean):Promise<Claim|undefined>{
 return db.transaction('rw',tables(),async()=>{
  await listMemories(scope);const c=(await db.conversations.get(scope.conversationId))!,state=structuredClone(c.memorySummary??emptySummaryState());
  if(!manual&&!state.enabled)return;
  if(state.job?.status==='running'&&Date.now()<state.job.leaseUntil)return;
  if(!manual&&state.job&&scopeKey(state.job.scope)===scopeKey(scope)&&(state.job.status==='running'||(state.job.status==='failed'&&state.job.error!=='input-too-large'&&!state.checkpoint?.completed.length)))return;
  const data=await snapshot(scope,true);if(!data.t?.headNodeId)throw Error('state');
  if(!data.turns.length||(!manual&&data.turns.length<state.interval))return;
  await sealMemorySummaryForks(scope);
  const full=state.receipts.length>=summaryLimits.receipts;
  // The configured interval is the logical group. Split only the API inputs;
  // do not advance the receipt until every chunk of the group succeeds.
  const group=full?[]:data.turns.slice(0,state.interval);
  const inputs:string[]=[];let chunk:typeof group=[],attemptedTokens=memoryTokenCost(system),oversized=false;
  for(const turn of group){
   const next=JSON.stringify([...chunk,turn].map(x=>x.messages));
   attemptedTokens=memoryTokenCost(system)+memoryTokenCost(next);
   if(attemptedTokens>summaryLimits.inputTokens){
    if(!chunk.length){oversized=true;break;}
    inputs.push(JSON.stringify(chunk.map(x=>x.messages)));chunk=[turn];
    attemptedTokens=memoryTokenCost(system)+memoryTokenCost(JSON.stringify(chunk.map(x=>x.messages)));
    if(attemptedTokens>summaryLimits.inputTokens){oversized=true;break;}
   }else chunk.push(turn);
  }
  if(!oversized&&chunk.length)inputs.push(JSON.stringify(chunk.map(x=>x.messages)));
  const fits=group.length>0&&!oversized;
  const previous=state.checkpoint;
  const resume=previous&&scopeKey(previous.scope)===scopeKey(scope)&&previous.timelineId===data.t.id&&previous.throughNodeId===group.at(-1)?.nodeId&&JSON.stringify(previous.turns)===JSON.stringify(group.map(x=>x.ref))&&JSON.stringify(previous.inputs)===JSON.stringify(inputs);
  if(fits&&!resume)state.checkpoint={scope:structuredClone(scope),timelineId:data.t.id,throughNodeId:group.at(-1)!.nodeId,turns:group.map(x=>x.ref),inputs,completed:[]};
  const job:MemorySummaryJob={id:crypto.randomUUID(),scope:structuredClone(scope),epoch:c.timelineEpoch??0,timelineId:data.t.id,snapshotHeadId:data.t.headNodeId!,throughNodeId:group.at(-1)?.nodeId??data.t.headNodeId!,status:fits?'running':'failed',startedAt:Date.now(),leaseUntil:Date.now()+Math.max(summaryLimits.leaseMs,inputs.length*75000),...(!fits?{...(!full?{diagnostic:{version:1 as const,stage:'input' as const,code:'input-budget' as const,inputRounds:inputs.length,pendingRounds:data.turns.length,inputTokenEstimate:attemptedTokens}}:{}),error:full?'capacity' as const:'input-too-large' as const,finishedAt:Date.now()}:{})};
  state.job=job;await db.conversations.update(c.id,{memorySummary:state});
  return fits?{job,turns:group.map(x=>x.ref),inputs}:undefined;
 });
}
async function fail(job:MemorySummaryJob,error:SummaryFailure,diagnostic?:SummaryDiagnostic){
 await db.transaction('rw',db.conversations,async()=>{const c=await db.conversations.get(job.scope.conversationId);if(c?.memorySummary?.job?.id!==job.id)return;const state=structuredClone(c.memorySummary);state.job={...state.job!,status:'failed',error,...(diagnostic?{diagnostic}:{}),finishedAt:Date.now()};await db.conversations.update(c.id,{memorySummary:state});});
}
async function execute(scope:MemoryScope,manual:boolean){
 let claimed:Claim|undefined;try{claimed=await claim(scope,manual);}catch(e){if(manual)throw e;return;}if(!claimed)return;
 const {job}=claimed;let failure:SummaryFailure='provider',diagnostic:SummaryDiagnostic|undefined;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(60000,claimed.inputs.length*70000));
 try{
  const c=await db.conversations.get(scope.conversationId);if(!c)throw Error('stale-path');
  const {config,key:apiKey}=await resolveApi(c);
  failure='format';const facts:SummaryFact[]=[];
  const stats={candidates:0,accepted:0,rejected:0,reasons:{} as Record<string,number>};
  for(let index=0;index<claimed.inputs.length;index++){
   const input=claimed.inputs[index];
   const saved=(await db.conversations.get(scope.conversationId))?.memorySummary?.checkpoint;
   if(saved&&saved.throughNodeId===job.throughNodeId&&saved.timelineId===job.timelineId&&saved.completed[index]){const part=saved.completed[index];facts.push(...part.facts);stats.candidates+=part.candidates;stats.accepted+=part.accepted;stats.rejected+=part.rejected;for(const [reason,count] of Object.entries(part.reasons))stats.reasons[reason]=(stats.reasons[reason]??0)+count;continue;}
   const before=facts.length;
   const raw=await requestSummary(config,apiKey,input,controller.signal);
   if(controller.signal.aborted||Date.now()>job.leaseUntil){failure='interrupted';throw Error('interrupted');}
   try{
    const parsed=parseSummary(raw),selected=selectSummaryCandidates(parsed,input);
    facts.push(...selected.accepted);stats.candidates+=parsed.length;stats.accepted+=selected.accepted.length;
    stats.rejected+=selected.rejected.length;
    const reasons:Record<string,number>={};
    for(const r of selected.rejected){stats.reasons[r.reason]=(stats.reasons[r.reason]??0)+1;reasons[r.reason]=(reasons[r.reason]??0)+1;}
    await db.transaction('rw',db.conversations,async()=>{const latest=await db.conversations.get(scope.conversationId);const state=latest?.memorySummary;if(!state||state.job?.id!==job.id||!state.checkpoint||state.checkpoint.throughNodeId!==job.throughNodeId)throw Error('stale-path');const next=structuredClone(state);next.checkpoint!.completed[index]={facts:facts.slice(before),candidates:parsed.length,accepted:selected.accepted.length,rejected:selected.rejected.length,reasons};await db.conversations.update(scope.conversationId,{memorySummary:next});});
   }catch(e){if((e as Error).message==='empty')failure='empty';if(e instanceof SummaryFormatError)diagnostic={...e.diagnostic,receivedChars:raw.length,outputTokenLimit:Math.min(config.maxTokens,summaryLimits.outputTokens)};throw e;}
  }
  job.selection=stats;

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
   for(const fact of facts){if(known.has(fact)){duplicates++;continue;}failure='capacity';await createMemory(scope,{kind:fact.quality?.importance==='high'&&['major-event','relationship','identity','boundary','ongoing-conflict','continuity'].includes(fact.quality.category)?'core':'long',source:'auto',content:`【${labels[fact.type]}】${fact.content}`});known.add(fact);added++;}
   state.checkpoint=undefined;state.revision++;state.receipts.push({id:job.id,revision:state.revision,scope:structuredClone(scope),epoch:job.epoch,timelineId:job.timelineId,throughNodeId:job.throughNodeId,turns:claimed!.turns,createdAt:Date.now(),added,duplicates,selection:job.selection});state.job={...job,status:'succeeded',finishedAt:Date.now(),added,duplicates};await db.conversations.update(current.id,{memorySummary:state});
  });
 }catch(error){if(error instanceof SummaryResponseError){diagnostic=error.diagnostic;failure=diagnostic.code==='truncated'?'format':'provider';}if(diagnostic)diagnostic={...diagnostic,inputRounds:claimed.turns.length,inputTokenEstimate:memoryTokenCost(system)+Math.max(...claimed.inputs.map(memoryTokenCost))};await fail(job,failure,diagnostic).catch(()=>{});}finally{clearTimeout(timer);}
}
const running=new Map<string,Promise<void>>();
export function runMemorySummary(scope:MemoryScope,manual=true){
 const old=running.get(scope.conversationId);if(old)return old;
 const task=Promise.resolve().then(()=>execute(scope,manual)).finally(()=>{if(running.get(scope.conversationId)===task)running.delete(scope.conversationId);});running.set(scope.conversationId,task);return task;
}
/** Called once after a normal successful reply; never on view mount or regenerate. */
export async function tryAutoSummary(conversationId:string){const c=await db.conversations.get(conversationId);if(c?.memorySummary?.enabled)void runMemorySummary(await getMemoryScope(conversationId),false);}
