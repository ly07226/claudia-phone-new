import {normalizeEntry} from './loreTypes';
import {db} from './store';
import {buildContext} from './chatContext';
import {activeMessages} from './messagePath';
import {getMemoryScope,memoryContextSnapshot} from './memoryStore';
import {summaryVerifier} from './summarySourceFingerprint';
import {validContext,validContextData,type QqContextData,type QqMemoryDocument} from '../supabase/functions/_shared/qqContext.mjs';
/** Reuse the real Daily prompt and existing source verification, never chat/model APIs. */
export async function buildQqSnapshot(conversationId:string){
 const c=await db.conversations.get(conversationId);
 if(!c||c.mode!=='daily'||c.worldId)throw Error('QQ 仅同步对应角色的日常聊天');
 const context=await buildContext(c,undefined,{externalLore:true,externalMemory:true});
 // Image bytes never leave via this text-only integration; retain their message text.
 const messages=context.map(m=>({role:m.role,content:m.content+(m.images?.length?'\n[本条含图片：图片仍保存在小手机，QQ 文本通道未传输图片内容]':'')}));
 const path=await activeMessages(c.id,undefined,true);
 const memory=await memoryContextSnapshot(await getMemoryScope(c.id));
 const verify=summaryVerifier(path),valid=new Set<string>();
 for(const receipt of memory.receipts)if(['verified','legacy-verified'].includes(await verify(receipt)))valid.add(receipt.id);
 const ordered=memory.receipts.filter(r=>r.shortSummary?.trim());
 const documents:QqMemoryDocument[]=memory.entries.filter(e=>{
  if(e.source!=='auto')return true;
  if(!e.sourceReceiptId||!valid.has(e.sourceReceiptId))return false;
  const i=ordered.findIndex(r=>r.id===e.sourceReceiptId);
  return e.kind!=='core'||i<4||(i+1)%5!==0||ordered.slice(i-4,i+1).every(r=>valid.has(r.id));
 }).map(e=>({id:'memory:'+e.id,kind:e.kind,content:e.content,type:e.type,source:e.source,updatedAt:e.updatedAt,sourceReceiptId:e.sourceReceiptId}));
 for(const receipt of memory.shortReceipts)if(valid.has(receipt.id)&&receipt.shortSummary?.trim())documents.push({id:'summary:'+receipt.id,kind:'summary',content:receipt.shortSummary,source:'auto',updatedAt:receipt.createdAt,sourceReceiptId:receipt.id});
 // Keep bounded, source-grounded Daily history for QQ retrieval, independent
 // of the automatic memory summary pipeline. Only active-path messages qualify.
 const historyRows=path.filter(m=>(m.role==='user'||m.role==='assistant')&&!!m.content?.trim()).slice(-1200);
 let historyBytes=0;
 for(let i=historyRows.length-1;i>=0;i--){
  const m=historyRows[i];
  const d:QqMemoryDocument={id:'history:'+m.id,kind:'history',content:JSON.stringify({role:m.role,at:m.createdAt,text:m.content.slice(0,1400)}),updatedAt:m.createdAt};
  const bytes=new TextEncoder().encode(JSON.stringify(d)).length;
  if(historyBytes+bytes>900000)continue;
  historyBytes+=bytes;documents.push(d);
 }
 // Daily only uses global enabled books, exactly as loreForConversation does.
 // Carry rules as data so the QQ user's *current* message activates the same planner.
 const books=await db.lorebooks.filter(b=>b.enabled&&b.global).toArray();
 for(const book of books)for(const raw of await db.loreEntries.where('lorebookId').equals(book.id).toArray()){
  if(!raw.enabled)continue;
  const entry=normalizeEntry(raw);
  documents.push({id:'lore:'+book.id+':'+entry.id,kind:'lore',content:JSON.stringify({book:{...book,rawMetadata:undefined},entry:{...entry,rawMetadata:undefined}})});
 }
 documents.sort((a,b)=>a.id.localeCompare(b.id));
 const data:QqContextData={conversationId:c.id,characterId:c.characterId,timelineId:c.activeTimelineId??'',epoch:c.timelineEpoch??0,documents,
  includedQqReplyIds:path.slice(-30).flatMap(m=>{const id=/^qq:reply:([0-9a-f-]{36})(?::timeline:.*)?$/i.exec(m.id)?.[1];return id&&messages.some(x=>x.role===m.role&&x.content===m.content)?[id]:[];}),
  includedQqIds:path.slice(-30).flatMap(m=>{
   const id=/^qq:([0-9a-f-]{36})(?::timeline:.*)?$/i.exec(m.id)?.[1];
   return id&&messages.some(x=>x.role===m.role&&x.content===m.content)?[id]:[];
  })};
 const fresh=await db.conversations.get(c.id);
 if(!fresh||fresh.activeTimelineId!==c.activeTimelineId||(fresh.timelineEpoch??0)!==(c.timelineEpoch??0)||JSON.stringify(fresh.memoryStore)!==JSON.stringify(memory.owner.memoryStore)||JSON.stringify(fresh.memorySummary)!==JSON.stringify(memory.owner.memorySummary))throw Error('QQ 上下文读取期间资料已变化，将自动重试');
 if(!validContext(messages)||!validContextData(data))throw Error('QQ 上下文超出同步容量，旧云端版本保留');
 return {messages,data};
}
