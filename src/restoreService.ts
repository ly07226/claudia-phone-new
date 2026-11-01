import Dexie, {type Transaction} from 'dexie';
import {db} from './store';
import {acquireBackupGuard,watchBackupArrivals} from './backupGate';
import {acquireRestoreLease} from './restoreLease';
import {backupSchemas,backupTables,ensure,checkAbort,tableSeed,nextDigest,rowBytes,BackupError,type BackupManifest} from './backupFormat';
import {readBackup,verifiedCandidate,eachBackupRow,validateReferences,type IntegrityReport,type BackupProgress} from './backupService';
import {validateTimelineDatabase} from './timelineValidation';
const journalKey='claudia.restore.rollback.v1';
interface Snapshot {name:string;targetName:string;createdAt:string;tables:Record<string,{count:number;digest:string}>}
export interface RestoreReceipt {rollbackName:string;restored:true;credentials:'preserved'|'rollback-copy'}
export function previousRestore(targetName=db.name):Snapshot|null {try{const s=JSON.parse(localStorage.getItem(journalKey)||'null');return s&&s.targetName===targetName&&/^claudia-restore-rollback-[0-9a-f-]{36}$/.test(s.name)&&s.tables?s:null;}catch{return null;}}
function exactSchema(d:Dexie) {
  ensure(d.verno===6&&d.backendDB().version===60&&[...d.backendDB().objectStoreNames].sort().join()===[...backupTables].sort().join(),'数据库版本或表结构未受支持，停止恢复；不会忽略未知表。');
}
const transactions=new WeakMap<Dexie,Transaction>();
function bound(d:Dexie,tx:Transaction):Dexie {const view=Object.create(d);view.table=(name:string)=>tx.table(name);transactions.set(view,tx);return view;}
function keep<T>(tx:Transaction,p:Promise<T>):Promise<T>{
  const extended=tx as Transaction & {waitFor?:(p:Promise<T>)=>Promise<T>};
  ensure(typeof extended.waitFor==='function','当前数据库引擎不支持安全事务保活，停止恢复。');return extended.waitFor(p);
}
function wait<T>(d:Dexie,p:Promise<T>):PromiseLike<T>{const tx=transactions.get(d);return tx?keep(tx,p):p;}
async function digest(d:Dexie,signal:AbortSignal) {
  const result:Snapshot['tables']={};
  for(const table of backupTables){let value=await wait(d,tableSeed(table)),count=0;
    await eachBackupRow(d,table,async row=>{checkAbort(signal);value=await wait(d,(async()=>nextDigest(value,await rowBytes(table,row)))());count++;},signal);
    result[table]={count,digest:value};
  }return result;
}
const same=(a:Snapshot['tables'],b:Snapshot['tables'])=>JSON.stringify(a)===JSON.stringify(b);
async function validate(d:Dexie,signal:AbortSignal){
  // Raw local snapshots contain credentials. This does not export them.
  await validateReferences(d,{credentials:'encrypted',redactions:[]} as unknown as BackupManifest,signal);
  await validateTimelineDatabase(d);
}
async function open(name:string){const d=new Dexie(name);d.version(6).stores(backupSchemas);await d.open();exactSchema(d);return d;}
/** All clears, inserts and post-write verification share ONE transaction over ALL stores.
 * An abort/quota failure/tab termination before commit leaves the old database intact.
 * The durable raw rollback is independently read back before touching the destination.
 */
