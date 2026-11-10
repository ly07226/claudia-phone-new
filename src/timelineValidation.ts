import {validateBubbleDeletion} from './messageBubbles';
import {validateQuoteReference} from './messageReferences';
import { attachmentImages } from "./imageAttachments";
import type Dexie from "dexie";
import { messageFingerprint, timelineSpace } from "./timelines";
import type { Conversation, MemoryTimeline, ConversationPathNode } from "./chatTypes";
export class TimelineValidationError extends Error {constructor(){super("时间线引用、作用域、内容指纹或路径完整性校验失败，未覆盖正式数据。");this.name="TimelineValidationError";}}
/** Bounded payload working set: never load all message texts or snapshots at once. */
async function each(d:Dexie,table:string,visit:(row:any)=>Promise<void>) {
  let last:string|undefined;
  for(;;){const row=await (last===undefined?d.table(table).orderBy(":id"):d.table(table).where(":id").above(last)).first();if(!row)break;await visit(row);last=row.id;}
}
export async function validateTimelineDatabase(d:Dexie) {
  const conversations=new Map<string,Conversation>((await d.table("conversations").toArray()).map(c=>[c.id,c]));
  const timelines=new Map<string,MemoryTimeline>((await d.table("timelines").toArray()).map(t=>[t.id,t]));
  type Meta=Pick<ConversationPathNode,"id"|"conversationId"|"parentNodeId"|"messageId"|"fingerprint">;
  const nodes=new Map<string,Meta>();
  const fail=()=>{throw new TimelineValidationError();};
  await each(d,"pathNodes",async(n:ConversationPathNode)=>{
    if(!conversations.has(n.conversationId)||n.message?.conversationId!==n.conversationId||n.messageId!==n.message.id||n.role!==n.message.role||!["user","assistant","system","tool"].includes(n.role)||n.variantId!==n.message.activeVariantId||typeof n.parentNodeId!=="string"||typeof n.message.content!=="string"||!Number.isFinite(n.message.createdAt)||!Number.isFinite(n.createdAt)||n.fingerprint!==await messageFingerprint(n.message))fail();
    validateBubbleDeletion(n.message);await validateQuoteReference(d,n.message);
    await attachmentImages(d,n.message);
    const original=await d.table("messages").get(n.messageId);if(original&&original.conversationId!==n.conversationId)fail();
    if(n.variantId){const v=await d.table("messageVariants").get(n.variantId);if(v&&(v.conversationId!==n.conversationId||v.messageId!==n.messageId))fail();}
    nodes.set(n.id,{id:n.id,conversationId:n.conversationId,parentNodeId:n.parentNodeId,messageId:n.messageId,fingerprint:n.fingerprint});
  });
  for(const n of nodes.values())if(n.parentNodeId&&nodes.get(n.parentNodeId)?.conversationId!==n.conversationId)fail();
  const path=(head:string|undefined,cid:string)=>{const seen=new Set<string>(),messages=new Set<string>(),ordered:Meta[]=[];let id=head;
    while(id){if(seen.has(id))fail();seen.add(id);const n=nodes.get(id);if(!n||n.conversationId!==cid||messages.has(n.messageId))fail();messages.add(n!.messageId);ordered.push(n!);id=n!.parentNodeId;}return ordered.reverse();};
  const checked=new Set<string>();for(const n of nodes.values()){let id=n.id;const seen=new Set<string>();while(id&&!checked.has(id)){if(seen.has(id))fail();seen.add(id);const row=nodes.get(id);if(!row)fail();id=row!.parentNodeId;}for(const id of seen)checked.add(id);}
  for(const t of timelines.values()){
    const c=conversations.get(t.conversationId);if(!c||t.characterId!==c.characterId||t.worldId!==c.worldId||t.spaceId!==timelineSpace(c)||t.epoch!==(c.timelineEpoch??0)||t.status!=="live"||!Number.isFinite(t.createdAt)||!Number.isSafeInteger(t.revision)||t.revision<0)fail();
    path(t.headNodeId,t.conversationId);const seen=new Set<string>();let current:MemoryTimeline|undefined=t;
    while(current){if(seen.has(current.id))fail();seen.add(current.id);if(!current.parentTimelineId)break;const parent=timelines.get(current.parentTimelineId);if(!parent||parent.conversationId!==t.conversationId||parent.epoch!==t.epoch||!Number.isSafeInteger(current.parentRevisionAtFork)||current.parentRevisionAtFork!<0||current.parentRevisionAtFork!>parent.revision)fail();if(current.forkNodeId&&(!path(current.headNodeId,t.conversationId).some(n=>n.id===current!.forkNodeId)||!path(parent!.headNodeId,t.conversationId).some(n=>n.id===current!.forkNodeId)))fail();current=parent;}
    if(!t.parentTimelineId&&t.forkNodeId)fail();
  }
  for(const c of conversations.values())if(c.activeTimelineId){const t=timelines.get(c.activeTimelineId);if(!t||t.conversationId!==c.id)fail();const immutable=path(t!.headNodeId,c.id);
    // Keep only ordering metadata; reading every message body at once can exhaust
    // Safari's working set long before ZIP packing begins. Preserve the exact sort.
    const projection:{id:string;createdAt:number}[]=[];
    await d.table("messages").where("conversationId").equals(c.id).each(m=>{if(!m.archived)projection.push({id:m.id,createdAt:m.createdAt});});
    projection.sort((a,b)=>a.createdAt-b.createdAt||(a.id<b.id?-1:a.id>b.id?1:0));
    if(projection.length!==immutable.length)fail();
    for(let i=0;i<projection.length;i++){let m=await d.table("messages").get(projection[i].id);if(!m)fail();if(m.role==="assistant"&&m.activeVariantId){const v=await d.table("messageVariants").get(m.activeVariantId);if(!v||v.conversationId!==c.id||v.messageId!==m.id)fail();m={...m,content:v.content,userEdited:v.userEdited};}if(await messageFingerprint(m)!==immutable[i].fingerprint)fail();}
  }
  await each(d,"conversationSnapshots",async s=>{if(!s.timelineId)return;const t=timelines.get(s.timelineId);if(!t||t.conversationId!==s.conversationId||s.timelineEpoch!==t.epoch)fail();if(s.headNodeId&&!path(t!.headNodeId,s.conversationId).some(n=>n.id===s.headNodeId))fail();const saved=path(s.headNodeId,s.conversationId);if(saved.length!==s.messages.length)fail();for(let i=0;i<saved.length;i++)if(saved[i].fingerprint!==await messageFingerprint(s.messages[i]))fail();});
}
