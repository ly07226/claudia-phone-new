import type {Message} from './chatTypes';
import {splitAssistantBubbles} from './splitAssistantBubbles';
export type BubblePart={kind:'text';start:number;end:number;text:string}|{kind:'image';assetId:string};
export interface BubbleDeletion {variantId?:string;text:Extract<BubblePart,{kind:'text'}>[];images:string[]}
export function partKey(part:BubblePart){return part.kind==='text'?`text:${part.start}:${part.end}`:`image:${part.assetId}`;}
export function samePart(a:BubblePart,b:BubblePart){return a.kind===b.kind&&partKey(a)===partKey(b)&&(a.kind!=='text'||(b.kind==='text'&&a.text===b.text));}
export function originalBubbles(m:Message):BubblePart[]{
 let at=0;const text=(m.role==='assistant'?splitAssistantBubbles(m.content):[m.content]).flatMap(value=>{const start=at;at+=value.length;return value.trim()?[{kind:'text' as const,start,end:at,text:value}]:[];});
 return [...(m.attachments||[]).map(a=>({kind:'image' as const,assetId:a.assetId})),...text];
}
export function validateBubbleDeletion(m:Message){
 const d=m.bubbleDeletion;if(d===undefined)return;
 if(!d||d.variantId!==m.activeVariantId||!Array.isArray(d.text)||!Array.isArray(d.images)||d.images.some(id=>typeof id!=='string')||new Set(d.images).size!==d.images.length)throw Error('气泡删除标记无效。');
 const originals=originalBubbles({...m,bubbleDeletion:undefined});
 if(d.text.some(p=>!p||p.kind!=='text'||!originals.some(x=>samePart(x,p)))||new Set(d.text.map(partKey)).size!==d.text.length||d.images.some(id=>!originals.some(p=>p.kind==='image'&&p.assetId===id)))throw Error('气泡删除标记与原文或图片不匹配。');
}
export function messageBubbles(m:Message):BubblePart[]{
 validateBubbleDeletion(m);const d=m.bubbleDeletion;
 return originalBubbles(m).filter(p=>p.kind==='image'?!d?.images.includes(p.assetId):!d?.text.some(x=>samePart(x,p)));
}
export function visibleContent(m:Message){return messageBubbles(m).flatMap(p=>p.kind==='text'?[p.text]:[]).join('');}
export function visibleAttachments(m:Message){return messageBubbles(m).flatMap(p=>p.kind==='image'?[{assetId:p.assetId}]:[]);}
export function visibleMessage(m:Message):Message{return {...m,content:visibleContent(m),attachments:visibleAttachments(m),bubbleDeletion:undefined};}
export function validPart(p:unknown):p is BubblePart{
 if(!p||typeof p!=='object')return false;const x=p as BubblePart;
 return x.kind==='image'?typeof x.assetId==='string'&&!!x.assetId:x.kind==='text'&&Number.isInteger(x.start)&&Number.isInteger(x.end)&&x.start>=0&&x.end>x.start&&typeof x.text==='string'&&x.text.length===x.end-x.start&&x.text.length<=100000;
}
