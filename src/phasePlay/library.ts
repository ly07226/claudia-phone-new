import type {PhaseData,PhaseSettings,Prompt} from './engine';
export interface LibraryVersion {savedAt:number;prompts:Prompt[]}
export const libraryLimits={perScope:1000,total:20000,history:1000,bytes:3*1024*1024};
export const libraryPrefix=(characterId:string,worldId='')=>'character:'+encodeURIComponent(characterId)+':'+encodeURIComponent(worldId)+':';
export function promptScope(id:string){const m=id.match(/^character:[^:]*:[^:]*:/);return m?.[0]??(id.startsWith('character:')?'legacy:':'default');}
export const selectedScope=(s:PhaseSettings)=>s.instructionMode==='character'?libraryPrefix(s.instructionCharacterId??'',s.instructionWorldId??''):'default';
export function scopePrompts(s:PhaseSettings,scope=selectedScope(s)){return s.prompts.filter(p=>promptScope(p.id)===scope);}
export const normalizedInstruction=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu,'');
/** One value is saved atomically by storage.ts; failed persistence cannot orphan history. */
export function replaceLibrary(data:PhaseData,scope:string,items:Prompt[],history:LibraryVersion[]=data.libraryVersions?.[scope]??[]):PhaseData {
 if(items.length>libraryLimits.perScope||items.some(p=>promptScope(p.id)!==scope))throw Error('当前角色与世界的词库归属或数量无效。');
 const old=scopePrompts(data.settings,scope),versions=old.length?[...history,{savedAt:Date.now(),prompts:structuredClone(old)}]:history;
 return {...data,settings:{...data.settings,prompts:[...data.settings.prompts.filter(p=>promptScope(p.id)!==scope),...items]},libraryVersions:{...data.libraryVersions,[scope]:versions}};
}

/** Merge legacy copies without deleting distinct historical snapshots. */
export function mergeLibraryVersions(current:LibraryVersion[],legacy:LibraryVersion[]){const counts=new Map<string,number>();const key=(v:LibraryVersion)=>JSON.stringify(v);for(const v of current)counts.set(key(v),(counts.get(key(v))??0)+1);return [...current,...legacy.filter(v=>{const k=key(v),n=counts.get(k)??0;if(n){counts.set(k,n-1);return false;}return true;})].sort((a,b)=>a.savedAt-b.savedAt);}
