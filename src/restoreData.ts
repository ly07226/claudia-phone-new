import {supportedDataSchema,schemasForVersion} from './backupFormat';
import {dataEqual} from './dataEqual';
import Dexie,{type Transaction} from 'dexie';
import {backupSchemas,backupTables,ensure,checkAbort,tableSeed,nextDigest,rowBytes,sha,type BackupManifest} from './backupFormat';
import {eachBackupRow,validateReferences} from './backupService';
import {validateTimelineDatabase} from './timelineValidation';
export type DatabaseDigest=Record<string,{count:number;digest:string}>;
export function exactSchema(d:Dexie) {
  ensure(supportedDataSchema(d),'数据库版本或表结构未受支持，停止恢复；不会忽略未知表。');
}
const transactions=new WeakMap<Dexie,Transaction>();
export function bound(d:Dexie,tx:Transaction):Dexie {const view=Object.create(d);view.table=(name:string)=>tx.table(name);transactions.set(view,tx);return view;}
export function keep<T>(tx:Transaction,p:Promise<T>):Promise<T>{
  const extended=tx as Transaction & {waitFor?:(p:Promise<T>)=>Promise<T>};
  ensure(typeof extended.waitFor==='function','当前数据库引擎不支持安全事务保活，停止恢复。');return extended.waitFor(p);
}
function wait<T>(d:Dexie,p:Promise<T>):PromiseLike<T>{const tx=transactions.get(d);return tx?keep(tx,p):p;}
export async function digest(d:Dexie,signal:AbortSignal) {
  const result:DatabaseDigest={};
  for(const table of backupTables){let value=await wait(d,tableSeed(table)),count=0;
    await eachBackupRow(d,table,async row=>{checkAbort(signal);value=await wait(d,(async()=>nextDigest(value,await rowBytes(table,row)))());count++;},signal);
    result[table]={count,digest:value};
  }return result;
}
export const same=(a:DatabaseDigest,b:DatabaseDigest)=>JSON.stringify(a)===JSON.stringify(b);
export async function validate(d:Dexie,signal:AbortSignal){
  // Raw local snapshots contain credentials. This does not export them.
  await validateReferences(d,{credentials:'encrypted',redactions:[]} as unknown as BackupManifest,signal);
  await validateTimelineDatabase(d);
}
/** Only verified, isolated restore candidates are upgraded. The live database
 * is never passed through this helper; unknown stores fail before any upgrade. */
export async function upgradeRestoreCandidate(d:Dexie){
 if(d.verno===5||d.verno===6){
  // Only an isolated legacy candidate may enter this additive upgrade. Keep
  // exactSchema(target) strict: a live old/unknown database is never upgraded
  // as an incidental side effect of restore.
  const schema=schemasForVersion(d.verno),native=d.backendDB();
  ensure(native.version===d.verno*10&&[...native.objectStoreNames].sort().join()===[...Object.keys(schema)].sort().join(),'旧恢复副本结构不受支持，未修改正式数据。');
  for(const [name,definition] of Object.entries(schema)){
   const [key,...indexes]=definition.split(','),actual=d.table(name).schema;
   ensure(actual.primKey.src===key&&actual.indexes.map(index=>index.src).sort().join()===indexes.sort().join(),'旧恢复副本索引不受支持，未修改正式数据。');
  }
 }else exactSchema(d);
 if(d.verno>=9)return;
 const leases=d.tables.some(table=>table.name==='summaryLeases');
 d.close();d.version(9).stores({...backupSchemas,...(leases?{summaryLeases:'name,expiresAt'}:{})}).upgrade(async tx=>{
  const legacy=await tx.table('themes').get('sticker-library');
  if(Array.isArray(legacy?.stickers))for(const {data,...meta} of legacy.stickers){await tx.table('stickerMeta').put(meta);await tx.table('stickerImages').put({id:meta.id,data});}
 });await d.open();exactSchema(d);
}
export async function openRestoreDatabase(name:string){
 const d=new Dexie(name);
 if(!await Dexie.exists(name))d.version(9).stores(backupSchemas);
 try{await d.open();await upgradeRestoreCandidate(d);return d;}catch(error){d.close();throw error;}
}

/** Extend only newly introduced stores after verifying every old digest. A
 * legacy sticker library remains in themes; the new stores must be its exact,
 * deterministic projection, not arbitrary data admitted after migration. */
export async function extendRollbackDigest(d:Dexie,expected:DatabaseDigest,actual:DatabaseDigest){
 ensure(Object.entries(expected).every(([table,value])=>dataEqual(actual[table],value)),'恢复前副本已损坏，当前数据未修改。');
 const missingStickers=!expected.stickerMeta&&!expected.stickerImages;
 ensure(!!expected.stickerMeta===!!expected.stickerImages,'旧回退副本贴纸来源不完整。');
 if(missingStickers){
  const legacy=await d.table('themes').get('sticker-library'),rows=new Map<string,{meta:any;data:string}>();
  if(Array.isArray(legacy?.stickers))for(const {data,...meta} of legacy.stickers){ensure(typeof meta.id==='string'&&typeof data==='string','旧贴纸来源无效。');rows.set(meta.id,{meta,data});}
  ensure(actual.stickerMeta?.count===rows.size&&actual.stickerImages?.count===rows.size,'旧贴纸迁移数量不一致。');
  for(const [id,row] of rows){const meta=await d.table('stickerMeta').get(id);ensure(!!meta&&await sha(await rowBytes('stickerMeta',meta))===await sha(await rowBytes('stickerMeta',row.meta))&&dataEqual(await d.table('stickerImages').get(id),{id,data:row.data}),'旧贴纸迁移来源不匹配。');}
 }
 for(const table of backupTables)if(!expected[table]){
  ensure(['timelines','pathNodes','storySessions','storyNodes','stickerMeta','stickerImages'].includes(table),'旧回退副本缺少必要来源。');
  if(table!=='stickerMeta'&&table!=='stickerImages')ensure(actual[table]?.count===0&&actual[table].digest===await tableSeed(table),'旧回退副本新增表包含无法确认的数据。');
  expected[table]=actual[table];
 }
 return expected;
}
