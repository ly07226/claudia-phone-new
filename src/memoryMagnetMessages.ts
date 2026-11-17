import {db} from './store';
import {activeMessages} from './messagePath';
import {visibleMessage} from './messageBubbles';
import {nodesForHead} from './timelines';
import {emptyMemoryStore,type MemoryScope,type MagneticMessageMemory} from './memoryTypes';
import type {Message} from './chatTypes';
import {validateTagging,type TagProvider,type TagTaxonomy} from './memoryMagnetTagger';

/** StarHub message-source tagging. The selected chat path, not the Float
 * summary, is the source of truth. Never tag hidden variants or other worlds.
 * Manual batch only until cross-window leases and scheduler are verified.
 */
const key=(id:string,fingerprint:string)=>id+':'+fingerprint;
/** A pending claim may still be running in another tab. Never retry it immediately. */
export const MAGNET_PENDING_RECOVERY_MS=30*60*1000;
export function canRecoverMagneticAttempt(attempt:{status:'pending'|'failed';startedAt:number}|undefined,now:number){
 return !!attempt&&(attempt.status==='failed'||attempt.status==='pending'&&Number.isFinite(attempt.startedAt)&&now-attempt.startedAt>=MAGNET_PENDING_RECOVERY_MS);
}
async function digest(text:string){
 const bytes=new TextEncoder().encode(text);
 const result=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(result)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function source(scope:MemoryScope){
 const c=await db.conversations.get(scope.conversationId);
 if(!c||c.characterId!==scope.characterId||c.mode!==scope.mode||scope.mode==='world'&&(c.worldId!==scope.worldId||c.activeTimelineId!==scope.timelineId||(c.timelineEpoch??0)!==scope.epoch))throw Error('magnet-scope-changed');
 const timeline=scope.mode==='world'?await db.timelines.get(scope.timelineId):c.activeTimelineId?await db.timelines.get(c.activeTimelineId):undefined;
 const nodes=timeline?await nodesForHead(c.id,timeline.headNodeId):[];
 const raw=nodes.length?nodes.map(n=>({message:n.message,nodeId:n.id})):scope.mode==='daily'?(await activeMessages(c.id)).map(message=>({message,nodeId:undefined})): [];
 const rows=[] as {id:string;variantId?:string;nodeId?:string;content:string;createdAt:number;fingerprint:string}[];
 for(const row of raw){
  const m=visibleMessage(row.message);
  if((m.role!=='user'&&m.role!=='assistant')||!m.content.trim())continue;
  const fingerprint=await digest(JSON.stringify([m.id,m.activeVariantId??'',m.content]));
  rows.push({id:m.id,variantId:m.activeVariantId,nodeId:row.nodeId,content:m.content,createdAt:m.createdAt,fingerprint});
 }
 return rows;
}
/** Derived contiguous checkpoint, not a mutable global last-id. An edited,
 * failed or interrupted source revision stops advancement; later successes
 * remain stored and can be recovered without skipping the gap.
 */
/** A failed batch must be visible immediately; two consecutive zero-success
 * batches raise the deadlight. No new attempts means no state transition. */
export function magneticBatchHealth(previousZeroRuns:number,claimed:number,tagged:number){
 const zeroRuns=claimed===0?previousZeroRuns:tagged>0?0:previousZeroRuns+1;
 return {zeroRuns,deadlight:zeroRuns>=2};
}
export function magneticWatermark(rows:{id:string;fingerprint:string}[],completed:ReadonlySet<string>){
 let throughMessageId:string|undefined;
 let throughFingerprint:string|undefined;
 let processed=0;
 for(const row of rows){
  if(!completed.has(key(row.id,row.fingerprint)))break;
  throughMessageId=row.id;
  throughFingerprint=row.fingerprint;
  processed++;
 }
 return {processed,throughMessageId,throughFingerprint};
}
/** Counts are based on the selected message path, never local-calendar days.
 * Threshold is advisory; calling this function cannot spend API tokens.
 */
export async function magneticBatchReadiness(scope:MemoryScope,threshold=20){
 const rows=await source(scope),c=await db.conversations.get(scope.conversationId);
 const store=c?.memoryStore;
 const completed=new Set((store?.magneticMessages??[]).filter(r=>r.active).map(r=>key(r.messageId,r.fingerprint)));
 const attempted=new Set((store?.magneticAttempts??[]).map(r=>key(r.messageId,r.fingerprint)));
 const fresh=rows.filter(r=>!completed.has(key(r.id,r.fingerprint))&&!attempted.has(key(r.id,r.fingerprint)));
 const blocked=rows.filter(r=>attempted.has(key(r.id,r.fingerprint))&&!completed.has(key(r.id,r.fingerprint)));
 const watermark=magneticWatermark(rows,completed);
 return {ready:fresh.length>=threshold,pending:fresh.length,blocked:blocked.length,threshold,watermark,deadlight:(store?.magneticZeroRuns??0)>=2};
}
export async function recentMagneticMessages(scope:MemoryScope,limit=20){
 const rows=await source(scope),c=await db.conversations.get(scope.conversationId);
 const active=new Set(rows.map(r=>key(r.id,r.fingerprint)));
 return (c?.memoryStore?.magneticMessages??[]).filter(r=>r.active&&active.has(key(r.messageId,r.fingerprint))&&r.scope.conversationId===scope.conversationId&&r.scope.characterId===scope.characterId&&r.scope.mode===scope.mode&&(scope.mode==='daily'||r.scope.mode==='world'&&r.scope.worldId===scope.worldId&&r.scope.epoch===scope.epoch)).slice(-Math.min(20,Math.max(1,limit))).reverse();
}
export async function magneticMessageStatus(scope:MemoryScope){
 const [rows,c]=await Promise.all([source(scope),db.conversations.get(scope.conversationId)]);
 const state=c?.memoryStore;
 const completed=new Set((state?.magneticMessages??[]).filter(r=>r.active).map(r=>key(r.messageId,r.fingerprint)));
 const failures=new Set((state?.magneticAttempts??[]).filter(r=>r.status==='failed'||r.status==='pending').map(r=>key(r.messageId,r.fingerprint)));
 return {total:rows.length,tagged:rows.filter(r=>completed.has(key(r.id,r.fingerprint))).length,failed:rows.filter(r=>failures.has(key(r.id,r.fingerprint))).length,zeroRuns:state?.magneticZeroRuns??0};
}
export async function tagMagneticMessages(scope:MemoryScope,provider:TagProvider,taxonomy:TagTaxonomy,batchSize=20,retry=false){
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100||!taxonomy||!Array.isArray(taxonomy.emotion)||!Array.isArray(taxonomy.topic)||!taxonomy.emotion.length||!taxonomy.topic.length)throw Error('invalid-magnet-batch');
 const rows=await source(scope),initial=await db.conversations.get(scope.conversationId);
 if(!initial)throw Error('magnet-conversation-missing');
 const state=initial.memoryStore??emptyMemoryStore();
 const done=new Set((state.magneticMessages??[]).filter(r=>r.active).map(r=>key(r.messageId,r.fingerprint)));
 const failures=new Set((state.magneticAttempts??[]).filter(r=>r.status==='failed'||r.status==='pending').map(r=>key(r.messageId,r.fingerprint)));
 const attempts=new Set((state.magneticAttempts??[]).map(r=>key(r.messageId,r.fingerprint)));
 const pending=rows.filter(r=>!done.has(key(r.id,r.fingerprint))&&(retry?canRecoverMagneticAttempt((state.magneticAttempts??[]).find(x=>x.messageId===r.id&&x.fingerprint===r.fingerprint),Date.now()):!attempts.has(key(r.id,r.fingerprint)))).slice(0,batchSize);
 let tagged=0,failed=0,claimedCount=0;
 for(const row of pending){
  // Atomic per-message claim: a second tab must not call a paid provider for
  // the same message revision. Interrupted claims require explicit recovery.
  const claimId=crypto.randomUUID();
  const claimed=const saved=await db.transaction('rw',db.conversations,async()=>{
    const c=await db.conversations.get(scope.conversationId);if(!c)throw Error('magnet-conversation-missing');
    if(c.characterId!==scope.characterId||c.mode!==scope.mode||(scope.mode==='world'&&(c.worldId!==scope.worldId||c.activeTimelineId!==scope.timelineId||(c.timelineEpoch??0)!==scope.epoch)))throw Error('magnet-scope-changed');
    const store=c.memoryStore??emptyMemoryStore();
    if((store.magneticMessages??[]).some(x=>x.active&&x.messageId===row.id&&x.fingerprint===row.fingerprint))return false;
    const existing=(store.magneticAttempts??[]).find(x=>x.messageId===row.id&&x.fingerprint===row.fingerprint);
    if(retry?!canRecoverMagneticAttempt(existing,Date.now()):!!existing)return false;
    const startedAt=Date.now();
    const attempts=(store.magneticAttempts??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint);
    attempts.push({messageId:row.id,fingerprint:row.fingerprint,status:'pending',startedAt,claimId});
    await db.conversations.update(c.id,{memoryStore:{...store,magneticAttempts:attempts}});
    return true;
   });
  if(!claimed)continue;
  claimedCount++;
  try{
   const result=await provider(row.content,taxonomy);
   const tags=validateTagging(result,taxonomy);
   const current=(await source(scope)).find(x=>x.id===row.id);
   if(!current||current.fingerprint!==row.fingerprint)throw Error('source-changed');
   const saved=await db.transaction('rw',db.conversations,async()=>{
    const c=await db.conversations.get(scope.conversationId);if(!c)throw Error('magnet-conversation-missing');
    if(c.characterId!==scope.characterId||c.mode!==scope.mode||(scope.mode==='world'&&(c.worldId!==scope.worldId||c.activeTimelineId!==scope.timelineId||(c.timelineEpoch??0)!==scope.epoch)))throw Error('magnet-scope-changed');
    const store=c.memoryStore??emptyMemoryStore();
    if(!(store.magneticAttempts??[]).some(x=>x.messageId===row.id&&x.fingerprint===row.fingerprint&&x.status==='pending'&&x.claimId===claimId))return false;
    const record:MagneticMessageMemory={messageId:row.id,variantId:row.variantId,nodeId:row.nodeId,fingerprint:row.fingerprint,scope,summary:result.summary,detail:'',tags,createdAt:row.createdAt,taggedAt:Date.now(),active:true};
    await db.conversations.update(c.id,{memoryStore:{...store,magneticMessages:[...(store.magneticMessages??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint),record],magneticAttempts:(store.magneticAttempts??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint)}});
    return true;
   });
   if(saved)tagged++;
  }catch(error){
   failed++;
   await db.transaction('rw',db.conversations,async()=>{
    const c=await db.conversations.get(scope.conversationId);if(!c)return;
    // A cleared or switched world must not receive a failed-job write from
    // the previous timeline. Its old pending claim remains for explicit audit.
    if(c.characterId!==scope.characterId||c.mode!==scope.mode||(scope.mode==='world'&&(c.worldId!==scope.worldId||c.activeTimelineId!==scope.timelineId||(c.timelineEpoch??0)!==scope.epoch)))return;
    const store=c.memoryStore??emptyMemoryStore();
    if(!(store.magneticAttempts??[]).some(x=>x.messageId===row.id&&x.fingerprint===row.fingerprint&&x.status==='pending'&&x.claimId===claimId))return;
    const attempts=(store.magneticAttempts??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint);
    attempts.push({messageId:row.id,fingerprint:row.fingerprint,status:'failed',startedAt:Date.now(),claimId,reason:error instanceof Error?error.name.slice(0,100):'UnknownError'});
    await db.conversations.update(c.id,{memoryStore:{...store,magneticAttempts:attempts}});
   });
  }
 }
 if(claimedCount){
  await db.transaction('rw',db.conversations,async()=>{
   const c=await db.conversations.get(scope.conversationId);if(!c)return;
   if(c.characterId!==scope.characterId||c.mode!==scope.mode||(scope.mode==='world'&&(c.worldId!==scope.worldId||c.activeTimelineId!==scope.timelineId||(c.timelineEpoch??0)!==scope.epoch)))return;
   const store=c.memoryStore??emptyMemoryStore();
   const count=magneticBatchHealth(store.magneticZeroRuns??0,claimedCount,tagged).zeroRuns;
   await db.conversations.update(c.id,{memoryStore:{...store,magneticZeroRuns:count}});
  });
 }
 const final=await db.conversations.get(scope.conversationId);
 return {seen:claimedCount,tagged,failed,deadlight:(final?.memoryStore?.magneticZeroRuns??0)>=2};
}

