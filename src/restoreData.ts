import Dexie,{type Transaction} from 'dexie';
import {backupSchemas,backupTables,ensure,checkAbort,tableSeed,nextDigest,rowBytes,type BackupManifest} from './backupFormat';
import {eachBackupRow,validateReferences} from './backupService';
import {validateTimelineDatabase} from './timelineValidation';
export type DatabaseDigest=Record<string,{count:number;digest:string}>;
export function exactSchema(d:Dexie) {
  ensure(d.verno===7&&d.backendDB().version===70&&[...d.backendDB().objectStoreNames].sort().join()===[...backupTables].sort().join(),'数据库版本或表结构未受支持，停止恢复；不会忽略未知表。');
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
export async function openRestoreDatabase(name:string){const d=new Dexie(name);d.version(7).stores(backupSchemas);await d.open();exactSchema(d);return d;}
