import {memoryScopeKey} from './memoryScopeKey';
import type {SummaryReceipt} from './memorySummaryTypes';
import {summaryVerifier} from './summarySourceFingerprint';
import {db} from './store';
import {activeMessages} from './messagePath';
import {visibleMessage} from './messageBubbles';
import {timelineTables,timelineSpace,ensureTimelineInTransaction,getTimelineAncestors,nodesForHead} from './timelines';
import type {Conversation,MemoryTimeline} from './chatTypes';
import {emptyMemoryStore,memoryLimits,type MemoryScope,type MemoryEntry,type MemoryStore,type MemoryInput,type EffectiveMemory,type ShortMemory} from './memoryTypes';
import {validMemoryScope,validateMemoryStore} from './memoryValidation';
const tables=()=>[...timelineTables(),db.characters,db.worlds,db.worldProfiles];
async function owner(id:string){
 const c=await db.conversations.get(id);if(!c||!await db.characters.get(c.characterId))throw Error('记忆所属会话或角色不存在。');
 if(c.mode==='daily'){if(c.worldId)throw Error('日常记忆作用域异常。');}
 else if(c.mode!=='world'||!c.worldId||!await db.worlds.get(c.worldId)||!await db.worldProfiles.where('[worldId+characterId]').equals([c.worldId,c.characterId]).first())throw Error('记忆所属世界或角色关联无效。');
 return c;
}
async function checked(scope:MemoryScope){
 const c=await owner(scope.conversationId);if(!validMemoryScope(c,scope))throw Error('记忆作用域不匹配，不能跨角色、会话或世界读取。');
 if(scope.mode==='world'&&(c.activeTimelineId!==scope.timelineId||(c.timelineEpoch??0)!==scope.epoch))throw Error('当前剧情分支已变化，请重新读取记忆作用域。');
 await validateMemoryStore(db,c);return c;
}
export async function getMemoryScope(conversationId:string):Promise<MemoryScope>{
 return db.transaction('rw',tables(),async()=>{const c=await owner(conversationId);
  if(c.mode==='daily')return {mode:'daily',spaceId:'daily',conversationId:c.id,characterId:c.characterId};
  const t=await ensureTimelineInTransaction(c.id);
  return {mode:'world',spaceId:timelineSpace(c) as `world:${string}`,worldId:c.worldId!,conversationId:c.id,characterId:c.characterId,timelineId:t.id,epoch:t.epoch};
 });
}
/** Seal all existing forks BEFORE any memory mutation, in the same transaction
 * that serializes with chat's unchanged timeline creation. No clock heuristics.
 */
