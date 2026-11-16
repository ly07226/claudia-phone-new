import type Dexie from 'dexie';
import type {Message,Conversation} from './chatTypes';
import {messageSourceFingerprint} from './summarySourceFingerprint';
/** Staging database only. Originals were validated by the normal backup reader. */
export async function receiptSource(d:Dexie,conversationId:string,through:string){const rows:Message[]=[],seen=new Set<string>();let id:string|undefined=through;while(id){if(seen.has(id))throw Error('摘要来源循环');seen.add(id);const n:any=await d.table('pathNodes').get(id);if(!n||n.conversationId!==conversationId)throw Error('摘要来源跨会话或断链');rows.push(n.message);id=n.parentNodeId;}return rows.reverse();}
export async function rebaseSummaryFingerprint(d:Dexie,c:Conversation,receipt:any,remap:(m:Message)=>Promise<Message>){
 if(!receipt.sourceFingerprint||!receipt.turns)return receipt.sourceFingerprint;
 const original=await receiptSource(d,c.id,receipt.throughNodeId);const byId=new Map(original.map(m=>[m.id,m]));const source=receipt.turns.flatMap((t:any)=>[...t.userIds,t.assistantId]).map((id:string)=>byId.get(id));if(source.some((m:Message|undefined)=>!m))return receipt.sourceFingerprint;
 const strong=await messageSourceFingerprint(source),old=receipt.sourceFingerprint;
 if(old!==strong&&old!=='s3:'+strong&&old!==await messageSourceFingerprint(source,2))return old;
 return 's3:'+await messageSourceFingerprint(await Promise.all(source.map(remap)));
}
