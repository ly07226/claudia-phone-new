import type Dexie from 'dexie';
import {eachBackupRow} from './backupService';
import type {GeneratedNote} from './privateNotesGeneration';
const metadataId='private-notes-archive',recordPrefix='private-notes-record:';
export const isPrivateNotesTheme=(id:string)=>id===metadataId||id.startsWith(recordPrefix)||id.startsWith('private-notes-task:');
const key=(owner:string,id:string)=>recordPrefix+encodeURIComponent(owner)+':'+encodeURIComponent(id);
const row=(id:string,data:object)=>({id,color:'#8995a3',font:'sans',iconStyle:'rounded',opacity:.36,blur:18,...data});
/** Called only on the isolated import-plan database. Reuse the importer's existing
 * character and collision mapping; never attach an imported diary to the old owner. */
export async function importPrivateNotes(source:Dexie,target:Dexie,options:{mapCharacter:(id:string)=>Promise<string>;collisionId:(id:string)=>Promise<string>;write:(value:any)=>Promise<void>;overwrite:boolean;appearance:boolean;signal?:AbortSignal}){
 const incoming=(await source.table('themes').get(metadataId))?.privateNotesArchive;
 const local=(await target.table('themes').get(metadataId))?.privateNotesArchive;
 // Normalize the legacy destination without losing its records when desktop is retained.
 for(const [owner,notes]of Object.entries(local?.notes??{}) as [string,GeneratedNote[]][]){for(const n of notes){const id=key(owner,n.id);if(!await target.table('themes').get(id))await options.write(row(id,{privateNote:n}));}}
 const save=async(n:GeneratedNote)=>{
  if(!n||typeof n.id!=='string'||typeof n.characterId!=='string')throw Error('私人记录来源无效，未执行恢复');
  const owner=await options.mapCharacter(n.characterId);let note={...n,characterId:owner},id=key(owner,n.id);
  const old=(await target.table('themes').get(id))?.privateNote;
  if(!options.overwrite&&old&&JSON.stringify(old)!==JSON.stringify(note)){note={...note,id:await options.collisionId(id)};id=key(owner,note.id);}
  const saved=(await target.table('themes').get(id))?.privateNote;
  if(JSON.stringify(saved)!==JSON.stringify(note))await options.write(row(id,{privateNote:note}));
 };
 for(const [owner,notes]of Object.entries(incoming?.notes??{}) as [string,GeneratedNote[]][]){for(const n of notes){if(n.characterId!==owner)throw Error('私人记录角色归属不一致，未执行恢复');if(!await source.table('themes').get(key(owner,n.id)))await save(n);}}
 await eachBackupRow(source,'themes',async r=>{if(r.id.startsWith(recordPrefix)&&r.privateNote)await save(r.privateNote)},options.signal);
 if(incoming||local){const meta=options.appearance&&incoming?incoming:local??incoming;await options.write(row(metadataId,{privateNotesArchive:{...meta,version:1,notes:{}}}));}
 // Running claims are local execution state. Never restore an active lease from another
 // browser; successfully written notes and their source cursors remain authoritative.
}
