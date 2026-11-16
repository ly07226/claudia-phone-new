import {dataEqual} from './dataEqual';
import Dexie from "dexie";
import { db } from "./store";
import { legacyActiveMessages } from "./legacyMessagePath";
import type { Conversation, ConversationPathNode, MemoryTimeline, Message } from "./chatTypes";
import { cancelGeneration } from "./messageOperations";
export const timelineTables = () => [db.conversations, db.messages, db.messageVariants, db.timelines, db.pathNodes];
export const timelineSpace = (c: Conversation) => c.mode === "daily" ? "daily" : `world:${c.worldId}`;
export async function messageFingerprint(message: Message) {
  const normalized={...message,archived:false};
  // Backup JSON canonicalizes nested keys. Normalize only the new metadata so
  // old v6 fingerprints remain byte-for-byte compatible with existing nodes.
  const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  if(message.replyTo)normalized.replyTo=canonical(message.replyTo);
  if(message.bubbleDeletion)normalized.bubbleDeletion=canonical(message.bubbleDeletion);
  const data=JSON.stringify(Object.fromEntries(Object.keys(normalized).sort().map(k=>[k,normalized[k as keyof Message]])));
  const bytes=await Dexie.waitFor(crypto.subtle.digest("SHA-256",new TextEncoder().encode(data)));
  return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,"0")).join("");
}
function assertOwner(c:Conversation,t:MemoryTimeline) {
  if((c.mode!=="daily"&&c.mode!=="world")||(c.mode==="daily"&&!!c.worldId)||(c.mode==="world"&&!c.worldId)||t.conversationId!==c.id || t.characterId!==c.characterId || t.spaceId!==timelineSpace(c) || t.worldId!==c.worldId || t.epoch!==(c.timelineEpoch??0) || t.status!=="live")throw Error("时间线作用域或有效期不匹配。");
}
// Scope-bounded bulk reads avoid one IndexedDB round trip per parent. Very large
// branched archives fall back to the original walk rather than loading every branch.
const graphLimit=20000;
async function scopedGraph(id:string){const query=db.pathNodes.where('conversationId').equals(id);return await query.count()<=graphLimit?query.toArray():undefined;}
function nodeShape(n:ConversationPathNode,id:string){
 if(n.conversationId!==id||typeof n.message?.content!=="string"||!Number.isFinite(n.message.createdAt)||!["user","assistant","system","tool"].includes(n.role)||n.messageId!==n.message.id||n.variantId!==n.message.activeVariantId||n.role!==n.message.role||n.message.conversationId!==id)throw Error("不可变节点内容校验失败。");
}
async function batches<T,R>(rows:T[],fn:(row:T)=>Promise<R>){const out:R[]=[];for(let i=0;i<rows.length;i+=64)out.push(...await Promise.all(rows.slice(i,i+64).map(fn)));return out;}
// Reuse proof only inside one consistent transaction. No cross-transaction trust.
const transactionPaths=new WeakMap<object,{id:string;head?:string;nodes:ConversationPathNode[]}>();let pathHooks=false;
function rootTransaction(tx:any):any{while(tx?.parent)tx=tx.parent;return tx;}
function pathTransaction(){if(!pathHooks){pathHooks=true;const clear=(tx:any)=>{transactionPaths.delete(rootTransaction(tx));};db.pathNodes.hook('creating',(_k,_v,tx)=>{clear(tx);});db.pathNodes.hook('updating',(_m,_k,_v,tx)=>{clear(tx);});db.pathNodes.hook('deleting',(_k,_v,tx)=>{clear(tx);});}return rootTransaction(Dexie.currentTransaction);}
export async function nodesForHead(conversationId:string,head?:string):Promise<ConversationPathNode[]> {
 const tx:object|undefined=pathTransaction(),cached=tx?transactionPaths.get(tx):undefined;if(cached?.id===conversationId&&cached.head===head)return structuredClone(cached.nodes);
 const graph=head?await scopedGraph(conversationId):[],index=graph?new Map(graph.map(n=>[n.id,n])):undefined;
 const rows:ConversationPathNode[]=[],seen=new Set<string>();let id=head;
 while(id){if(seen.has(id))throw Error("时间线路径存在循环。");seen.add(id);const n=index?index.get(id):await db.pathNodes.get(id);if(!n||n.conversationId!==conversationId)throw Error("时间线路径断链或跨会话。");nodeShape(n,conversationId);rows.push(n);id=n.parentNodeId;}
 await batches(rows,async n=>{if(n.fingerprint!==await messageFingerprint(n.message))throw Error("不可变节点内容校验失败。");});
 rows.reverse();if(new Set(rows.map(n=>n.messageId)).size!==rows.length)throw Error("时间线路径重复消息。");if(tx&&rows.length<=graphLimit&&rows.reduce((n,row)=>n+row.message.content.length,0)<=8*1024*1024)transactionPaths.set(tx,{id:conversationId,head,nodes:structuredClone(rows)});return rows;
}
export async function resolveTimelinePath(conversationId:string,timelineId?:string):Promise<Message[]> {
 return db.transaction("r",timelineTables(),async()=>{const c=await db.conversations.get(conversationId);if(!c)throw Error("会话不存在。");const id=timelineId??c.activeTimelineId;if(!id)return legacyActiveMessages(conversationId);const t=await db.timelines.get(id);if(!t)throw Error("时间线不存在。");assertOwner(c,t);await getTimelineAncestors(c.id,t.id);return(await nodesForHead(c.id,t.headNodeId)).map(n=>({...n.message,archived:false}));});
}
/** Read-only preview: validates the timeline owner and each visited tip, not an
 * assertion that the entire historical graph is valid. Generation still validates all. */
