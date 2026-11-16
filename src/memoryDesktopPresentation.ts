import type {DesktopItem as Item,DesktopPage as Page} from './store';
/** Read-only fallback: never rewrite an old desktop just to expose Memory. */
export function memoryDesktopPresentation(items:Item[],pages:Page[]){
 if(!pages.length||items.some(i=>i.kind==='app'&&i.app==='记忆'))return {items,pages};
 const available=pages.find(p=>items.filter(i=>i.pageId===p.id).reduce((n,i)=>n+(i.kind==='widget'?i.size:1),0)<12);
 let id='memory-app-page';while(pages.some(p=>p.id===id))id+='-extra';
 const page=available??{id,order:Math.max(-1,...pages.map(p=>p.order))+1};
 let iconId='app-memory';while(items.some(i=>i.id===iconId))iconId+='-extra';
 return {pages:available?pages:[...pages,page],items:[...items,{id:iconId,kind:'app' as const,app:'记忆' as const,pageId:page.id,position:Math.max(-1,...items.filter(i=>i.pageId===page.id).map(i=>i.position))+1,size:1 as const}]};
}