async function reconciled(c:Conversation){
 const state:MemoryStore=structuredClone(c.memoryStore??emptyMemoryStore());
 if(c.mode==='world'){
  const timelines=(await db.timelines.where('conversationId').equals(c.id).toArray()).filter(t=>t.epoch===(c.timelineEpoch??0)&&t.status==='live');
  const byId=new Map(timelines.map(t=>[t.id,t]));const forks=new Map(state.forks.map(f=>[f.timelineId,f]));const visiting=new Set<string>();
  const ensure=(t:MemoryTimeline):MemoryStore['forks'][number]=>{
   const old=forks.get(t.id);if(old){old.summaryRevisionAtFork??=t.parentTimelineId?(c.memorySummary?.revision??0):0;return old;}
   if(visiting.has(t.id))throw Error('记忆分支链存在循环');visiting.add(t.id);
   const parent=t.parentTimelineId?byId.get(t.parentTimelineId):undefined;const inherited=parent?ensure(parent):undefined;
   const own=parent?(state.shortHides??[]).filter(h=>h.scope.mode==='world'&&h.scope.timelineId===parent.id&&h.scope.epoch===parent.epoch).flatMap(h=>h.receiptIds):[];
   const next={timelineId:t.id,epoch:t.epoch,parentTimelineId:t.parentTimelineId,sharedHeadNodeId:t.forkNodeId,inheritThroughRevision:t.parentTimelineId?state.revision:0,summaryRevisionAtFork:t.parentTimelineId?(c.memorySummary?.revision??0):0,hiddenSummaryIds:[...new Set([...(inherited?.hiddenSummaryIds??[]),...own])]};
   forks.set(t.id,next);state.forks.push(next);visiting.delete(t.id);return next;
  };for(const t of timelines)ensure(t);
 }
 if(state.forks.length>memoryLimits.forks)throw Error('记忆分支元数据已达安全容量上限，未删除旧记录。');
 return state;
}
async function visibility(c:Conversation,scope:Extract<MemoryScope,{mode:'world'}>,state:MemoryStore,summary=false){
 const chain=await getTimelineAncestors(c.id,scope.timelineId),nodes=new Set((await nodesForHead(c.id,chain.at(-1)?.headNodeId)).map(n=>n.id));
 const limits=new Map<string,number>();let limit=summary?(c.memorySummary?.revision??0):state.revision;
 for(let i=chain.length-1;i>=0;i--){const t=chain[i],fork=state.forks.find(f=>f.timelineId===t.id);if(!fork)throw Error('记忆分支修订边界缺失。');limits.set(t.id,limit);limit=Math.min(limit,summary?(fork.summaryRevisionAtFork??0):fork.inheritThroughRevision);}
 return {limits,nodes};
}
async function eligible(c:Conversation,scope:MemoryScope,state:MemoryStore){
 if(scope.mode==='daily')return state.entries;
 const {limits,nodes}=await visibility(c,scope,state);
 return state.entries.filter(e=>e.scope.mode==='world'&&e.scope.epoch===scope.epoch&&limits.has(e.scope.timelineId)&&e.revision<=limits.get(e.scope.timelineId)!&&(!e.anchorNodeId||nodes.has(e.anchorNodeId)));
}
function latest(entries:MemoryEntry[]){const result=new Map<string,MemoryEntry>();for(const e of entries)result.set(e.id,e);return result;}
export async function listMemories(scope:MemoryScope,kind?:'core'|'long'){
 return db.transaction('r',tables(),async()=>{const c=await checked(scope),state=await reconciled(c),records=latest(await eligible(c,scope,state));
  return {scope,revision:state.revision,entries:[...records.values()].filter(e=>!e.deleted&&(!kind||kind===e.kind)).map(e=>({...e,inherited:scope.mode==='world'&&e.scope.mode==='world'&&e.scope.timelineId!==scope.timelineId}) as EffectiveMemory)};
 });
}
export async function getMemoryHistory(scope:MemoryScope,id:string){
 return db.transaction('r',tables(),async()=>{const c=await checked(scope);return (await eligible(c,scope,await reconciled(c))).filter(e=>e.id===id);});
}
async function write(scope:MemoryScope,input:MemoryInput|undefined,id?:string,expectedRevision?:number,expectedStoreRevision?:number){
 return db.transaction('rw',tables(),async()=>{const c=await checked(scope),state=await reconciled(c);
  if(expectedStoreRevision!==undefined&&expectedStoreRevision!==state.revision)throw Error('记忆库修订已变化，未覆盖新的手动内容。');
  const previous=id?latest(await eligible(c,scope,state)).get(id):undefined;
  if(id&&(!previous||previous.deleted))throw Error('当前作用域中没有这条有效记忆。');
  if(previous&&previous.revision!==expectedRevision)throw Error('记忆版本已变化，请重新读取后编辑。');
  const source=input?.source??'manual';if(previous?.source==='manual'&&source==='auto')throw Error('自动来源不能覆盖或删除手动记忆。');
  const content=input?.content.trim()??'';
  if(input&&(!['core','long'].includes(input.kind)||!['manual','auto'].includes(source)||!content||content.length>memoryLimits.entryChars))throw Error('核心/长期记忆需为1–12000字符，且来源有效；短期上下文不重复持久化。');
  if(state.entries.length>=memoryLimits.events||state.entries.reduce((n,e)=>n+e.content.length,content.length)>memoryLimits.totalChars)throw Error('记忆达到本阶段安全容量上限，未清理或覆盖旧记忆。');
  let timeline:MemoryTimeline|undefined;if(scope.mode==='world')timeline=await db.timelines.get(scope.timelineId);
  const now=Math.max(0,Date.now(),previous?.updatedAt??0),entry:MemoryEntry={id:previous?.id??crypto.randomUUID(),revision:state.revision+1,scope:structuredClone(scope),kind:input?.kind??previous!.kind,source,content,deleted:!input,...(input?.sourceReceiptId?{sourceReceiptId:input.sourceReceiptId}:{}),createdAt:previous?.createdAt??now,updatedAt:now,...(timeline?.headNodeId?{anchorNodeId:timeline.headNodeId}:{})};
  state.entries.push(entry);state.revision++;await validateMemoryStore(db,{...c,memoryStore:state});await db.conversations.update(c.id,{memoryStore:state});return entry;
 });
}
export const createMemory=(scope:MemoryScope,input:MemoryInput,expectedStoreRevision?:number)=>write(scope,input,undefined,undefined,expectedStoreRevision);
export const updateMemory=(scope:MemoryScope,id:string,input:MemoryInput,expectedRevision:number)=>write(scope,input,id,expectedRevision);
export const deleteMemory=(scope:MemoryScope,id:string,expectedRevision:number)=>write(scope,undefined,id,expectedRevision);
/** Reuse the effective chat path (including selected variants and bubble deletions).
 * No lore, model call, copied transcript table, or daily memory branch is created.
 */