/** Only live source-path records may be recalled; changed/deleted messages
 * are excluded even if a historical tag remains in the journal.
 */
export async function visibleMagneticMemories(scope:MemoryScope):Promise<MagneticMessageMemory[]>{
 const [rows,c]=await Promise.all([source(scope),db.conversations.get(scope.conversationId)]);
 const live=new Set(rows.map(r=>key(r.id,r.fingerprint)));
 return (c?.memoryStore?.magneticMessages??[]).filter(r=>r.active&&r.scope.conversationId===scope.conversationId&&r.scope.characterId===scope.characterId&&r.scope.mode===scope.mode&&
  (scope.mode==='daily'||r.scope.mode==='world'&&r.scope.worldId===scope.worldId&&r.scope.epoch===scope.epoch)&&live.has(key(r.messageId,r.fingerprint)));
}

/** Fast read-only retrieval for the existing prompt assembler.
 * Avoid rewalking the full timeline and hashing every message on each turn:
 * shortlist by tag, then verify only matched source messages in the supplied
 * request prefix. No IndexedDB reads or writes.
 */
export async function magneticFromRequestPrefix(scope:MemoryScope,records:MagneticMessageMemory[],requestPath:Message[],query:string){
 const q=query.normalize('NFKC').toLowerCase();
 if(!q.trim())return [];
 const byId=new Map(requestPath.map(m=>[m.id,visibleMessage(m)]));
 const result:MagneticMessageMemory[]=[];
 for(const record of records){
  if(!record.active||record.scope.conversationId!==scope.conversationId||record.scope.characterId!==scope.characterId||record.scope.mode!==scope.mode)continue;
  if(scope.mode==='world'&&(record.scope.mode!=='world'||record.scope.worldId!==scope.worldId||record.scope.epoch!==scope.epoch))continue;
  if(!record.tags.some(t=>t.tag.trim()&&q.includes(t.tag.normalize('NFKC').toLowerCase())))continue;
  const m=byId.get(record.messageId);
  if(!m||m.activeVariantId!==record.variantId)continue;
  const fingerprint=await digest(JSON.stringify([m.id,m.activeVariantId??'',m.content]));
  if(fingerprint===record.fingerprint)result.push(record);
 }
 return result;
}
