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
 return {ready:fresh.length>=threshold,pending:fresh.length,blocked:blocked.length,threshold,deadlight:(store?.magneticZeroRuns??0)>=2};
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
 const failures=new Set((state?.magneticAttempts??[]).map(r=>key(r.messageId,r.fingerprint)));
 return {total:rows.length,tagged:rows.filter(r=>completed.has(key(r.id,r.fingerprint))).length,failed:rows.filter(r=>failures.has(key(r.id,r.fingerprint))).length,zeroRuns:state?.magneticZeroRuns??0};
}
export async function tagMagneticMessages(scope:MemoryScope,provider:TagProvider,taxonomy:TagTaxonomy,batchSize=20,retry=false){
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100||!taxonomy||!Array.isArray(taxonomy.emotion)||!Array.isArray(taxonomy.topic)||!taxonomy.emotion.length||!taxonomy.topic.length)throw Error('invalid-magnet-batch');
 const rows=await source(scope),initial=await db.conversations.get(scope.conversationId);
 if(!initial)throw Error('magnet-conversation-missing');
 const state=initial.memoryStore??emptyMemoryStore();
 const done=new Set((state.magneticMessages??[]).filter(r=>r.active).map(r=>key(r.messageId,r.fingerprint)));
 const failures=new Set((state.magneticAttempts??[]).map(r=>key(r.messageId,r.fingerprint)));
 const pending=rows.filter(r=>!done.has(key(r.id,r.fingerprint))&&(retry?failures.has(key(r.id,r.fingerprint)):!failures.has(key(r.id,r.fingerprint)))).slice(0,batchSize);
 let tagged=0,failed=0,claimedCount=0;
 for(const row of pending){
  // Atomic per-message claim: a second tab must not call a paid provider for
  // the same message revision. Interrupted claims require explicit recovery.
  const claimed=await db.transaction('rw',db.conversations,async()=>{
    const c=await db.conversations.get(scope.conversationId);if(!c)throw Error('magnet-conversation-missing');
    if(c.characterId!==scope.characterId||c.mode!==scope.mode||(scope.mode==='world'&&(c.worldId!==scope.worldId||c.activeTimelineId!==scope.timelineId||(c.timelineEpoch??0)!==scope.epoch)))throw Error('magnet-scope-changed');
    const store=c.memoryStore??emptyMemoryStore();
    if((store.magneticMessages??[]).some(x=>x.active&&x.messageId===row.id&&x.fingerprint===row.fingerprint))return false;
    const existing=(store.magneticAttempts??[]).find(x=>x.messageId===row.id&&x.fingerprint===row.fingerprint);
    if(retry?existing?.status!=='failed':!!existing)return false;
    const attempts=(store.magneticAttempts??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint);
    attempts.push({messageId:row.id,fingerprint:row.fingerprint,status:'pending',startedAt:Date.now()});
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
   await db.transaction('rw',db.conversations,async()=>{
    const c=await db.conversations.get(scope.conversationId);if(!c)throw Error('magnet-conversation-missing');
    if(c.characterId!==scope.characterId||c.mode!==scope.mode||(scope.mode==='world'&&(c.worldId!==scope.worldId||c.activeTimelineId!==scope.timelineId||(c.timelineEpoch??0)!==scope.epoch)))throw Error('magnet-scope-changed');
    const store=c.memoryStore??emptyMemoryStore();
    const record:MagneticMessageMemory={messageId:row.id,variantId:row.variantId,nodeId:row.nodeId,fingerprint:row.fingerprint,scope,summary:result.summary,detail:'',tags,createdAt:row.createdAt,taggedAt:Date.now(),active:true};
    await db.conversations.update(c.id,{memoryStore:{...store,magneticMessages:[...(store.magneticMessages??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint),record],magneticAttempts:(store.magneticAttempts??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint)}});
   });
   tagged++;
  }catch(error){
   failed++;
   await db.transaction('rw',db.conversations,async()=>{
    const c=await db.conversations.get(scope.conversationId);if(!c)return;
    const store=c.memoryStore??emptyMemoryStore();
    const attempts=(store.magneticAttempts??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint);
    attempts.push({messageId:row.id,fingerprint:row.fingerprint,status:'failed',startedAt:Date.now(),reason:error instanceof Error?error.name.slice(0,100):'UnknownError'});
    await db.conversations.update(c.id,{memoryStore:{...store,magneticAttempts:attempts}});
   });
  }
 }
 if(claimedCount){
  await db.transaction('rw',db.conversations,async()=>{
   const c=await db.conversations.get(scope.conversationId);if(!c)return;
   const store=c.memoryStore??emptyMemoryStore();
   const count=tagged?0:(store.magneticZeroRuns??0)+1;
   await db.conversations.update(c.id,{memoryStore:{...store,magneticZeroRuns:count}});
  });
 }
 return {seen:claimedCount,tagged,failed,deadlight:claimedCount>0&&tagged===0&&(state.magneticZeroRuns??0)>=1};
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
