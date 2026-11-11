import {compileThemeCSS,normalizeBubbleCSS} from './themeCSS';
import {db,usePhone} from './store';
const bubbles=new Set(['.theme-user-bubble','.theme-role-bubble','.chat-user','.chat-assistant','.chat-bubble','.chat-bubble-surface']);
/** Input is first accepted by the existing small CSS grammar, never arbitrary CSS. */
export function splitBubbleCSS(source:string){
 source=normalizeBubbleCSS(source);compileThemeCSS(source);const rules=source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]+)\}/g);let bubble='',other='';
 for(const [,selector,body] of rules){const names=selector.split(',').map(s=>s.trim());for(const [wanted,group] of [[true,'bubble'],[false,'other']] as const){const selected=names.filter(s=>bubbles.has(s)===wanted);if(selected.length){const rule=selected.join(', ')+' {'+body.trim()+'}\n';if(group==='bubble')bubble+=rule;else other+=rule;}}}return {bubble,other};
}
export function checkBubbleCSS(source:string){compileThemeCSS(source);if(splitBubbleCSS(source).other.trim())throw Error('气泡编辑仅接受气泡选择器，不允许修改页面其他元素。');}
export async function saveBubbleCSS(source:string,expected:string){source=normalizeBubbleCSS(source);checkBubbleCSS(source);const next=await db.transaction('rw',db.themes,async()=>{const t=await db.themes.get('global');if(!t)throw Error('无法读取主题。');const parts=splitBubbleCSS(t.customCss?.source??'');if(parts.bubble!==expected)throw Error('气泡样式已在其他窗口更改，请重新打开编辑器。');const combined=parts.other+source;const customCss=combined.trim()?{version:1 as const,source:combined}:undefined;await db.themes.update(t.id,{customCss});return {...t,customCss};});usePhone.getState().set({theme:next});return splitBubbleCSS(next.customCss?.source??'').bubble;}
