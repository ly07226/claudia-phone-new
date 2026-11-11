import type {PhaseData,PhaseSettings,Prompt} from './engine';
export interface LibraryVersion {savedAt:number;prompts:Prompt[]}
export const libraryLimits={perScope:1000,total:20000,history:10,bytes:3*1024*1024};
export const libraryPrefix=(characterId:string,worldId='')=>'character:'+encodeURIComponent(characterId)+':'+encodeURIComponent(worldId)+':';
export function promptScope(id:string){const m=id.match(/^character:[^:]*:[^:]*:/);return m?.[0]??(id.startsWith('character:')?'legacy:':'default');}
export const selectedScope=(s:PhaseSettings)=>s.instructionMode==='character'?libraryPrefix(s.instructionCharacterId??'',s.instructionWorldId??''):'default';
export function scopePrompts(s:PhaseSettings,scope=selectedScope(s)){return s.prompts.filter(p=>promptScope(p.id)===scope);}
export const normalizedInstruction=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu,'');
/** One value is saved atomically by storage.ts; failed persistence cannot orphan history. */
export function replaceLibrary(data:PhaseData,scope:string,items:Prompt[],history:LibraryVersion[]=data.libraryVersions?.[scope]??[]):PhaseData {
 if(items.length>libraryLimits.perScope||items.some(p=>promptScope(p.id)!==scope))throw Error('当前角色与世界的词库归属或数量无效。');
 const old=scopePrompts(data.settings,scope),versions=old.length?[...history.slice(-(libraryLimits.history-1)),{savedAt:Date.now(),prompts:structuredClone(old)}]:history;
 return {...data,settings:{...data.settings,prompts:[...data.settings.prompts.filter(p=>promptScope(p.id)!==scope),...items]},libraryVersions:{...data.libraryVersions,[scope]:versions}};
}
