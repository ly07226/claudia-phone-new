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
 for(const f of state.forks){const seen=new Set<string>();let node:typeof f|undefined=f;while(node){check(!seen.has(node.timelineId));seen.add(node.timelineId);if(!node.parentTimelineId)break;const parent=forks.get(node.parentTimelineId);check(parent&&parent.epoch===node.epoch);node=parent;}}
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
   if(e.scope.epoch===currentEpoch){const t=timelines.get(e.scope.timelineId);check(t&&t.epoch===e.scope.epoch&&t.characterId===c.characterId&&t.worldId===c.worldId);if(e.anchorNodeId)check((await path(t)).has(e.anchorNodeId));}
  }
 }
}
