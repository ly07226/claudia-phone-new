import {db} from './store';
import type {GeneratedNote} from './privateNotesGeneration';
export type NoteSchedule={mode:'interval'|'important'|'both';intervalMinutes:number};
type Archive={version:1;notes:Record<string,GeneratedNote[]>;appearance?:{theme:number;opacity:number;background:string};schedule?:NoteSchedule};
const ID='private-notes-archive',PREFIX='private-notes-record:';
const key=(owner:string,id:string)=>PREFIX+encodeURIComponent(owner)+':'+encodeURIComponent(id);
const theme=(id:string,data:object)=>({id,color:'#8995a3',font:'sans',iconStyle:'rounded',opacity:.36,blur:18,...data});
export async function privateNotesMetadata():Promise<Archive>{const row=await db.themes.get(ID) as any;const a=row?.privateNotesArchive;return a?.version===1&&a.notes&&typeof a.notes==='object'?a:{version:1,notes:{}};}
/** Per-note rows use the existing theme snapshot format. Old aggregate archives remain
 * readable; the first write migrates them atomically, without a database upgrade. */
export async function readPrivateNotesArchive():Promise<Archive>{
 return db.transaction('r',db.themes,async()=>{const a=await privateNotesMetadata();for(const row of await db.themes.where(':id').startsWith(PREFIX).toArray() as any[]){const n=row.privateNote as GeneratedNote|undefined;if(!n||!n.characterId||!n.id)continue;const list=a.notes[n.characterId]??=[];const i=list.findIndex(v=>v.id===n.id);if(i<0)list.push(n);else list[i]=n;}return a;});
}
export async function readCharacterNotes(owner:string):Promise<GeneratedNote[]>{return db.transaction('r',db.themes,async()=>{const a=await privateNotesMetadata();const map=new Map((a.notes[owner]||[]).map(n=>[n.id,n]));for(const row of await db.themes.where(':id').startsWith(PREFIX+encodeURIComponent(owner)+':').toArray() as any[]){if(row.privateNote?.characterId===owner)map.set(row.privateNote.id,row.privateNote);}return [...map.values()];});}
async function migrate(){const a=await privateNotesMetadata();for(const [owner,notes]of Object.entries(a.notes))for(const n of notes)if(!await db.themes.get(key(owner,n.id)))await db.themes.put(theme(key(owner,n.id),{privateNote:n}) as any);a.notes={};await db.themes.put(theme(ID,{privateNotesArchive:a}) as any);return a;}
async function noteFor(owner:string,id:string){const a=await migrate();void a;return (await db.themes.get(key(owner,id)) as any)?.privateNote as GeneratedNote|undefined;}
function checkNote(owner:string,n:GeneratedNote){if(n.characterId!==owner)throw Error('记录角色不匹配');if(new TextEncoder().encode(JSON.stringify(n)).length>2*1024*1024)throw Error('这篇记录及评论过大，未保存；已有内容保留');}
export async function archiveNotes(owner:string,notes:GeneratedNote[]){await db.transaction('rw',db.themes,async()=>{await migrate();for(const n of notes){checkNote(owner,n);await db.themes.put(theme(key(owner,n.id),{privateNote:n}) as any);}const rows=await db.themes.where(':id').startsWith(PREFIX+encodeURIComponent(owner)+':').primaryKeys();const keep=new Set(notes.map(n=>key(owner,n.id)));await db.themes.bulkDelete(rows.filter(id=>!keep.has(String(id))));});}
export async function appendPrivateNote(owner:string,n:GeneratedNote){checkNote(owner,n);await db.transaction('rw',db.themes,async()=>{await migrate();if(!await db.themes.get(key(owner,n.id)))await db.themes.put(theme(key(owner,n.id),{privateNote:n}) as any);});}
async function modifyNote(owner:string,id:string,fn:(n:GeneratedNote)=>void){await db.transaction('rw',db.themes,async()=>{const n=await noteFor(owner,id);if(!n||n.characterId!==owner)throw Error('记录已不存在，请刷新后重试');fn(n);checkNote(owner,n);await db.themes.put(theme(key(owner,id),{privateNote:n}) as any);});}
export async function appendPrivateNoteComment(owner:string,id:string,text:string){await modifyNote(owner,id,n=>{n.comments=[...(n.comments||[]),text]});}
export async function appendPrivateNoteReply(owner:string,id:string,text:string,expectedIndex?:number,expectedComment?:string){await modifyNote(owner,id,n=>{if(expectedIndex!==undefined&&(n.comments.length!==expectedIndex+1||n.comments[expectedIndex]!==expectedComment))throw Error('评论已变化，未保存过期回复');n.comments.push({author:'character',text})});}
export async function archiveAppearance(appearance:Archive['appearance']){await db.transaction('rw',db.themes,async()=>{const a=await privateNotesMetadata();a.appearance=appearance;await db.themes.put(theme(ID,{privateNotesArchive:a}) as any);});}
export async function saveNoteSchedule(schedule:NoteSchedule){if(!['interval','important','both'].includes(schedule.mode)||!Number.isFinite(schedule.intervalMinutes)||schedule.intervalMinutes<60)throw Error('请输入至少60分钟的间隔');await db.transaction('rw',db.themes,async()=>{const a=await privateNotesMetadata();a.schedule=schedule;await db.themes.put(theme(ID,{privateNotesArchive:a}) as any);});}
/** IndexedDB atomic claim works across tabs and Safari without Web Locks. No network
 * inside a transaction, no silent replay after crash. Expired claims can be recovered. */
export async function withPrivateNotesTask<T>(scope:string,automatic:boolean,source:string,run:()=>Promise<T>):Promise<T|null>{
 const id='private-notes-task:'+scope,token=crypto.randomUUID(),now=Date.now();
 const claimed=await db.transaction('rw',db.themes,async()=>{const old=(await db.themes.get(id) as any)?.privateNotesTask;if(old?.until>now||automatic&&(old?.failed||old?.source===source||old?.until>0))return false;await db.themes.put(theme(id,{privateNotesTask:{token,until:now+180000,source:automatic?source:old?.source}}) as any);return true;});
 if(!claimed)return null;
 try{return await run()}catch(error){await db.transaction('rw',db.themes,async()=>{const r=await db.themes.get(id) as any;if(r?.privateNotesTask?.token===token){r.privateNotesTask.failed=true;await db.themes.put(r)}});throw error;}finally{await db.transaction('rw',db.themes,async()=>{const row=await db.themes.get(id) as any;if(row?.privateNotesTask?.token===token){row.privateNotesTask.until=0;await db.themes.put(row)}});}
}

export async function privateNotesTaskStatus(owner:string){return(await db.themes.get('private-notes-task:'+owner+':automatic') as any)?.privateNotesTask as {failed?:boolean;until?:number}|undefined;}