export async function latestTimelineMessage(c:Conversation){
 const t=await db.timelines.get(c.activeTimelineId!);if(!t)throw Error('时间线不存在。');assertOwner(c,t);await getTimelineAncestors(c.id,t.id);
 const seen=new Set<string>();let id=t.headNodeId;while(id){if(seen.has(id))throw Error('时间线路径存在循环。');seen.add(id);const n=await db.pathNodes.get(id);if(!n)throw Error('时间线路径断链或跨会话。');nodeShape(n,c.id);if(n.fingerprint!==await messageFingerprint(n.message))throw Error('不可变节点内容校验失败。');if(n.role==='user'||n.role==='assistant')return {...n.message,archived:false};id=n.parentNodeId;}
}
async function buildNodes(c:Conversation,messages:Message[],prior:ConversationPathNode[]=[]){
 const byMessage=new Map(prior.map(n=>[n.messageId,n]));
 const equal=(a:Message,b:Message)=>dataEqual({...a,archived:false},{...b,archived:false});
 const fingerprints=await batches(messages,async m=>{const old=byMessage.get(m.id);return old&&equal(old.message,m)?old.fingerprint:messageFingerprint(m);});
 const selected=messages.filter(m=>m.activeVariantId);const variants=await db.messageVariants.bulkGet(selected.map(m=>m.activeVariantId!));selected.forEach((m,i)=>{const v=variants[i];if(!v||v.conversationId!==c.id||v.messageId!==m.id)throw Error('消息版本引用缺失或跨会话。');});
 let candidates:Map<string,ConversationPathNode>|undefined,loaded=false;const key=(parent:string,fingerprint:string)=>JSON.stringify([parent,fingerprint]);
 const fresh:ConversationPathNode[]=[],created:ConversationPathNode[]=[];let parent='';
 for(let i=0;i<messages.length;i++){
  const m=messages[i],fingerprint=fingerprints[i],old=byMessage.get(m.id);if(m.conversationId!==c.id)throw Error('消息作用域不匹配。');
  let node=old&&old.parentNodeId===parent&&equal(old.message,m)?old:undefined;
  if(!node){if(!loaded){const graph=await scopedGraph(c.id);if(graph)candidates=new Map(graph.map(n=>[key(n.parentNodeId,n.fingerprint),n]));loaded=true;}
   node=candidates?candidates.get(key(parent,fingerprint)):await db.pathNodes.where('[conversationId+parentNodeId+fingerprint]').equals([c.id,parent,fingerprint]).first();
   if(node&&!equal(node.message,m))throw Error('不可变节点内容校验失败。');
   if(!node){node={id:crypto.randomUUID(),conversationId:c.id,parentNodeId:parent,messageId:m.id,variantId:m.activeVariantId,role:m.role,message:{...m,archived:false},fingerprint,createdAt:Date.now()};created.push(node);candidates?.set(key(parent,fingerprint),node);}
  }
  nodeShape(node,c.id);fresh.push(node);parent=node.id;
 }
 if(new Set(fresh.map(n=>n.messageId)).size!==fresh.length)throw Error('时间线路径重复消息。');if(created.length)await db.pathNodes.bulkAdd(created);
 return {headNodeId:parent||undefined,nodes:fresh};
}
/** Must be called inside the same write transaction as the legacy projection mutation. */
export async function ensureTimelineInTransaction(id:string) {
  const c=await db.conversations.get(id);if(!c)throw Error("会话不存在。");
  if(c.activeTimelineId){const t=await db.timelines.get(c.activeTimelineId);if(!t)throw Error("当前时间线缺失。");assertOwner(c,t);return t;}
  const t:MemoryTimeline={id:crypto.randomUUID(),conversationId:id,characterId:c.characterId,spaceId:timelineSpace(c),worldId:c.worldId,epoch:c.timelineEpoch??0,headNodeId:(await buildNodes(c,await legacyActiveMessages(id))).headNodeId,revision:0,createdAt:Date.now(),status:"live",reason:"legacy-root"};
  await db.timelines.add(t);await db.conversations.update(id,{activeTimelineId:t.id,timelineEpoch:t.epoch});return t;
}
export async function getCurrentTimeline(id:string) {return db.transaction("rw",timelineTables(),()=>ensureTimelineInTransaction(id));}
export async function commitTimelineProjection(id:string,reason:MemoryTimeline["reason"],detached=false) {
  const current=await ensureTimelineInTransaction(id),c=(await db.conversations.get(id))!;
  const old=await nodesForHead(id,current.headNodeId),messages=await legacyActiveMessages(id),built=await buildNodes(c,messages,old),headNodeId=built.headNodeId;
  if(headNodeId===current.headNodeId)return current;
  const fresh=built.nodes;let prefix=0;while(prefix<old.length&&prefix<fresh.length&&old[prefix].id===fresh[prefix].id)prefix++;
  if(reason==="append"&&prefix===old.length){const next={...current,headNodeId,revision:current.revision+1};await db.timelines.put(next);return next;}
  const existing=(await db.timelines.where("conversationId").equals(id).toArray()).find(t=>t.status==="live"&&t.epoch===current.epoch&&t.headNodeId===headNodeId&&(!detached||t.reason==="legacy-snapshot"));
  const next:MemoryTimeline=existing??{...current,id:crypto.randomUUID(),headNodeId,parentTimelineId:detached?undefined:current.id,forkNodeId:detached?undefined:old[prefix-1]?.id,parentRevisionAtFork:detached?undefined:current.revision,revision:0,createdAt:Date.now(),reason:detached?"legacy-snapshot":reason};
  if(!existing)await db.timelines.add(next);
  await db.conversations.update(id,{activeTimelineId:next.id});return next;
}
async function projectTimeline(id:string,t:MemoryTimeline) {
  const rows=await resolveTimelinePath(id,t.id);
  await db.messages.where("conversationId").equals(id).modify({archived:true});
  for(const row of rows){const old=await db.messages.get(row.id);if(old&&old.conversationId!==id)throw Error("消息 ID 跨会话冲突。");
    if(row.activeVariantId){const v=await db.messageVariants.get(row.activeVariantId);if(v&&(v.conversationId!==id||v.messageId!==row.id))throw Error("版本 ID 跨会话冲突。");await db.messageVariants.put({...v,id:row.activeVariantId,conversationId:id,messageId:row.id,content:row.content,source:v?.source??"legacy",createdAt:v?.createdAt??row.createdAt,userEdited:row.userEdited,replyInterruption:row.replyInterruption});}
    await db.messages.put({...row,archived:false});
  }
}
export async function switchTimeline(id:string,timelineId:string) {
  await db.transaction("rw",timelineTables(),async()=>{const c=await db.conversations.get(id),t=await db.timelines.get(timelineId);if(!c||!t)throw Error("会话或时间线不存在。");assertOwner(c,t);await projectTimeline(id,t);cancelGeneration(id);await db.conversations.update(id,{activeTimelineId:t.id,sendingToken:undefined,sendingUntil:undefined,updatedAt:Date.now()});});
}
export async function getTimelineAncestors(id:string,timelineId?:string) {
  const c=await db.conversations.get(id);if(!c)throw Error("会话不存在。");let t=await db.timelines.get(timelineId??c.activeTimelineId??"");const result:MemoryTimeline[]=[],seen=new Set<string>();if((timelineId||c.activeTimelineId)&&!t)throw Error("时间线不存在。");
  while(t){assertOwner(c,t);if(seen.has(t.id))throw Error("时间线祖先循环。");seen.add(t.id);result.push(t);if(!t.parentTimelineId)break;const parent=await db.timelines.get(t.parentTimelineId);if(!parent)throw Error("时间线祖先断链。");t=parent;}return result.reverse();
}
export async function getCompletedTurnCount(id:string,timelineId?:string) {const rows=await resolveTimelinePath(id,timelineId);let pending=false,count=0;for(const m of rows){if(m.role==="user")pending=true;else if(m.role==="assistant"&&pending){count++;pending=false;}}return count;}
export async function getTimelineRevision(id:string,timelineId?:string) {const t=timelineId?await db.timelines.get(timelineId):await getCurrentTimeline(id),c=await db.conversations.get(id);if(!t||!c)throw Error("时间线不存在。");assertOwner(c,t);return {timelineId:t.id,revision:t.revision,headNodeId:t.headNodeId,epoch:t.epoch};}
