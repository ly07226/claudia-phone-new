import type Dexie from 'dexie';
import {db} from './store';
import {ensureTimelineInTransaction,timelineTables} from './timelines';
import {activeMessages} from './messagePath';
import type {Conversation,Message,MessageQuote} from './chatTypes';
import {hasVisiblePart,validPart,type BubblePart} from './messageBubbles';
import type {ExpectedPath} from './chatService';
export function quoteShape(q:unknown):q is MessageQuote{
 if(!q||typeof q!=='object')return false;const x=q as MessageQuote;
 return x.version===1&&typeof x.conversationId==='string'&&!!x.conversationId&&typeof x.timelineId==='string'&&!!x.timelineId&&Number.isInteger(x.epoch)&&x.epoch>=0&&typeof x.messageId==='string'&&!!x.messageId&&(x.variantId===undefined||typeof x.variantId==='string')&&['user','assistant'].includes(x.role)&&validPart(x.part);
}
export function quotedMessage(q:MessageQuote,rows:Message[],c:Pick<Conversation,'id'|'timelineEpoch'>,index?:ReadonlyMap<string,Message>){
 if(!quoteShape(q)||q.conversationId!==c.id||q.epoch!==(c.timelineEpoch??0))return undefined;
 const source=index?index.get(q.messageId):rows.find(m=>m.id===q.messageId);
 if(source&&(source.role!==q.role||source.activeVariantId!==q.variantId))return undefined;
 return source&&hasVisiblePart(source,q.part)?source:undefined;
}
export function quoteSummary(q:MessageQuote){return q.part.kind==='image'?'图片':q.part.text.trim().slice(0,180);}
export async function assertQuoteForSend(q:MessageQuote,c:Conversation,rows:Message[]){
 if(!quotedMessage(q,rows,c))throw Error('引用原消息已删除、版本变化或不在当前分支，请取消或重新选择引用。');
 const t=await db.timelines.get(q.timelineId);
 if(!t||t.conversationId!==c.id||t.epoch!==(c.timelineEpoch??0)||t.characterId!==c.characterId||t.worldId!==c.worldId||t.status!=='live')throw Error('引用所属会话、世界或时间线已失效。');
}
export async function prepareQuote(id:string,messageId:string,part:BubblePart,expected:ExpectedPath,base:{content:string;activeVariantId?:string}){
 return db.transaction('rw',timelineTables(),async()=>{
  const c=await db.conversations.get(id);if(!c||c.activeTimelineId!==expected.timelineId||(c.timelineEpoch??0)!==expected.epoch)throw Error('聊天分支已变化，请重新长按消息。');
  const t=await ensureTimelineInTransaction(id),rows=await activeMessages(id),m=rows.find(m=>m.id===messageId);
  if(!m||!['user','assistant'].includes(m.role)||m.content!==base.content||m.activeVariantId!==base.activeVariantId||!hasVisiblePart(m,part))throw Error('消息或气泡已变化，请重新选择引用。');
  return {version:1,conversationId:id,timelineId:t.id,epoch:t.epoch,messageId:m.id,variantId:m.activeVariantId,role:m.role as 'user'|'assistant',part:structuredClone(part)} satisfies MessageQuote;
 });
}
/** Deleted targets remain valid historical references, but are never resolved into current context. */
export async function validateQuoteReference(d:Dexie,m:Message){
 const q=m.replyTo;if(q===undefined)return;
 if(!quoteShape(q)||q.conversationId!==m.conversationId||q.messageId===m.id)throw Error('引用关系格式或会话作用域无效。');
 const c=await d.table('conversations').get(q.conversationId),t=await d.table('timelines').get(q.timelineId);
 if(!c||!t||t.conversationId!==c.id||t.characterId!==c.characterId||t.worldId!==c.worldId||t.epoch!==q.epoch)throw Error('引用跨会话、世界或时间线。');
 const seen=new Set<string>();let id=t.headNodeId;
 while(id){if(seen.has(id))throw Error('引用来源路径有环。');seen.add(id);const node=await d.table('pathNodes').get(id);if(!node||node.conversationId!==c.id)throw Error('引用来源路径断裂。');const source=node.message as Message;
  if(source.id===q.messageId&&source.role===q.role&&source.activeVariantId===q.variantId&&hasVisiblePart(source,q.part))return;
  id=node.parentNodeId;
 }
 throw Error('引用来源消息或版本不存在于声明的历史路径。');
}
