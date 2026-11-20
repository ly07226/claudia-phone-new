import { RestoreActions } from "./RestoreActions";
import {usePhonePageNavigation} from './phonePageNavigation';
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, FileCheck, ShieldCheck } from "lucide-react";
import { usePhone } from "./store";
import { LegacyBackups } from "./LegacyBackups";
import { createZipBackup, inspectBackupZip, openStreamingBackupZip } from "./backupZip";
import { readBackup, type BackupProgress, type IntegrityReport } from "./backupService";
import { checkAbort, publicBackupError, withBackupPhase, type BackupPhase } from "./backupFormat";
export function DataBackups() {
  const s=usePhone();
  const navigation=usePhonePageNavigation();
  const [legacy,setLegacy]=useState(false),[encrypt,setEncrypt]=useState(false),[includeKeys,setIncludeKeys]=useState(false);
  const [password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[restorePassword,setRestorePassword]=useState('');
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[warning,setWarning]=useState('');
  const [output,setOutput]=useState<{file:File;url:string}|null>(null),[selected,setSelected]=useState<File|null>(null),[locked,setLocked]=useState(false),[archiveVersion,setArchiveVersion]=useState<number|undefined>();
  const [report,setReport]=useState<IntegrityReport|null>(null);
  const control=useRef<AbortController|null>(null),task=useRef<Promise<void>>(Promise.resolve()),mounted=useRef(true),url=useRef('');
  const innerPassword=useRef<string>(''),verifiedFiles=useRef<File[]>([]),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    mounted.current=true;s.set({assets:[]});const stop=()=>control.current?.abort(),hidden=()=>{if(document.hidden)stop();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',stop);
    return()=>{mounted.current=false;stop();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',stop);if(url.current)URL.revokeObjectURL(url.current);verifiedFiles.current=[];innerPassword.current='';void task.current.then(async()=>{await usePhone.getState().reload().catch(()=>{});});};
  },[]);
  function resetOutput(){if(url.current)URL.revokeObjectURL(url.current);url.current='';setOutput(null);}
  function run(phase:BackupPhase,work:(signal:AbortSignal)=>Promise<void>){if(control.current)return;const c=new AbortController();control.current=c;setBusy(true);setError('');setWarning('');setProgress('正在准备…');const timer=setTimeout(()=>c.abort(),300000);
    task.current=(async()=>{try{await work(c.signal);}catch(e){if(mounted.current){setError(publicBackupError(e,phase));setProgress('');}}finally{clearTimeout(timer);control.current=null;if(mounted.current){setBusy(false);setPassword('');setRepeat('');setRestorePassword('');}}})();
  }
  async function clearIncoming(){innerPassword.current='';verifiedFiles.current=[];setReport(null);}
  const updateProgress=(p:BackupProgress)=>{if(mounted.current)setProgress(`${p.phase} · ${p.records}条 · ${(p.bytes/1048576).toFixed(1)}MiB，请保持前台…`);};
  function exportData(){
    if(encrypt&&(password.length<12||password.length>1024||password!==repeat)){setError('请设置12–1024个字符的密码，并确保两次输入一致。');return;}
    if(!confirm('请先关闭其他 Claudia Phone 标签页及主屏幕应用，只保留当前页面。是否已完成？'))return;
    const secret=encrypt?password:undefined;
    run('export-read',async signal=>{resetOutput();setSelected(null);await clearIncoming();usePhone.getState().set({assets:[]});const file=await createZipBackup({closedOtherClients:true,password:secret,includeCredentials:includeKeys,credentialConsent:includeKeys,signal,onProgress:updateProgress,onWarning:message=>{if(mounted.current)setWarning(message);}});checkAbort(signal);if(!mounted.current)return;let address:string;try{address=URL.createObjectURL(file);}catch(e){throw withBackupPhase(e,'download');}url.current=address;setOutput({file,url:address});setProgress('备份文件已生成，尚未确认保存。请保存到“文件”，再重新选择该 ZIP 验证。');});
  }
  async function saveFile(){if(!output)return;try{
    if(navigator.canShare?.({files:[output.file]})){await navigator.share({files:[output.file],title:'Claudia Phone 备份'});setProgress('已交给系统处理。请确认保存到“文件”；分享完成不等于备份已验证。');}
    else {const a=document.createElement('a');a.href=output.url;a.download=output.file.name;document.body.append(a);a.click();a.remove();setProgress('已请求系统下载。请确认文件实际保存，并重新选择 ZIP 验证。');}
  }catch(e){setError(publicBackupError(e,'share')+' 可再次保存或使用“直接下载 ZIP”；不会重新生成备份。');}}
  async function verify(file:File,secret:string|undefined,signal:AbortSignal){
    const zip=await openStreamingBackupZip(file,signal);
    let checked;
    try{
      const manifests=zip.names.filter(n=>n.endsWith('.manifest.json'));
      if(manifests.length!==1)throw new Error('ZIP 缺少唯一的备份清单。');
      const manifest=await zip.read(manifests[0],secret);
      const names=zip.names.filter(n=>n!=='wechat-identity.encrypted.json');
      checked=await readBackup([manifest],{mode:'verify',password:secret,signal,onProgress:updateProgress,partNames:names,loadPart:n=>zip.read(n,secret)});
    }catch(e){throw withBackupPhase(e,'zip-verify');}
    finally{await zip.close();}
    await checked.dispose();checkAbort(signal);if(!mounted.current)return;
    verifiedFiles.current=[];innerPassword.current=checked.report.credentials==='encrypted'?(secret??''):'';
    setReport(checked.report);setProgress('备份验证成功，尚未恢复到当前手机。');
  }
  function selectFile(file:File){run('zip-read',async signal=>{resetOutput();setSelected(file);setLocked(false);await clearIncoming();const header=await inspectBackupZip(file,signal);checkAbort(signal);if(!mounted.current)return;setLocked(header.encrypted);setArchiveVersion(header.version);if(header.encrypted)setProgress('这份备份已加密，请输入密码验证。');else await verify(file,undefined,signal);});}
  if(legacy)return <LegacyBackups onBack={()=>{setLegacy(false);setProgress('');setError('');}}/>;
  return <main className="space-selection"><div className="space-select-shell backup-page backup-simple">
    <button className="space-back" onClick={()=>{control.current?.abort();navigation.back();}}><ChevronLeft size={18}/>返回{navigation.parentName}</button>
    <div className="page-title"><h1>数据备份与恢复</h1><p>一份文件，妥善保存你的 Claudia Phone。</p></div>
    <section className="card form" aria-label="导出备份设置">
      <label className="backup-check"><input type="checkbox" role="switch" aria-label="加密保护" checked={encrypt} disabled={busy||includeKeys} onChange={e=>{setEncrypt(e.target.checked);resetOutput();setPassword('');setRepeat('');}}/>加密保护</label>
      <label className="backup-check"><input type="checkbox" role="switch" aria-label="包含 API 密钥（需要加密备份）" checked={includeKeys} disabled={busy} onChange={e=>{setIncludeKeys(e.target.checked);if(e.target.checked)setEncrypt(true);resetOutput();}}/>包含 API 密钥（需要加密备份）</label>
      {encrypt&&<><label>设置备份密码<input type="password" aria-label="备份加密密码" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>确认密码<input type="password" aria-label="再次输入密码" autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)}/></label><p className="hint">{includeKeys?'数据使用 AES-256-GCM + PBKDF2-SHA256（60万次）加密；ZIP 清单结构可见。':'使用 WinZip AES-256 加密。'}密码不会保存，忘记后无法找回；请使用至少12个字符的独立长密码。请在本应用中输入密码并验证、恢复数据。</p></>}
      <p className="hint">{includeKeys?'包含 API Key，必须加密，请勿公开分享。':'默认不包含 API Key。API 配置、模型参数和绑定仍包含。'}{encrypt?'加密后仍请妥善保管文件。':'未加密 ZIP 可能包含私人聊天、角色和图片，请勿公开分享。'}文件不会自动上传；选择云盘或分享目标由你决定。</p>
      <button className="primary" disabled={busy} onClick={()=>output?void saveFile():exportData()}><Download size={18}/>{busy?'正在处理…':output?'保存或分享备份':'导出备份'}</button>
      {output&&<><p className="backup-filename">{output.file.name} · {(output.file.size/1048576).toFixed(1)} MiB</p><a className="text-button backup-download" href={output.url} download={output.file.name}>直接下载 ZIP</a><button className="text-button" disabled={busy} onClick={exportData}>重新生成备份</button></>}
    </section>
    <section className="card form"><h2><FileCheck size={18}/>恢复备份</h2><input ref={input} type="file" hidden accept=".zip,application/zip,application/x-zip-compressed" aria-label="选择 ZIP 备份" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)selectFile(file);}}/><button disabled={busy} onClick={()=>input.current?.click()}>选择 ZIP 备份</button>
      <p className="hint">从“文件”App选择一份 ZIP。先检查，再由你确认；不会在选择文件后覆盖聊天。</p>
      {selected&&<p className="backup-filename">已选择：{selected.name}</p>}
      {selected&&locked&&!report&&<><label>备份密码<input type="password" aria-label="解密备份密码" autoComplete="off" value={restorePassword} onChange={e=>setRestorePassword(e.target.value)}/></label><button disabled={busy||!restorePassword} onClick={()=>run('zip-verify',signal=>verify(selected,restorePassword,signal))}>验证加密备份</button></>}
    </section>
    {busy&&<button className="text-button" onClick={()=>control.current?.abort()}>取消当前操作</button>}
    {warning&&<p role="note" className="space-notice">{warning}</p>}{progress&&<p role="status" className="space-notice">{progress}</p>}{error&&<p role="alert" className="space-notice">{error}</p>}
    {report&&<section className="card backup-report" aria-label="校验报告"><h2><ShieldCheck size={18}/>备份已验证</h2><p>备份日期：{new Date(report.snapshotCompletedAt).toLocaleString()}</p><p>已核对 {report.totalRecords} 条记录、{report.resources} 个图片资源。角色 {report.counts.characters??0}，日常可见好友 {report.dailyVisibleCharacters??0}，会话 {report.counts.conversations??0}，消息 {report.counts.messages??0}，世界 {report.counts.worlds??0}，世界书 {report.counts.lorebooks??0}，用户身份 {report.identities??0}，API 配置 {report.counts.apiConfigs??0}，时间线 {report.counts.timelines??0}。</p><p>数据范围：聊天与版本、角色、世界、世界书、桌面、用户资料及备份支持的时间线数据。当前手机数据未修改。</p><button disabled={busy} onClick={()=>setProgress('备份验证成功，尚未恢复到当前手机。')}>仅验证备份</button></section>}
    <RestoreActions zipFile={selected} files={verifiedFiles.current} report={report} password={innerPassword.current} encrypted={locked} archiveVersion={archiveVersion} disabled={busy}/>
    <details className="backup-advanced"><summary>高级选项</summary><p className="hint">单个 ZIP 上限32 MiB，采用分块处理。更大数据可使用原格式工具逐个保存，所有数据仍会完整保留。</p><button disabled={busy} onClick={()=>{resetOutput();void clearIncoming().then(()=>{setSelected(null);setLegacy(true);}).catch(()=>setError('旧备份工具暂时无法打开，请重试。'));}}>旧格式备份工具</button><p className="hint">支持旧清单和数据文件、旧加密密码格式，以及大文件备份。</p></details>
  </div></main>;
}
