import {validateMemoryV2Fields} from './memoryV2Validation';
import {validateSummaryState} from './memorySummaryValidation';
import type Dexie from 'dexie';
import type {Conversation,MemoryTimeline} from './chatTypes';
import {memoryLimits,type MemoryStore,type MemoryScope} from './memoryTypes';
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<4096;
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
function check(ok:unknown):asserts ok{if(!ok)throw Error('记忆数据格式、归属或历史引用无效；未省略或改写记忆。');}
export function validMemoryScope(c:Conversation,scope:MemoryScope){
 if(!scope||scope.conversationId!==c.id||scope.characterId!==c.characterId||scope.mode!==c.mode)return false;
 return c.mode==='daily'? !c.worldId&&scope.spaceId==='daily'&&scope.worldId===undefined&&scope.timelineId===undefined&&scope.epoch===undefined:
 scope.mode==='world'&&!!c.worldId&&scope.worldId===c.worldId&&scope.spaceId===`world:${c.worldId}`&&id(scope.timelineId)&&integer(scope.epoch);
}
export async function validateMemoryStore(d:Dexie,c:Conversation){
 await validateMemoryV2Fields(d,c,validMemoryScope);
 await validateSummaryState(d,c,validMemoryScope);
 const state=c.memoryStore;if(state===undefined)return;
 check(state&&state.version===1&&integer(state.revision)&&Array.isArray(state.entries)&&Array.isArray(state.forks));
 check(state.entries.length<=memoryLimits.events&&state.forks.length<=memoryLimits.forks&&state.revision===state.entries.length);
 const timelines=new Map<string,MemoryTimeline>((await d.table('timelines').where('conversationId').equals(c.id).toArray()).map(t=>[t.id,t]));
 const forks=new Map<string,MemoryStore['forks'][number]>();
 const currentEpoch=c.timelineEpoch??0;
 for(const f of state.forks){check(f&&id(f.timelineId)&&integer(f.epoch)&&f.epoch<=currentEpoch&&integer(f.inheritThroughRevision)&&f.inheritThroughRevision<=state.revision&&!forks.has(f.timelineId));
  check((f.parentTimelineId===undefined||id(f.parentTimelineId))&&(f.sharedHeadNodeId===undefined||id(f.sharedHeadNodeId)));
  if(f.parentTimelineId===undefined)check(f.sharedHeadNodeId===undefined&&f.inheritThroughRevision===0);
  if(f.epoch===currentEpoch){const t=timelines.get(f.timelineId);check(t&&t.epoch===f.epoch&&t.characterId===c.characterId&&t.worldId===c.worldId&&t.parentTimelineId===f.parentTimelineId&&t.forkNodeId===f.sharedHeadNodeId);}
  forks.set(f.timelineId,f);
 }
 if(c.mode==='daily')check(!state.forks.length);
 const verifiedForks=new Set<string>();for(const f of state.forks){const seen=new Set<string>();let node:typeof f|undefined=f;while(node&&!verifiedForks.has(node.timelineId)){check(!seen.has(node.timelineId));seen.add(node.timelineId);if(!node.parentTimelineId)break;const parent=forks.get(node.parentTimelineId);check(parent&&parent.epoch===node.epoch);node=parent;}for(const id of seen)verifiedForks.add(id);}
 const receiptIds=new Set(c.memorySummary?.receipts.map(r=>r.id)??[]);
 const validIds=(ids:unknown)=>Array.isArray(ids)&&ids.length<=5000&&new Set(ids).size===ids.length&&ids.every(v=>id(v)&&receiptIds.has(v));
 if(state.shortHides!==undefined){check(Array.isArray(state.shortHides)&&state.shortHides.length<=memoryLimits.forks);const scopes=new Set<string>();for(const h of state.shortHides){check(validMemoryScope(c,h.scope)&&validIds(h.receiptIds));if(h.scope.mode==='world'){check(h.scope.epoch<=currentEpoch);if(h.scope.epoch===currentEpoch){const t=timelines.get(h.scope.timelineId);check(t&&t.epoch===currentEpoch&&t.conversationId===c.id&&t.worldId===c.worldId);}}const key=JSON.stringify([h.scope.mode,h.scope.mode==='world'?h.scope.timelineId:null,h.scope.mode==='world'?h.scope.epoch:null]);check(!scopes.has(key));scopes.add(key);}}
 for(const f of state.forks)if(f.hiddenSummaryIds!==undefined)check(validIds(f.hiddenSummaryIds));
 // Optional v1 magnetic metadata: legacy stores without tags remain valid.
 // Reject dangling revisions, malformed weights and unbounded metadata.
 if(state.tagRecords!==undefined){
  check(Array.isArray(state.tagRecords)&&state.tagRecords.length<=memoryLimits.events);
  const keys=new Set<string>();
  for(const record of state.tagRecords){
   check(record&&id(record.entryId)&&integer(record.revision)&&integer(record.taggedAt)&&Array.isArray(record.tags)&&record.tags.length<=32);
   check(state.entries.some(e=>e.id===record.entryId&&e.revision===record.revision));
   const key=record.entryId+':'+record.revision;check(!keys.has(key));keys.add(key);
   const unique=new Set<string>();
   for(const tag of record.tags){
    check(tag&&['keyword','emotion','topic','person'].includes(tag.axis)&&typeof tag.tag==='string'&&tag.tag.trim().length>0&&tag.tag.length<=80&&typeof tag.weight==='number'&&Number.isFinite(tag.weight)&&tag.weight>0&&tag.weight<=10);
    const label=tag.axis+':'+tag.tag;check(!unique.has(label));unique.add(label);
   }
  }
 }
 if(state.tagFailures!==undefined){
  check(Array.isArray(state.tagFailures)&&state.tagFailures.length<=memoryLimits.events);
  const keys=new Set<string>();
  for(const failure of state.tagFailures){
   check(failure&&id(failure.entryId)&&integer(failure.revision)&&integer(failure.attempts)&&failure.attempts>0&&integer(failure.lastFailedAt)&&typeof failure.reason==='string'&&failure.reason.length<=120);
   check(state.entries.some(e=>e.id===failure.entryId&&e.revision===failure.revision));
   const key=failure.entryId+':'+failure.revision;check(!keys.has(key));keys.add(key);
  }
 }
 // Message-level StarHub metadata is optional for old backups. Validate before
 // restoration or prompt injection; never silently accept malformed tag records.
 if(state.magneticZeroRuns!==undefined)check(integer(state.magneticZeroRuns)&&state.magneticZeroRuns<=1000000);
 if(state.magneticMessages!==undefined){
  check(Array.isArray(state.magneticMessages)&&state.magneticMessages.length<=memoryLimits.events);
  const keys=new Set<string>();
  for(const record of state.magneticMessages){
   check(record&&id(record.messageId)&&typeof record.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(record.fingerprint)&&validMemoryScope(c,record.scope)&&typeof record.summary==='string'&&record.summary.trim().length>0&&record.summary.length<=80&&typeof record.detail==='string'&&record.detail.length<=memoryLimits.entryChars&&integer(record.createdAt)&&integer(record.taggedAt)&&typeof record.active==='boolean'&&Array.isArray(record.tags)&&record.tags.length<=32);
   check(record.variantId===undefined||id(record.variantId));check(record.nodeId===undefined||id(record.nodeId));
   if(record.scope.mode==='world')check(record.scope.epoch<=currentEpoch);
   const key=record.messageId+':'+record.fingerprint;check(!keys.has(key));keys.add(key);
   const labels=new Set<string>();
   for(const tag of record.tags){
    check(tag&&['keyword','emotion','topic','person'].includes(tag.axis)&&typeof tag.tag==='string'&&tag.tag.trim().length>0&&tag.tag.length<=80&&typeof tag.weight==='number'&&Number.isFinite(tag.weight)&&tag.weight>0&&tag.weight<=10);
    const label=tag.axis+':'+tag.tag;check(!labels.has(label));labels.add(label);
   }
  }
 }
 if(state.magneticAttempts!==undefined){
  check(Array.isArray(state.magneticAttempts)&&state.magneticAttempts.length<=memoryLimits.events);
  const keys=new Set<string>();
  for(const attempt of state.magneticAttempts){
   check(attempt&&id(attempt.messageId)&&typeof attempt.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(attempt.fingerprint)&&['pending','failed'].includes(attempt.status)&&integer(attempt.startedAt)&& (attempt.reason===undefined||typeof attempt.reason==='string'&&attempt.reason.length<=120));
   const key=attempt.messageId+':'+attempt.fingerprint;check(!keys.has(key));keys.add(key);
  }
 }
 const paths=new Map<string,Set<string>>();
 async function path(t:MemoryTimeline){if(paths.has(t.id))return paths.get(t.id)!;const nodes=new Set<string>();let next=t.headNodeId;
  while(next){check(!nodes.has(next));nodes.add(next);const row=await d.table('pathNodes').get(next);check(row&&row.conversationId===c.id);next=row.parentNodeId;}
  paths.set(t.id,nodes);return nodes;
 }
 let chars=0;const known=new Set<string>();
 for(let i=0;i<state.entries.length;i++){const e=state.entries[i];check(e&&id(e.id)&&e.revision===i+1&&validMemoryScope(c,e.scope)&&['core','long'].includes(e.kind)&&['manual','auto'].includes(e.source)&&typeof e.deleted==='boolean'&&typeof e.content==='string'&&e.content.length<=memoryLimits.entryChars&&Number.isFinite(e.createdAt)&&e.createdAt>=0&&Number.isFinite(e.updatedAt)&&e.updatedAt>=e.createdAt);
  check(e.deleted?known.has(e.id)&&e.content==='':!!e.content.trim());chars+=e.content.length;check(chars<=memoryLimits.totalChars);known.add(e.id);
  if(e.scope.mode==='daily')check(e.anchorNodeId===undefined);
  else {check(e.scope.epoch<=currentEpoch);const f=forks.get(e.scope.timelineId);check(f&&f.epoch===e.scope.epoch&&e.revision>f.inheritThroughRevision);
   check(e.anchorNodeId===undefined||id(e.anchorNodeId));
   // Clearing a world conversation increments its existing epoch and removes its
   // old paths. Preserve retired provenance, but never resolve it as current memory.
   if(e.scope.epoch===currentEpoch){const t=timelines.get(e.scope.timelineId);check(t&&t.epoch===e.scope.epoch&&t.characterId===c.characterId&&t.worldId===c.worldId);if(e.anchorNodeId)check((paths.get(t.id)??await path(t)).has(e.anchorNodeId));}
  }
 }
}
