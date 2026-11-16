import Dexie from 'dexie';
import type {Message} from './chatTypes';
import type {SummaryReceipt} from './memorySummaryTypes';
import {visibleMessage} from './messageBubbles';
import {nodesForHead} from './timelines';
export type SourceVerification='verified'|'legacy-verified'|'unverified'|'changed';
/** SHA is external async work. Keep only an already-open Dexie transaction alive. */
export async function sourceHash(text:string){
 const pending=crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 const bytes=await (Dexie.currentTransaction?Dexie.waitFor(pending):pending);
 return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function messageSourceFingerprint(source:readonly Message[],version:1|2|3=3){
 return sourceHash(JSON.stringify(source.map(raw=>{const m=visibleMessage(raw);const base:unknown[]=[m.id,m.role,m.createdAt,m.content];if(version>=2)base.push(m.activeVariantId??null);if(version>=3)base.push((m.attachments??[]).map(a=>a.assetId));return base;})));
}
function sourceMessages(receipt:Pick<SummaryReceipt,'turns'>,byId:ReadonlyMap<string,Message>,positions=new Map([...byId.keys()].map((id,i)=>[id,i]))){
 const ids=receipt.turns.flatMap(t=>[...t.userIds,t.assistantId]);if(new Set(ids).size!==ids.length)return;
 const source=ids.map(id=>byId.get(id));if(source.some(m=>!m))return;
 let previous=-1;
 for(const turn of receipt.turns){for(const id of turn.userIds){const m=byId.get(id)!;const p=positions.get(id)!;if(m.role!=='user'||p<=previous)return;previous=p;}const m=byId.get(turn.assistantId)!;const p=positions.get(m.id)!;if(m.role!=='assistant'||p<=previous)return;previous=p;}
 return source as Message[];
}
export async function summarySourceFingerprint(receipt:Pick<SummaryReceipt,'turns'>,path:Message[]){const source=sourceMessages(receipt,new Map(path.map(m=>[m.id,m])));return source?messageSourceFingerprint(source):undefined;}
export async function taggedSummaryFingerprint(receipt:Pick<SummaryReceipt,'turns'>,path:Message[]){const hash=await summarySourceFingerprint(receipt,path);return hash?'s3:'+hash:undefined;}
/** Old untagged hashes used either 5 or 6 fields. Never invent an upgrade for
 * receipts without a hash. Five-field hashes require their immutable original
 * prefix to prove attachments as well. Originals are never overwritten. */
export function summaryVerifier(path:Message[]){
 const byId=new Map(path.map(m=>[m.id,m]));const positions=new Map([...byId.keys()].map((id,i)=>[id,i]));
 return async(receipt:SummaryReceipt):Promise<SourceVerification>=>{
  if(!receipt.sourceFingerprint)return 'unverified';const source=sourceMessages(receipt,byId,positions);if(!source)return 'changed';
  const hash=await messageSourceFingerprint(source);if(receipt.sourceFingerprint==='s3:'+hash||receipt.sourceFingerprint===hash)return 'verified';
  if(!/^[0-9a-f]{64}$/.test(receipt.sourceFingerprint)||await messageSourceFingerprint(source,2)!==receipt.sourceFingerprint)return 'changed';
  try{const nodes=await nodesForHead(receipt.scope.conversationId,receipt.throughNodeId);const original=sourceMessages(receipt,new Map(nodes.map(n=>[n.messageId,n.message])));if(!original)return 'unverified';if(await messageSourceFingerprint(original,2)!==receipt.sourceFingerprint)return 'unverified';return await messageSourceFingerprint(original)===hash?'legacy-verified':'changed';}catch{return 'unverified';}
 };
}
