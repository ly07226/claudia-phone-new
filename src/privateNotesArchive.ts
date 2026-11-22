import {db} from './store';
import type {GeneratedNote} from './privateNotesGeneration';
/** Private records live in the existing themes table so v7/v8 ZIP snapshot and restore
 * include them without changing the strict backup schema or breaking legacy archives. */
type Archive={version:1;notes:Record<string,GeneratedNote[]>;appearance?:{theme:number;opacity:number;background:string};schedule?:NoteSchedule};
const ID='private-notes-archive';
export async function readPrivateNotesArchive():Promise<Archive>{
 const row=await db.themes.get(ID) as (typeof db.themes extends never?never:any);
 const data=row?.privateNotesArchive;
 if(data?.version===1&&data.notes&&typeof data.notes==='object')return data as Archive;
 return {version:1,notes:{}};
}
async function updateArchive(mutator:(archive:Archive)=>void){
 await db.transaction('rw',db.themes,async()=>{
  const archive=await readPrivateNotesArchive();
  mutator(archive);
  const existing=await db.themes.get(ID);
  await db.themes.put({...existing,id:ID,color:'#8995a3',font:'sans',iconStyle:'rounded',opacity:.36,blur:18,privateNotesArchive:archive} as any);
 });
}
export async function archiveNotes(characterId:string,notes:GeneratedNote[]){
 await updateArchive(archive=>{archive.notes[characterId]=notes});
}
export async function appendPrivateNote(characterId:string,note:GeneratedNote){
 await updateArchive(archive=>{const rows=archive.notes[characterId]||[];if(!rows.some(row=>row.id===note.id))archive.notes[characterId]=[note,...rows]});
}
export async function appendPrivateNoteComment(characterId:string,noteId:string,comment:string){
 let found=false;
 await updateArchive(archive=>{
  const note=archive.notes[characterId]?.find(row=>row.id===noteId);
  if(!note)return;
  note.comments=[...(note.comments||[]),comment];found=true;
 });
 if(!found)throw Error('记录已不存在，请刷新后重试');
}
export async function appendPrivateNoteReply(characterId:string,noteId:string,reply:string){
 let found=false;
 await updateArchive(archive=>{const note=archive.notes[characterId]?.find(row=>row.id===noteId);if(!note)return;note.comments=[...(note.comments||[]),{author:'character',text:reply}];found=true});
 if(!found)throw Error('记录已不存在');
}
export async function archiveAppearance(appearance:Archive['appearance']){
 await updateArchive(archive=>{archive.appearance=appearance});
}

export type NoteSchedule={mode:'interval'|'important'|'both';intervalMinutes:number};

export async function saveNoteSchedule(schedule:NoteSchedule){await updateArchive(archive=>{archive.schedule=schedule})}
