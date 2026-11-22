import {db} from './store';
import type {GeneratedNote} from './privateNotesGeneration';
/** Private records live in the existing themes table so v7/v8 ZIP snapshot and restore
 * include them without changing the strict backup schema or breaking legacy archives. */
type Archive={version:1;notes:Record<string,GeneratedNote[]>;appearance?:{theme:number;opacity:number;background:string}};
const ID='private-notes-archive';
export async function readPrivateNotesArchive():Promise<Archive>{
 const row=await db.themes.get(ID) as (typeof db.themes extends never?never:any);
 const data=row?.privateNotesArchive;
 if(data?.version===1&&data.notes&&typeof data.notes==='object')return data as Archive;
 return {version:1,notes:{}};
}
export async function archiveNotes(characterId:string,notes:GeneratedNote[]){
 const archive=await readPrivateNotesArchive();
 archive.notes[characterId]=notes;
 const existing=await db.themes.get(ID);
 await db.themes.put({...existing,id:ID,color:'#8995a3',font:'sans',iconStyle:'rounded',opacity:.36,blur:18,privateNotesArchive:archive} as any);
}
export async function archiveAppearance(appearance:Archive['appearance']){
 const archive=await readPrivateNotesArchive();
 archive.appearance=appearance;
 const existing=await db.themes.get(ID);
 await db.themes.put({...existing,id:ID,color:'#8995a3',font:'sans',iconStyle:'rounded',opacity:.36,blur:18,privateNotesArchive:archive} as any);
}
