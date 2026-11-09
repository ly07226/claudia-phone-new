import type {Message} from './chatTypes';
import {splitAssistantBubbles,legacyAssistantBubbles} from './splitAssistantBubbles';
export type BubblePart={kind:'text';start:number;end:number;text:string}|{kind:'image';assetId:string};
export interface BubbleDeletion {variantId?:string;text:Extract<BubblePart,{kind:'text'}>[];images:string[]}
export function partKey(part:BubblePart){return part.kind==='text'?`text:${part.start}:${part.end}`:`image:${part.assetId}`;}
export function samePart(a:BubblePart,b:BubblePart){return a.kind===b.kind&&partKey(a)===partKey(b)&&(a.kind!=='text'||(b.kind==='text'&&a.text===b.text));}
export function originalBubbles(m:Message,legacy=false):BubblePart[]{
 let at=0;const text=(m.role==='assistant'?(legacy?legacyAssistantBubbles:splitAssistantBubbles)(m.content):[m.content]).flatMap(value=>{const start=at;at+=value.length;return value.trim()?[{kind:'text' as const,start,end:at,text:value}]:[];});
 return [...(m.attachments||[]).map(a=>({kind:'image' as const,assetId:a.assetId})),...text];
}
export function validateBubbleDeletion(m:Message){
 const d=m.bubbleDeletion;if(d===undefined)return;
 if(!d||d.variantId!==m.activeVariantId||!Array.isArray(d.text)||!Array.isArray(d.images)||d.images.some(id=>typeof id!=='string')||new Set(d.images).size!==d.images.length)throw Error('气泡删除标记无效。');
 const originals=[...originalBubbles({...m,bubbleDeletion:undefined}),...originalBubbles({...m,bubbleDeletion:undefined},true)];
 const bounds=new Set(originals.flatMap(p=>p.kind==='text'?[p.start,p.end]:[]));
 if(d.text.some(p=>!p||p.kind!=='text'||!validPart(p)||!bounds.has(p.start)||!bounds.has(p.end)||m.content.slice(p.start,p.end)!==p.text)||new Set(d.text.map(partKey)).size!==d.text.length||d.images.some(id=>!originals.some(p=>p.kind==='image'&&p.assetId===id)))throw Error('气泡删除标记与原文或图片不匹配。');
}
export function messageBubbles(m:Message,legacy=false):BubblePart[]{
 validateBubbleDeletion(m);const d=m.bubbleDeletion;
 return originalBubbles(m,legacy).flatMap<BubblePart>(p=>{
  if(p.kind==='image')return d?.images.includes(p.assetId)?[]:[p];
  let spans=[p];
  for(const removed of d?.text||[])spans=spans.flatMap(s=>{
   if(removed.end<=s.start||removed.start>=s.end)return [s];
   return [[s.start,Math.min(s.end,removed.start)],[Math.max(s.start,removed.end),s.end]].flatMap(([start,end])=>end>start?[{kind:'text' as const,start,end,text:m.content.slice(start,end)}]:[]);
  });
  return spans.filter(s=>s.text.trim());
 });
}
export function visibleContent(m:Message){return messageBubbles(m).flatMap(p=>p.kind==='text'?[p.text]:[]).join('');}
export function visibleAttachments(m:Message){return messageBubbles(m).flatMap(p=>p.kind==='image'?[{assetId:p.assetId}]:[]);}
export function visibleMessage(m:Message):Message{return {...m,content:visibleContent(m),attachments:visibleAttachments(m),bubbleDeletion:undefined};}
export function validPart(p:unknown):p is BubblePart{
 if(!p||typeof p!=='object')return false;const x=p as BubblePart;
 return x.kind==='image'?typeof x.assetId==='string'&&!!x.assetId:x.kind==='text'&&Number.isInteger(x.start)&&Number.isInteger(x.end)&&x.start>=0&&x.end>x.start&&typeof x.text==='string'&&x.text.length===x.end-x.start&&x.text.length<=100000;
}

/** Old references can span several new visual bubbles, but never a deleted range. */
export function hasVisiblePart(m:Message,p:BubblePart){
 const visible=messageBubbles(m);
 if(visible.some(v=>samePart(v,p)))return true;
 return p.kind==='text'&&originalBubbles(m,true).some(v=>samePart(v,p))
   && !m.bubbleDeletion?.text.some(d=>d.start<p.end&&d.end>p.start);
}
