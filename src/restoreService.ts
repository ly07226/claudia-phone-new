import {prepareImport,getImportPlan,defaultImportOptions,type ImportPlan,type ImportOptions} from "./importPlan";
import {stageImportReceipt} from "./importReceipt";
import Dexie from 'dexie';
import {db} from './store';
import {acquireBackupGuard,watchBackupArrivals} from './backupGate';
import {acquireRestoreLease} from './restoreLease';
import {backupTables,ensure,checkAbort,BackupError} from './backupFormat';
import {eachBackupRow,type IntegrityReport,type BackupProgress} from './backupService';
import {exactSchema,extendRollbackDigest,bound,keep,digest,same,validate,type DatabaseDigest,openRestoreDatabase as open} from './restoreData';
const journalKey='claudia.restore.rollback.v1';
interface Snapshot {name:string;targetName:string;createdAt:string;tables:Record<string,{count:number;digest:string}>}
export interface RestoreReceipt {rollbackName:string;restored:true;credentials:'preserved'|'imported'|'rollback-copy'}
export function previousRestore(targetName=db.name):Snapshot|null {try{const s=JSON.parse(localStorage.getItem(journalKey)||'null');return s&&s.targetName===targetName&&/^claudia-restore-rollback-[0-9a-f-]{36}$/.test(s.name)&&s.tables?s:null;}catch{return null;}}
/** All clears, inserts and post-write verification share ONE transaction over ALL stores.
 * An abort/quota failure/tab termination before commit leaves the old database intact.
 * The durable raw rollback is independently read back before touching the destination.
 */
async function replace(source:Dexie,target:Dexie,report:IntegrityReport|undefined,signal:AbortSignal,lease:{assert:()=>Promise<void>},progress?:(p:BackupProgress)=>void,expectedCurrent?:DatabaseDigest):Promise<RestoreReceipt>{
  exactSchema(target);exactSchema(source);
  const rollbackName=`claudia-restore-rollback-${crypto.randomUUID()}`,rollback=await open(rollbackName);
  let snapshot:Snapshot|undefined;
  try{
    progress?.({phase:'创建并校验恢复前副本',records:0,bytes:0});
    await target.transaction('r',target.tables,async tx=>{
      const view=bound(target,tx);checkAbort(signal);
      ensure(!await tx.table('conversations').filter(c=>c.sendingUntil>Date.now()).count(),'仍有 AI 请求进行中，请等待生成结束后再恢复。');
      ensure(!await tx.table('storySessions').filter(s=>s.pending?.expiresAt>Date.now()).count(),'仍有主线请求进行中，请先退出主线生成并等待停止后再恢复。');
      const before=await digest(view,signal);
      if(expectedCurrent)ensure(same(before,expectedCurrent),"当前数据已变化，原预览失效，请重新生成导入预览。");
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
    await stageImportReceipt(target,source,expected);
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

          progress?.({phase:'正在恢复',table,records:0,bytes:0});
          await tx.table(table).clear();
          let last:string|undefined;
          for(;;){
            const row=await keep(tx,Dexie.ignoreTransaction(()=>(last===undefined?source.table(table).orderBy(':id'):source.table(table).where(':id').above(last)).first()));
            if(!row)break;checkAbort(signal);await tx.table(table).add(row);last=row[table==='apiCredentials'?'configId':'id'];
          }
        }
        const actual=await digest(bound(target,tx),signal),wanted={...expected};

        ensure(same(actual,wanted),'正式库写入读回校验失败，事务已回退。');
        await keep(tx,lease.assert());checkAbort(signal);
      }finally{signal.removeEventListener('abort',abort);}
    });
    return {rollbackName,restored:true,credentials:report?'preserved':'rollback-copy'};
  }finally{rollback.close();}
}
export async function restoreToCurrent(files:File[],options:{confirmed:boolean;password?:string;signal?:AbortSignal;onProgress?:(p:BackupProgress)=>void;database?:Dexie;rollback?:boolean;plan?:ImportPlan;importOptions?:ImportOptions}):Promise<RestoreReceipt>{
  ensure(options.confirmed,'必须明确确认后才能恢复。');
  const target=options.database??db,release=acquireBackupGuard(),controller=new AbortController();
  const abort=()=>controller.abort(),hidden=()=>{if(document.hidden)abort();};
  options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',abort);
  const stop=watchBackupArrivals(abort),timeout=setTimeout(abort,300000);
  let lease:Awaited<ReturnType<typeof acquireRestoreLease>>|undefined,writer:Dexie|undefined;
  let committed=false,ownedPlan:ImportPlan|undefined;
  try{
    ensure(!document.hidden,'请保持恢复页面在前台。');checkAbort(controller.signal);exactSchema(target);
    options.onProgress?.({phase:'等待其他窗口关闭',records:0,bytes:0});
    lease=await acquireRestoreLease(controller.signal,abort);
    options.onProgress?.({phase:'验证中',records:0,bytes:0});
    let source:Dexie;
    if(options.rollback){const saved=previousRestore(target.name);ensure(saved,'没有可用的恢复前副本。');ensure(await Dexie.exists(saved.name),'恢复前副本缺失，当前数据未修改。');source=await open(saved.name);writer=source;
      const actual=await digest(source,controller.signal),expected={...saved.tables};
      await extendRollbackDigest(source,expected,actual);
      ensure(same(actual,expected),'恢复前副本已损坏，当前数据未修改。');
    }else{ownedPlan=options.plan?undefined:await prepareImport(files,options.importOptions??defaultImportOptions,{database:target,password:options.password,signal:controller.signal});
      const prepared=getImportPlan(options.plan??ownedPlan!,target);source=prepared.database;
      ensure(same(await digest(source,controller.signal),prepared.after),"导入预览内容发生变化，已停止写入。");
    }
    // A separate connection bypasses only the local write admission guard; the guard
    // remains active for the running UI and all normal services until reload.
    const destination=await open(target.name);
    try{const receipt=await replace(source,destination,undefined,controller.signal,lease,options.onProgress,options.rollback?undefined:getImportPlan(options.plan??ownedPlan!,target).before);committed=true;return {...receipt,credentials:options.rollback?'rollback-copy':((options.plan??ownedPlan)?.preview.options.keys==='none'?'preserved':'imported')};}finally{destination.close();}
  }catch(error){if(error instanceof BackupError)throw error;throw new BackupError('恢复失败或被中断，原子事务未提交；原数据保持不变。恢复前副本（若已生成）保留，可重试或回退。');}
  finally{clearTimeout(timeout);stop();options.signal?.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',abort);await ownedPlan?.dispose().catch(()=>{});writer?.close();await lease?.release().catch(()=>{});
    // On success the UI remains write-locked until location.reload(), blocking late AI
    // writes with old conversation IDs. Tests explicitly use isolated connections.
    if(!committed||options.database)release();
  }
}
