import {useLayoutEffect,useMemo} from 'react';
import {create} from 'zustand';
import {db,usePhone,defaultTheme,type Theme} from './store';
import {themeVariables,validatePalette,hexColor,contrast,storedPalette} from './themePalette';
import {compileThemeCSS,validateThemeAppearance} from './themeCSS';
type Appearance=Pick<Theme,'color'|'palette'|'customCss'>;
export const useThemePreview=create<{owner:symbol|null;draft:Appearance|null;set:(owner:symbol,draft:Appearance)=>void;clear:(owner:symbol)=>void}>((set)=>({owner:null,draft:null,set:(owner,draft)=>set({owner,draft}),clear:owner=>set(s=>s.owner===owner?{owner:null,draft:null}:s)}));
export function themeSafeMode(){return new URLSearchParams(location.search).get('themeSafe')==='1';}
export function useEffectiveTheme(saved:Theme){const draft=useThemePreview(s=>s.draft);return useMemo(()=>{if(themeSafeMode())return {...saved,color:defaultTheme.color,palette:undefined,customCss:undefined};const merged=draft?{...saved,...draft}:saved;return {...merged,palette:storedPalette(merged.palette)};},[saved,draft]);}
export function appearanceFingerprint(theme:Appearance){return JSON.stringify({color:theme.color,palette:theme.palette??null,customCss:theme.customCss??null});}
export async function saveThemeAppearance(patch:Appearance,expected?:string){
 validateThemeAppearance(patch);if(!hexColor(patch.color))throw Error('页面颜色无效，未保存。');
 const saved=await db.transaction('rw',db.themes,async()=>{const current=await db.themes.get('global');if(!current)throw Error('无法读取当前主题，未保存。');if(expected!==undefined&&appearanceFingerprint(current)!==expected)throw Error('配色已在其他窗口更改，请取消修改并重新打开编辑器。');const next={...current,...patch};if(!next.palette)delete next.palette;if(!next.customCss?.source.trim())delete next.customCss;await db.themes.put(next);return next;});
 usePhone.getState().set({theme:saved});return saved;
}
export function useThemeAppearance(theme:Theme){
 useLayoutEffect(()=>{
  const root=document.documentElement,previous=new Map<string,string>();let style:HTMLStyleElement|undefined;
  const assign=(key:string,value:string)=>{previous.set(key,root.style.getPropertyValue(key));root.style.setProperty(key,value);};
  try{
   if(theme.palette){validatePalette(theme.palette);const c=theme.palette.colors;for(const [k,v] of Object.entries(themeVariables(c)))assign(k,v);
    assign('--text',c.text);assign('--panel-background',c.card);assign('--input-background',c.input);assign('--attachment-surface',c.card);assign('--error-color',c.danger);
    root.dataset.themePalette='1';root.dataset.themeMode=contrast(c.page,'#FFFFFF')>contrast(c.page,'#000000')?'dark':'light';
   }
   if(theme.customCss?.source&&!themeSafeMode()){const css=compileThemeCSS(theme.customCss.source);style=document.createElement('style');style.dataset.themeCustom='1';style.textContent=css;document.head.appendChild(style);}
  }catch{/* Malformed stored appearance never executes or prevents access to the editor. */}
  return()=>{style?.remove();for(const [k,v] of previous){if(v)root.style.setProperty(k,v);else root.style.removeProperty(k);}delete root.dataset.themePalette;delete root.dataset.themeMode;};
 },[theme.palette,theme.customCss]);
}
