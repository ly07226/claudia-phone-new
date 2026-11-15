import type {Message} from './chatTypes';
import type {SummaryReceipt} from './memorySummaryTypes';
import {visibleMessage} from './messageBubbles';

/** Fingerprint the exact completed turn source, including edited content and variants. */
export async function summarySourceFingerprint(receipt:Pick<SummaryReceipt,'turns'>,path:Message[]):Promise<string|undefined>{
 const byId=new Map(path.map(m=>{const v=visibleMessage(m);return [v.id,v] as const;}));
 const ids=receipt.turns.flatMap(t=>[...t.userIds,t.assistantId]);
 if(new Set(ids).size!==ids.length)return undefined;
 const source=ids.map(id=>byId.get(id));
 if(source.some(m=>!m))return undefined;
 const payload=JSON.stringify(source.map(m=>[m!.id,m!.role,m!.createdAt,m!.content,m!.activeVariantId??null,(m!.attachments??[]).map(a=>a.assetId)]));
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
 return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
