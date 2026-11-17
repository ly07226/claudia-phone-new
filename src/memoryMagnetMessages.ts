import {db} from './store';
import {activeMessages} from './messagePath';
import {visibleMessage} from './messageBubbles';
import {nodesForHead} from './timelines';
import {getMemoryScope} from './memoryStore';
import type {MemoryScope,MagneticMessageMemory,MagneticTagAttempt} from './memoryTypes';
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
 if(!c||c.characterId!==scope.characterId||c.mode!==scope.mode||scope.mode==='world'&&(c.worldId!==scope.worldId||c.activeTimelineId!==scope.timelineId||c.timelineEpoch!==scope.epoch))throw Error('magnet-scope-changed');
 const timeline=scope.mode==='world'?await db.timelines.get(scope.timelineId):c.activeTimelineId?await db.timelines.get(c.activeTimelineId):undefined;
 const nodes=timeline?await nodesForHead(c.id,timeline.headNodeId):[];
 const raw=nodes.length?nodes.map(n=>({message:n.message,nodeId:n.id})):scope.mode==='daily'?(await activeMessages(c.id)).map(message=>({message,nodeId:undefined})): [];
 const rows=[] as {id:string;variantId?:string;nodeId?:string;content:string;createdAt:number;fingerprint:string}[];
 for(const row of raw){
  const m=visibleMessage(row.message);
  if(m.role!=='user'&&m.role!=='assistant'||!m.content.trim())continue;
  const fingerprint=await digest(JSON.stringify([m.id,m.activeVariantId??'',m.content]));
  rows.push({id:m.id,variantId:m.activeVariantId,nodeId:row.nodeId,content:m.content,createdAt:m.createdAt,fingerprint});
 }
 return rows;
}
export async function magneticMessageStatus(scope:MemoryScope){
 const [rows,c]=await Promise.all([source(scope),db.conversations.get(scope.conversationId)]);
 const state=c?.memoryStore;
 const completed=new Set((state?.magneticMessages??[]).filter(r=>r.active).map(r=>key(r.messageId,r.fingerprint)));
 const failures=new Set((state?.magneticAttempts??[]).map(r=>key(r.messageId,r.fingerprint)));
 return {total:rows.length,tagged:rows.filter(r=>completed.has(key(r.id,r.fingerprint))).length,failed:rows.filter(r=>failures.has(key(r.id,r.fingerprint))).length,zeroRuns:state?.magneticZeroRuns??0};
}
export async function tagMagneticMessages(scope:MemoryScope,provider:TagProvider,taxonomy:TagTaxonomy,batchSize=20,retry=false){
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100||!taxonomy.emotion.length||!taxonomy.topic.length)throw Error('invalid-magnet-batch');
 const rows=await source(scope),initial=await db.conversations.get(scope.conversationId);
 const state=initial?.memoryStore;if(!state)throw Error('memory-store-unavailable');
 const done=new Set((state.magneticMessages??[]).filter(r=>r.active).map(r=>key(r.messageId,r.fingerprint)));
 const failures=new Set((state.magneticAttempts??[]).map(r=>key(r.messageId,r.fingerprint)));
 const pending=rows.filter(r=>!done.has(key(r.id,r.fingerprint))&&(retry?failures.has(key(r.id,r.fingerprint)):!failures.has(key(r.id,r.fingerprint)))).slice(0,batchSize);
 let tagged=0,failed=0;
 for(const row of pending){
  try{
   await db.transaction('rw',db.conversations,async()=>{
    const c=await db.conversations.get(scope.conversationId);if(!c?.memoryStore)throw Error('memory-store-unavailable');
    const store=c.memoryStore;
    const attempts=(store.magneticAttempts??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint);
    attempts.push({messageId:row.id,fingerprint:row.fingerprint,status:'pending',startedAt:Date.now()});
    await db.conversations.update(c.id,{memoryStore:{...store,magneticAttempts:attempts}});
   });
   const result=await provider(row.content,taxonomy);
   const tags=validateTagging(result,taxonomy);
   const current=(await source(scope)).find(x=>x.id===row.id);
   if(!current||current.fingerprint!==row.fingerprint)throw Error('source-changed');
   await db.transaction('rw',db.conversations,async()=>{
    const c=await db.conversations.get(scope.conversationId);if(!c?.memoryStore)throw Error('memory-store-unavailable');
    const store=c.memoryStore;
    const record:MagneticMessageMemory={messageId:row.id,variantId:row.variantId,nodeId:row.nodeId,fingerprint:row.fingerprint,scope,summary:result.summary,detail:row.content,tags,createdAt:row.createdAt,taggedAt:Date.now(),active:true};
    await db.conversations.update(c.id,{memoryStore:{...store,magneticMessages:[...(store.magneticMessages??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint),record],magneticAttempts:(store.magneticAttempts??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint)}});
   });
   tagged++;
  }catch(error){
   failed++;
   await db.transaction('rw',db.conversations,async()=>{
    const c=await db.conversations.get(scope.conversationId);if(!c?.memoryStore)return;
    const store=c.memoryStore;
    const attempts=(store.magneticAttempts??[]).filter(x=>x.messageId!==row.id||x.fingerprint!==row.fingerprint);
    attempts.push({messageId:row.id,fingerprint:row.fingerprint,status:'failed',startedAt:Date.now(),reason:error instanceof Error?error.name.slice(0,100):'UnknownError'});
    await db.conversations.update(c.id,{memoryStore:{...store,magneticAttempts:attempts}});
   });
  }
 }
 if(pending.length){
  await db.transaction('rw',db.conversations,async()=>{
   const c=await db.conversations.get(scope.conversationId);if(!c?.memoryStore)return;
   const count=tagged?0:(c.memoryStore.magneticZeroRuns??0)+1;
   await db.conversations.update(c.id,{memoryStore:{...c.memoryStore,magneticZeroRuns:count}});
  });
 }
 return {seen:pending.length,tagged,failed,deadlight:pending.length>0&&tagged===0&&(state.magneticZeroRuns??0)>=1};
}
