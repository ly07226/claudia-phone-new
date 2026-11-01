import { BackupError, checkAbort } from './backupFormat';
import { checkBackupClients } from './backupGate';
/** Old/non-controlling workers cannot authorize a destructive restore. Fail closed. */
export async function acquireRestoreLease(signal: AbortSignal, invalidate:()=>void) {
  await checkBackupClients();checkAbort(signal);
  const worker=navigator.serviceWorker?.controller;
  if(!worker)throw new BackupError('无法确认其他窗口已关闭：请在线刷新以启用更新后的安全保护，再关闭其他标签页和 PWA。当前数据未修改。');
  const token=crypto.randomUUID();let stopped=false,acquired=false;
  async function request(action:string) {
    return new Promise<boolean>(resolve=>{
      const c=new MessageChannel(),timer=setTimeout(()=>{c.port1.close();resolve(false);},1500);
      c.port1.onmessage=e=>{clearTimeout(timer);c.port1.close();resolve(e.data?.ok===true);};
      try{worker!.postMessage({type:'claudia-restore-lease-v1',action,token},[c.port2]);}catch{clearTimeout(timer);resolve(false);}
    });
  }
  const assert=async()=>{
    checkAbort(signal);
    if(navigator.serviceWorker.controller!==worker||!await request(acquired?'renew':'acquire'))throw new BackupError('等待其他窗口关闭：恢复保护不可用或检测到其他窗口。未提交恢复，请关闭其他标签页及 PWA 后重试。');
    acquired=true;checkAbort(signal);
  };
  try{await assert();}catch(e){await request('release');throw e;}
  const timer=setInterval(()=>{if(!stopped)void assert().catch(invalidate);},5000);
  return {assert,release:async()=>{stopped=true;clearInterval(timer);await request('release');}};
}