export async function readShortMemory(scope:MemoryScope,maxMessages=30):Promise<ShortMemory>{
 if(!Number.isInteger(maxMessages)||maxMessages<1||maxMessages>memoryLimits.shortMessages)throw Error('短期消息范围需为1–200条。');
 return db.transaction('r',tables(),async()=>{const c=await checked(scope),timelineId=scope.mode==='world'?scope.timelineId:c.activeTimelineId,t=timelineId?await db.timelines.get(timelineId):undefined;
  const nodes=t?await nodesForHead(c.id,t.headNodeId):[],byMessage=new Map(nodes.map(n=>[n.messageId,n.id]));
  const rowsForProvenance=(t?nodes.map(n=>n.message):await activeMessages(c.id)).filter(m=>m.role==='user'||m.role==='assistant');
  const rows=rowsForProvenance.map(visibleMessage).slice(-maxMessages);
  const receipts:SummaryReceipt[]=[];const verify=summaryVerifier(rowsForProvenance);
  for(const receipt of await visibleSummaryReceipts(scope)){
   if(!receipt.shortSummary?.trim())continue;
   const value=verify(receipt);
   if(['verified','legacy-verified'].includes(typeof value==='string'?value:await value))receipts.push(receipt);
  }
  const state=await reconciled(c),hidden=shortSummaryHiddenIds(scope,state);
  const recentReceipts=receipts.filter(r=>!hidden.has(r.id)).slice(-5);
  return {kind:'short',scope,summaryRevision:c.memorySummary?.revision??0,summaries:recentReceipts.map(r=>({id:r.id,text:r.shortSummary!,createdAt:r.createdAt,throughNodeId:r.throughNodeId,turns:r.turns})),context:{timelineId:t?.id,epoch:c.timelineEpoch??0,revision:t?.revision,headNodeId:t?.headNodeId},messages:rows.map(m=>({messageId:m.id,variantId:m.activeVariantId,nodeId:byMessage.get(m.id),role:m.role as 'user'|'assistant',content:m.content,assetIds:(m.attachments??[]).map(a=>a.assetId),createdAt:m.createdAt}))};
 });
}

/** Summary writes seal the same existing fork journal before changing progress. */
export async function sealMemorySummaryForks(scope:MemoryScope){
 return db.transaction('rw',tables(),async()=>{const c=await checked(scope),state=await reconciled(c);await db.conversations.update(c.id,{memoryStore:state});});
}
export async function visibleSummaryReceipts(scope:MemoryScope,forShortContext=false):Promise<SummaryReceipt[]>{
 return db.transaction('r',tables(),async()=>{const c=await checked(scope),receipts=c.memorySummary?.receipts??[];
  if(scope.mode==='daily')return forShortContext?receipts.filter(r=>!shortSummaryHiddenIds(scope,c.memoryStore??emptyMemoryStore()).has(r.id)):receipts;
  const {limits,nodes}=await visibility(c,scope,await reconciled(c),true);
  const hidden=forShortContext?shortSummaryHiddenIds(scope,await reconciled(c)):new Set<string>();
  return receipts.filter(r=>!hidden.has(r.id)&&r.scope.mode==='world'&&r.epoch===scope.epoch&&limits.has(r.scope.timelineId)&&r.revision<=limits.get(r.scope.timelineId)!&&nodes.has(r.throughNodeId));
 });
}

