import {describeReplyFailure} from './replyFailure';
import {enqueueAutomation} from './automationQueue';
import {timelineTables} from './timelines';
import {setAutomationPreflight,armAutomationTimeout} from './automationRequests';
import {db} from './store';
import {getSummaryApi} from './dedicatedSummaryApi';
import {listMemories,createMemory,visibleSummaryReceipts,getMemoryScope,listMemoryRevisions} from './memoryStore';
import {memoryScopeKey} from './memoryScopeKey';
import {withSummaryLock} from './summaryLock';
import {requestSummary} from './memorySummaryRequest';
import {summaryVerifier} from './summarySourceFingerprint';
import {activeMessages} from './messagePath';
import type {MemoryScope} from './memoryTypes';

/** Independent second pass, never reverses a committed first-pass receipt.
 * A persisted attempt is written BEFORE calling the paid provider. Failed or
 * interrupted requests are not automatically retried.
 */
export async function maybeBuildCoreMemory(scope:MemoryScope,manual=false,admitted:()=>boolean=()=>true):Promise<void>{
 if(!admitted())return;
 await withSummaryLock('claudia-core-summary:'+scope.conversationId,async()=>{
  const receipts=(await visibleSummaryReceipts(scope)).filter(r=>r.shortSummary?.trim());
  if(receipts.length<5)return;
  const existing=(await listMemoryRevisions(scope)).filter(e=>e.kind==='core');
  // Find the earliest complete unprocessed batch, including historical backlog.
  // Never skip batches 1..N when multiple receipts arrived before this worker ran.
  const processed=new Set(existing.map(e=>e.sourceReceiptId));
  const availableLong=(await listMemories(scope,'long')).entries.filter(e=>e.source==='auto');
  const availableSources=new Set(availableLong.map(e=>e.sourceReceiptId));
  let group:typeof receipts=[];
  for(let i=0;i+5<=receipts.length;i+=5){
   const candidate=receipts.slice(i,i+5);
   if(processed.has(candidate[4].id))continue;
   // Keep an incomplete/deleted-source group untouched, but do not let it
   // permanently block later complete groups (including duplicate-only receipts).
   if(candidate.some(r=>!availableSources.has(r.id)))continue;
   group=candidate;break;
  }
  if(group.length!==5)return;
  const anchor=group[4].id,sourceReceiptIds=group.map(r=>r.id);
  const conversation=await db.conversations.get(scope.conversationId);
  if(!conversation)return;
  if(memoryScopeKey(await getMemoryScope(scope.conversationId))!==memoryScopeKey(scope))return;
  const previous=conversation.memoryCoreAttempt;
  if(previous?.anchorReceiptId===anchor&&!manual){
   if(previous.status==='succeeded')return;
   if(previous.status==='running'){if(Date.now()-previous.startedAt<30*60000)return;await db.conversations.update(scope.conversationId,{memoryCoreAttempt:{...previous,status:'failed',finishedAt:Date.now()}});return;}
   if(Date.now()-(previous.finishedAt??previous.startedAt)<30*60000||(previous.attempts??1)>=2)return;
  }
  const attempts=manual?1:previous?.anchorReceiptId===anchor?(previous.attempts??1)+1:1;
  if(previous?.anchorReceiptId===anchor&&previous.status==='running'&&manual){
   // An interrupted remote call might already have been charged.
   // Only explicit recovery can issue another request.
  }
  const verify=summaryVerifier(await activeMessages(scope.conversationId));
  for(const receipt of group){
   const result=await verify(receipt);
   if(result!=='verified'&&result!=='legacy-verified')return;
  }
  const long=availableLong.filter(e=>sourceReceiptIds.includes(e.sourceReceiptId??''));
  // Never distill a partial five-receipt group: a deleted, edited or capacity-
  // suppressed long-term entry cannot silently masquerade as complete evidence.
  if(sourceReceiptIds.some(id=>!long.some(e=>e.sourceReceiptId===id)))return;
  if(!long.length)return;
  const signature=(entries:typeof long)=>JSON.stringify(entries.map(e=>[e.id,e.revision,e.content]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  const originalLong=signature(long);
  const validateLong=async()=>{const current=(await listMemories(scope,'long')).entries.filter(e=>e.source==='auto'&&sourceReceiptIds.includes(e.sourceReceiptId??''));if(signature(current)!==originalLong)throw Error('core-source-changed');};
  const character=await db.characters.get(scope.characterId);
  const input=JSON.stringify({character:character?.name??'',longTermMemories:long.map(e=>e.content)});
  const startedAt=Date.now();
  await db.conversations.update(scope.conversationId,{memoryCoreAttempt:{anchorReceiptId:anchor,sourceReceiptIds,attempts,status:'running',startedAt}});
  const controller=new AbortController(),timeout=armAutomationTimeout(controller,120000);
  setAutomationPreflight(controller.signal,async()=>{if(!admitted())throw Error('核心记忆调度已停止，未发送请求');await validateLong();if(memoryScopeKey(await getMemoryScope(scope.conversationId))!==memoryScopeKey(scope)||(await db.conversations.get(scope.conversationId))?.memoryCoreAttempt?.anchorReceiptId!==anchor)throw Error('核心记忆任务已变化');const check=summaryVerifier(await activeMessages(scope.conversationId,undefined,true));for(const r of group){const valid=await check(r);if(valid!=='verified'&&valid!=='legacy-verified')throw Error('核心记忆来源已变化')}});
  try{
   const {config,key}=await getSummaryApi(scope);
   const result=await requestSummary(config,key,input,controller.signal,false,'core');
   if(controller.signal.aborted)throw Error('core-timeout');
   await db.transaction('rw',[...timelineTables(),db.characters,db.worlds,db.worldProfiles],async()=>{
   if(memoryScopeKey(await getMemoryScope(scope.conversationId))!==memoryScopeKey(scope))throw Error('core-scope-changed');
   const current=(await visibleSummaryReceipts(scope)).filter(r=>r.shortSummary?.trim());
   const currentIds=new Set(current.map(r=>r.id));
   if(sourceReceiptIds.some(id=>!currentIds.has(id)))throw Error('core-source-changed');
   const now=await db.conversations.get(scope.conversationId);
   if(now?.memoryCoreAttempt?.anchorReceiptId!==anchor)throw Error('core-attempt-changed');
   await validateLong();
   const latest=await listMemoryRevisions(scope);
   if(!latest.some(e=>e.kind==='core'&&e.sourceReceiptId===anchor)){
    const check=summaryVerifier(await activeMessages(scope.conversationId));
    for(const receipt of group){
     const status=await check(receipt);
     if(status!=='verified'&&status!=='legacy-verified')throw Error('core-source-changed');
    }
    await createMemory(scope,{kind:'core',source:'auto',sourceReceiptId:anchor,content:result});
   }
   await db.conversations.update(scope.conversationId,{memoryCoreAttempt:{anchorReceiptId:anchor,sourceReceiptIds,attempts,status:'succeeded',startedAt,finishedAt:Date.now()}});
   });
  }catch(error){
   const now=await db.conversations.get(scope.conversationId);
   if(now?.memoryCoreAttempt?.anchorReceiptId===anchor)
    await db.conversations.update(scope.conversationId,{memoryCoreAttempt:{anchorReceiptId:anchor,sourceReceiptIds,attempts,status:'failed',error:describeReplyFailure(error).reason,startedAt,finishedAt:Date.now()}});
   throw error;
  }finally{timeout();}
 });
}
/** Explicit user-initiated recovery. May incur a new provider charge. */
export async function retryCoreMemory(scope:MemoryScope){
 return maybeBuildCoreMemory(scope,true);
}

/** Continue historical five-group backlog at the fair queue tail, one request per turn. */
export function enqueueCoreMemory(scope:MemoryScope,admitted:()=>boolean=()=>true){
 return enqueueAutomation('core:'+scope.conversationId,async()=>{
  if(!admitted()||document.hidden||!navigator.onLine)return;
  const before=(await db.conversations.get(scope.conversationId))?.memoryCoreAttempt;
  await maybeBuildCoreMemory(scope,false,admitted);
  const after=(await db.conversations.get(scope.conversationId))?.memoryCoreAttempt;
  if(after?.status==='succeeded'&&(before?.anchorReceiptId!==after.anchorReceiptId||before?.status!=='succeeded'))setTimeout(()=>{if(admitted())void enqueueCoreMemory(scope,admitted)},0);
 });
}
