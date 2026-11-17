import {db} from './store';
import {getSummaryApi} from './dedicatedSummaryApi';
import {listMemories,createMemory,visibleSummaryReceipts} from './memoryStore';
import {withSummaryLock} from './summaryLock';
import {requestSummary} from './memorySummaryRequest';
import {summaryVerifier} from './summarySourceFingerprint';
import {activeMessages} from './messagePath';
import type {MemoryScope} from './memoryTypes';

/** Independent second pass, never reverses a committed first-pass receipt.
 * A persisted attempt is written BEFORE calling the paid provider. Failed or
 * interrupted requests are not automatically retried.
 */
export async function maybeBuildCoreMemory(scope:MemoryScope,manual=false):Promise<void>{
 await withSummaryLock('claudia-core-summary:'+scope.conversationId,async()=>{
  const receipts=(await visibleSummaryReceipts(scope)).filter(r=>r.shortSummary?.trim());
  if(receipts.length<5)return;
  const existing=(await listMemories(scope,'core')).entries;
  // Find the earliest complete unprocessed batch, including historical backlog.
  // Never skip batches 1..N when multiple receipts arrived before this worker ran.
  let group=receipts.slice(0,5);
  for(let i=0;i+5<=receipts.length;i+=5){
   const candidate=receipts.slice(i,i+5);
   if(!existing.some(e=>e.sourceReceiptId===candidate[4].id)){group=candidate;break;}
   group=[];
  }
  if(group.length!==5)return;
  const anchor=group[4].id,sourceReceiptIds=group.map(r=>r.id);
  const conversation=await db.conversations.get(scope.conversationId);
  if(!conversation)return;
  if(memoryScopeKey(await getMemoryScope(scope.conversationId))!==memoryScopeKey(scope))return;
  const previous=conversation.memoryCoreAttempt;
  if(previous?.anchorReceiptId===anchor&&!manual)return;
  if(previous?.anchorReceiptId===anchor&&previous.status==='running'&&manual){
   // An interrupted remote call might already have been charged.
   // Only explicit recovery can issue another request.
  }
  const verify=summaryVerifier(await activeMessages(scope.conversationId));
  for(const receipt of group){
   const result=await verify(receipt);
   if(result!=='verified'&&result!=='legacy-verified')return;
  }
  const long=(await listMemories(scope,'long')).entries.filter(e=>e.source==='auto'&&sourceReceiptIds.includes(e.sourceReceiptId??''));
  if(!long.length)return;
  const character=await db.characters.get(scope.characterId);
  const input=JSON.stringify({character:character?.name??'',longTermMemories:long.map(e=>e.content)});
  const {config,key}=await getSummaryApi(scope);
  const startedAt=Date.now();
  await db.conversations.update(scope.conversationId,{memoryCoreAttempt:{anchorReceiptId:anchor,sourceReceiptIds,status:'running',startedAt}});
  try{
   const result=await requestSummary(config,key,input,new AbortController().signal,false,'core');
   if(memoryScopeKey(await getMemoryScope(scope.conversationId))!==memoryScopeKey(scope))throw Error('core-scope-changed');
   const current=(await visibleSummaryReceipts(scope)).filter(r=>r.shortSummary?.trim());
   const currentIds=new Set(current.map(r=>r.id));
   if(sourceReceiptIds.some(id=>!currentIds.has(id)))throw Error('core-source-changed');
   const now=await db.conversations.get(scope.conversationId);
   if(now?.memoryCoreAttempt?.anchorReceiptId!==anchor)throw Error('core-attempt-changed');
   const latest=await listMemories(scope,'core');
   if(!latest.entries.some(e=>e.sourceReceiptId===anchor)){
    const check=summaryVerifier(await activeMessages(scope.conversationId));
    for(const receipt of group){
     const status=await check(receipt);
     if(status!=='verified'&&status!=='legacy-verified')throw Error('core-source-changed');
    }
    await createMemory(scope,{kind:'core',source:'auto',sourceReceiptId:anchor,content:result});
   }
   await db.conversations.update(scope.conversationId,{memoryCoreAttempt:{anchorReceiptId:anchor,sourceReceiptIds,status:'succeeded',startedAt,finishedAt:Date.now()}});
  }catch(error){
   const now=await db.conversations.get(scope.conversationId);
   if(now?.memoryCoreAttempt?.anchorReceiptId===anchor)
    await db.conversations.update(scope.conversationId,{memoryCoreAttempt:{anchorReceiptId:anchor,sourceReceiptIds,status:'failed',startedAt,finishedAt:Date.now()}});
   throw error;
  }
 });
}
/** Explicit user-initiated recovery. May incur a new provider charge. */
export async function retryCoreMemory(scope:MemoryScope){
 return maybeBuildCoreMemory(scope,true);
}