/** Visible revisions include tombstones; used only for local summary deduplication. */
export async function listMemoryRevisions(scope:MemoryScope){
 return db.transaction('r',tables(),async()=>{const c=await checked(scope);return eligible(c,scope,await reconciled(c));});
}

/** Presentation tombstones preserve summary provenance/progress and all raw chat. */
export function shortSummaryHiddenIds(scope:MemoryScope,state:MemoryStore){
 return new Set([...(scope.mode==='world'?state.forks.find(f=>f.timelineId===scope.timelineId&&f.epoch===scope.epoch)?.hiddenSummaryIds??[]:[]),...(state.shortHides??[]).filter(h=>memoryScopeKey(h.scope)===memoryScopeKey(scope)).flatMap(h=>h.receiptIds)]);
}
export async function clearMemoryCategory(scope:MemoryScope,kind:'core'|'long'|'short',expectedRevision?:number,expectedSummaryRevision?:number){
 if(!['core','long','short'].includes(kind))throw Error('记忆分类无效');
 return db.transaction('rw',tables(),async()=>{
  const c=await checked(scope),state=await reconciled(c);if(expectedRevision!==undefined&&state.revision!==expectedRevision)throw Error('记忆已变化，请重新确认清空范围。');
  if(kind==='short'){
   if(expectedSummaryRevision!==undefined&&expectedSummaryRevision!==(c.memorySummary?.revision??0))throw Error('短期摘要已变化，请重新确认清空范围。');
   const ids=(await visibleSummaryReceipts(scope)).map(r=>r.id);const hidden=shortSummaryHiddenIds(scope,state);
   state.shortHides=[...(state.shortHides??[]).filter(h=>memoryScopeKey(h.scope)!==memoryScopeKey(scope)),{scope:structuredClone(scope),receiptIds:[...new Set([...hidden,...ids])]}];
  }else{
   const entries=[...latest(await eligible(c,scope,state)).values()].filter(e=>!e.deleted&&e.kind===kind);
   if(state.entries.length+entries.length>memoryLimits.events)throw Error('保留历史修订所需容量不足，未清空任何记忆。');
   const t=scope.mode==='world'?await db.timelines.get(scope.timelineId):undefined;
   for(const previous of entries){state.entries.push({...previous,revision:++state.revision,scope:structuredClone(scope),source:'manual',content:'',deleted:true,updatedAt:Math.max(Date.now(),previous.updatedAt),...(t?.headNodeId?{anchorNodeId:t.headNodeId}:{})});}
  }
  await validateMemoryStore(db,{...c,memoryStore:state});await db.conversations.update(c.id,{memoryStore:state});
 });
}
/** One consistent, validated read for prompt assembly, never a cross-request cache. */
export async function memoryContextSnapshot(scope:MemoryScope){
 return db.transaction('r',tables(),async()=>{
  const c=await checked(scope),state=await reconciled(c);
  const entries=[...latest(await eligible(c,scope,state)).values()].filter(e=>!e.deleted).map(e=>({...e,inherited:scope.mode==='world'&&e.scope.mode==='world'&&e.scope.timelineId!==scope.timelineId}));
  let receipts=c.memorySummary?.receipts??[];
  if(scope.mode==='world'){const {limits,nodes}=await visibility(c,scope,state,true);receipts=receipts.filter(r=>r.scope.mode==='world'&&r.epoch===scope.epoch&&limits.has(r.scope.timelineId)&&r.revision<=limits.get(r.scope.timelineId)!&&nodes.has(r.throughNodeId));}
  const hidden=shortSummaryHiddenIds(scope,state);
  return {owner:c,scope,entries,receipts,shortReceipts:receipts.filter(r=>!hidden.has(r.id))};
 });
}
