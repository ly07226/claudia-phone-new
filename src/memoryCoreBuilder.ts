import {db} from './store';
import {getSummaryApi} from './dedicatedSummaryApi';
import {listMemories,createMemory,visibleSummaryReceipts} from './memoryStore';
import {withSummaryLock} from './summaryLock';
import {requestSummary} from './memorySummaryRequest';
import type {MemoryScope} from './memoryTypes';

/** Float-style second pass: five successful long-term summary receipts -> one core.
 * This pipeline is independent: a failed core request never reverses the first pass.
 * Core anchor is the fifth receipt ID, so restarts cannot silently re-bill it.
 */
export async function maybeBuildCoreMemory(scope:MemoryScope):Promise<void>{
 await withSummaryLock('claudia-core-summary:'+scope.conversationId,async()=>{
  const receipts=(await visibleSummaryReceipts(scope)).filter(r=>r.shortSummary?.trim());
  if(receipts.length<5||receipts.length%5!==0)return;
  const group=receipts.slice(-5),anchor=group[4].id;
  const existing=(await listMemories(scope,'core')).entries;
  if(existing.some(e=>e.sourceReceiptId===anchor))return;
  const long=(await listMemories(scope,'long')).entries.filter(e=>e.source==='auto'&&group.some(r=>r.id===e.sourceReceiptId));
  if(!long.length)return;
  const conversation=await db.conversations.get(scope.conversationId);
  if(!conversation)return;
  const character=await db.characters.get(scope.characterId);
  const input=JSON.stringify({character:character?.name??'',longTermMemories:long.map(e=>e.content)});
  const {config,key}=await getSummaryApi(scope);
  const result=await requestSummary(config,key,input,new AbortController().signal,false,'core');
  // Check the exact batch and timeline again after the paid call.
  const current=(await visibleSummaryReceipts(scope)).filter(r=>r.shortSummary?.trim());
  if(current.length!==receipts.length||current.slice(-5).some((r,i)=>r.id!==group[i].id))return;
  if((await listMemories(scope,'core')).entries.some(e=>e.sourceReceiptId===anchor))return;
  await createMemory(scope,{kind:'core',source:'auto',sourceReceiptId:anchor,content:result});
 });
}