async function replace(source:Dexie,target:Dexie,report:IntegrityReport|undefined,signal:AbortSignal,lease:{assert:()=>Promise<void>},progress?:(p:BackupProgress)=>void):Promise<RestoreReceipt>{
  exactSchema(target);exactSchema(source);
  const rollbackName=`claudia-restore-rollback-${crypto.randomUUID()}`,rollback=await open(rollbackName);
  let snapshot:Snapshot|undefined;
  try{
    progress?.({phase:'创建并校验恢复前副本',records:0,bytes:0});
    await target.transaction('r',target.tables,async tx=>{
      const view=bound(target,tx);checkAbort(signal);
      ensure(!await tx.table('conversations').filter(c=>c.sendingUntil>Date.now()).count(),'仍有 AI 请求进行中，请等待生成结束后再恢复。');
      const before=await digest(view,signal);
      for(const table of backupTables)await eachBackupRow(view,table,async row=>{await keep(tx,Dexie.ignoreTransaction(()=>rollback.table(table).add(row)));},signal);
      snapshot={name:rollbackName,targetName:target.name,createdAt:new Date().toISOString(),tables:before};
    });
    ensure(same(snapshot!.tables,await digest(rollback,signal)),'恢复前副本摘要校验失败，当前数据未修改。');
    await validate(rollback,signal);
    ensure(snapshot,'回退副本未准备好。');
    // Persist the recovery locator BEFORE any destructive request. Storage failure aborts.
    localStorage.setItem(journalKey,JSON.stringify(snapshot));
    await lease.assert();checkAbort(signal);
    await validate(source,signal);const expected=await digest(source,signal);
    progress?.({phase:'正在恢复',records:0,bytes:0});
    await target.transaction('rw',target.tables,async tx=>{
      const abort=()=>{try{tx.abort();}catch{/* already completed */}};
      signal.addEventListener('abort',abort,{once:true});
      try{
        progress?.({phase:'核对当前数据',records:0,bytes:0});
        ensure(same(await digest(bound(target,tx),signal),snapshot!.tables),'恢复期间当前数据发生变化，已中止；原数据保留。');
        for(const table of backupTables){
          checkAbort(signal);
          // Keys and their destination URLs remain a single local unit; never bind an old
          // credential to an imported endpoint with the same config ID.
          if(report&&(table==='apiConfigs'||table==='apiCredentials'))continue;
          progress?.({phase:'正在恢复',table,records:0,bytes:0});
          await tx.table(table).clear();
          let last:string|undefined;
          for(;;){
            const row=await keep(tx,Dexie.ignoreTransaction(()=>(last===undefined?source.table(table).orderBy(':id'):source.table(table).where(':id').above(last)).first()));
            if(!row)break;checkAbort(signal);await tx.table(table).add(row);last=row[table==='apiCredentials'?'configId':'id'];
          }
        }
        const actual=await digest(bound(target,tx),signal),wanted={...expected};
        if(report){wanted.apiConfigs=snapshot!.tables.apiConfigs;wanted.apiCredentials=snapshot!.tables.apiCredentials;}
        ensure(same(actual,wanted),'正式库写入读回校验失败，事务已回退。');
        await keep(tx,lease.assert());checkAbort(signal);
      }finally{signal.removeEventListener('abort',abort);}
    });
    return {rollbackName,restored:true,credentials:report?'preserved':'rollback-copy'};
  }finally{rollback.close();}
}
export async function restoreToCurrent(files:File[],options:{confirmed:boolean;password?:string;signal?:AbortSignal;onProgress?:(p:BackupProgress)=>void;database?:Dexie;rollback?:boolean}):Promise<RestoreReceipt>{
  ensure(options.confirmed,'必须明确确认后才能恢复。');
  const target=options.database??db,release=acquireBackupGuard(),controller=new AbortController();
  const abort=()=>controller.abort(),hidden=()=>{if(document.hidden)abort();};
  options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',abort);
  const stop=watchBackupArrivals(abort),timeout=setTimeout(abort,300000);
  let lease:Awaited<ReturnType<typeof acquireRestoreLease>>|undefined,candidate:Awaited<ReturnType<typeof readBackup>>|undefined,writer:Dexie|undefined;
  let committed=false;
  try{
    ensure(!document.hidden,'请保持恢复页面在前台。');checkAbort(controller.signal);exactSchema(target);
    options.onProgress?.({phase:'等待其他窗口关闭',records:0,bytes:0});
    lease=await acquireRestoreLease(controller.signal,abort);
    options.onProgress?.({phase:'验证中',records:0,bytes:0});
    let source:Dexie;
    if(options.rollback){const saved=previousRestore(target.name);ensure(saved,'没有可用的恢复前副本。');ensure(await Dexie.exists(saved.name),'恢复前副本缺失，当前数据未修改。');source=await open(saved.name);writer=source;
      ensure(same(await digest(source,controller.signal),saved.tables),'恢复前副本已损坏，当前数据未修改。');
    }else{candidate=await readBackup(files,{mode:'rehearse',password:options.password,signal:controller.signal,onProgress:options.onProgress});source=verifiedCandidate(candidate)!;if(source.verno===5){source.close();source.version(6).stores({timelines:backupSchemas.timelines,pathNodes:backupSchemas.pathNodes});await source.open();}}
    // A separate connection bypasses only the local write admission guard; the guard
    // remains active for the running UI and all normal services until reload.
    const destination=await open(target.name);
    try{const receipt=await replace(source,destination,candidate?.report,controller.signal,lease,options.onProgress);committed=true;return receipt;}finally{destination.close();}
  }catch(error){if(error instanceof BackupError)throw error;throw new BackupError('恢复失败或被中断，原子事务未提交；原数据保持不变。恢复前副本（若已生成）保留，可重试或回退。');}
  finally{clearTimeout(timeout);stop();options.signal?.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',abort);await candidate?.dispose().catch(()=>{});writer?.close();await lease?.release().catch(()=>{});
    // On success the UI remains write-locked until location.reload(), blocking late AI
    // writes with old conversation IDs. Tests explicitly use isolated connections.
    if(!committed||options.database)release();
  }
}
