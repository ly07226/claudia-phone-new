import {useEffect,useState,useRef} from 'react';
import type Dexie from 'dexie';
import {createPortal} from 'react-dom';
import {restoreToCurrent,previousRestore} from './restoreService';
import {publicBackupError} from './backupFormat';
import type {IntegrityReport} from './backupService';
export function RestoreActions({files,report,password,disabled=false,database}:{files:File[];report?:IntegrityReport|null;password?:string;disabled?:boolean;database?:Dexie}) {
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[ack,setAck]=useState(false),[done,setDone]=useState(false);
  const saved=previousRestore(database?.name);
  const operation=useRef<AbortController|null>(null);
  useEffect(()=>()=>operation.current?.abort(),[]);
  const [secret,setSecret]=useState('');
  useEffect(()=>{setAck(false);setError('');setStatus('');},[report?.manifestDigest]);
  useEffect(()=>{if(!busy)return;const root=document.getElementById('root'),previous=root?.inert;if(root)root.inert=true;const prevent=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',prevent);return()=>{if(root)root.inert=previous??false;window.removeEventListener('beforeunload',prevent);};},[busy]);
  async function restore(rollback=false){
    if(operation.current||busy||done||disabled||!ack)return;
    if(!confirm(rollback?'确认用恢复前副本替换当前手机的全部数据（包括副本内原有 API 配置和密钥）？当前状态也会先保存回退副本。':'再次确认：用备份替换当前手机的聊天、角色、世界、桌面和资源？不是合并。当前 API 配置和密钥保留。恢复前将创建并校验回退副本。请关闭其他窗口并保持前台。'))return;
    operation.current=new AbortController();setBusy(true);setError('');setStatus('等待其他窗口关闭');
    let committed=false;
    try{await restoreToCurrent(files,{confirmed:true,password:secret||password,rollback,database,signal:operation.current.signal,onProgress:p=>setStatus(p.phase)});committed=true;setDone(true);setStatus('恢复成功，正在重新打开 Claudia Phone…');history.replaceState(null,'','/#spaces');location.reload();}
    catch(e){if(committed){setDone(true);setStatus('恢复成功，请重新打开 Claudia Phone 读取恢复后的数据。');return;}setSecret('');setError(publicBackupError(e));setStatus('恢复失败，当前数据未替换。');setBusy(false);}
    finally{operation.current=null;}
  }
  if(!report&&!saved)return null;
  return <section className="card form restore-actions" aria-label="恢复到当前手机">
    <h2>恢复到当前手机</h2>
    {report&&<><p>备份时间：{new Date(report.snapshotCompletedAt).toLocaleString()}</p><p>聊天消息 {report.counts.messages??0} · 角色 {report.counts.characters??0} · 世界 {report.counts.worlds??0} · 图片 {report.resources} · 时间线 {report.counts.timelines??0}</p><p>备份{report.credentials==='excluded'?'不包含 API Key':'包含加密 API Key'}。本次保留当前手机全部 API 配置与密钥，不从备份覆盖；角色绑定失效时需重新选择 API。</p></>}
    <p className="hint">恢复会替换当前聊天、角色、世界、主题、桌面及资源，不是合并。先完整验证备份并保存本机回退副本，再以单个原子事务写入；失败则保留原数据。回退副本仅保存在本浏览器，含当前本地凭据，请勿公开分享。</p>
    {report?.credentials==='encrypted'&&<label>旧格式备份解密密码<input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)}/></label>}
    <label className="backup-check"><input type="checkbox" checked={ack} disabled={busy||disabled} onChange={e=>setAck(e.target.checked)}/>我了解替换范围，已关闭其他标签页和 PWA</label>
    {report&&<button className="primary" disabled={!ack||busy||disabled||done} onClick={()=>void restore()}>恢复到当前手机</button>}
    {saved&&<><p className="hint">恢复前副本：{new Date(saved.createdAt).toLocaleString()}，可用于回退。回退还会还原副本内原有 API 配置和密钥。</p><button disabled={!ack||busy||disabled||done} onClick={()=>void restore(true)}>恢复上次恢复前的数据</button></>}
    {error&&<p role="alert">{error}</p>}
    {busy&&createPortal(<div className="restore-maintenance" role="alertdialog" aria-modal="true" aria-label="正在恢复数据"><h2>{done?'恢复成功':status}</h2><p>{done?status:'请保持前台，不要关闭页面。恢复过程中暂时停止其他操作。'}</p>{done&&<button onClick={()=>location.reload()}>重新打开 Claudia Phone</button>}</div>,document.body)}
    {!busy&&status&&<p role="status">{status}</p>}
  </section>;
}
