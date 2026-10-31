import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, FileCheck, ShieldCheck } from "lucide-react";
import { usePhone } from "./store";
import { LegacyBackups } from "./LegacyBackups";
import { createZipBackup, inspectBackupZip, readBackupZip } from "./backupZip";
import { readBackup, type IntegrityReport, type ReadbackResult } from "./backupService";
import { checkAbort, publicBackupError } from "./backupFormat";
export function DataBackups() {
  const s=usePhone();
  const [legacy,setLegacy]=useState(false),[encrypt,setEncrypt]=useState(false);
  const [password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[restorePassword,setRestorePassword]=useState('');
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');
  const [output,setOutput]=useState<{file:File;url:string}|null>(null),[selected,setSelected]=useState<File|null>(null),[locked,setLocked]=useState(false);
  const [report,setReport]=useState<IntegrityReport|null>(null),[candidate,setCandidate]=useState(false);
  const control=useRef<AbortController|null>(null),task=useRef<Promise<void>>(Promise.resolve()),mounted=useRef(true),url=useRef('');
  const verifiedFiles=useRef<File[]>([]),candidateRef=useRef<ReadbackResult|null>(null),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    mounted.current=true;s.set({assets:[]});const stop=()=>control.current?.abort(),hidden=()=>{if(document.hidden)stop();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',stop);
    return()=>{mounted.current=false;stop();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',stop);if(url.current)URL.revokeObjectURL(url.current);verifiedFiles.current=[];void task.current.then(async()=>{await candidateRef.current?.dispose().catch(()=>{});await usePhone.getState().reload().catch(()=>{});});};
  },[]);
  function resetOutput(){if(url.current)URL.revokeObjectURL(url.current);url.current='';setOutput(null);}
  function run(work:(signal:AbortSignal)=>Promise<void>){if(control.current)return;const c=new AbortController();control.current=c;setBusy(true);setError('');setProgress('正在准备…');const timer=setTimeout(()=>c.abort(),300000);
    task.current=(async()=>{try{await work(c.signal);}catch(e){if(mounted.current){setError(publicBackupError(e));setProgress('');}}finally{clearTimeout(timer);control.current=null;if(mounted.current){setBusy(false);setPassword('');setRepeat('');setRestorePassword('');}}})();
  }
  async function clearIncoming(){verifiedFiles.current=[];setReport(null);setCandidate(false);await candidateRef.current?.dispose();candidateRef.current=null;}
  const updateProgress=()=>{if(mounted.current)setProgress('正在处理本地数据，请保持页面在前台…');};
  function exportData(){
    if(encrypt&&(password.length<12||password.length>1024||password!==repeat)){setError('请设置12–1024个字符的密码，并确保两次输入一致。');return;}
    if(!confirm('请先关闭其他 Claudia Phone 标签页及主屏幕应用，只保留当前页面。是否已完成？'))return;
    const secret=encrypt?password:undefined;
    run(async signal=>{resetOutput();setSelected(null);await clearIncoming();usePhone.getState().set({assets:[]});const file=await createZipBackup({closedOtherClients:true,password:secret,signal,onProgress:updateProgress});checkAbort(signal);if(!mounted.current)return;const address=URL.createObjectURL(file);url.current=address;setOutput({file,url:address});setProgress('备份文件已生成，尚未确认保存。请保存到“文件”，再重新选择该 ZIP 验证。');});
  }
  async function saveFile(){if(!output)return;try{
    if(navigator.canShare?.({files:[output.file]})){await navigator.share({files:[output.file],title:'Claudia Phone 备份'});setProgress('已交给系统处理。请确认保存到“文件”；分享完成不等于备份已验证。');}
    else {const a=document.createElement('a');a.href=output.url;a.download=output.file.name;document.body.append(a);a.click();a.remove();setProgress('已请求系统下载。请确认文件实际保存，并重新选择 ZIP 验证。');}
  }catch(e){setError(e instanceof DOMException&&e.name==='AbortError'?'已取消保存或分享，可以再次操作。':'系统分享未完成，请使用“直接下载 ZIP”保存。');}}
  async function verify(file:File,secret:string|undefined,signal:AbortSignal){const files=await readBackupZip(file,secret,signal);const checked=await readBackup(files,{mode:'verify',signal,onProgress:updateProgress});await checked.dispose();checkAbort(signal);if(!mounted.current)return;verifiedFiles.current=files;setReport(checked.report);setProgress('备份已验证，请检查日期与内容后确认恢复。当前手机数据未被修改。');}
  function selectFile(file:File){run(async signal=>{resetOutput();setSelected(file);setLocked(false);await clearIncoming();const header=await inspectBackupZip(file,signal);checkAbort(signal);if(!mounted.current)return;setLocked(header.encrypted);if(header.encrypted)setProgress('这份备份已加密，请输入密码验证。');else await verify(file,undefined,signal);});}
  function restore(){if(!report||!verifiedFiles.current.length)return;
    if(!confirm('确认将这份备份恢复到独立的安全副本？当前手机的聊天和设置不会被替换。副本只用于本次演练，离开页面后移除。'))return;
    run(async signal=>{setCandidate(false);await candidateRef.current?.dispose();candidateRef.current=null;const result=await readBackup(verifiedFiles.current,{mode:'rehearse',signal,onProgress:updateProgress});if(!mounted.current||signal.aborted){await result.dispose();checkAbort(signal);return;}candidateRef.current=result;setReport(result.report);setCandidate(true);setProgress('已恢复到安全副本并完成核对。当前手机的原有数据未被替换。');});
  }
  if(legacy)return <LegacyBackups onBack={()=>{setLegacy(false);setProgress('');setError('');}}/>;
  return <main className="space-selection"><div className="space-select-shell backup-page backup-simple">
    <button className="space-back" onClick={()=>{control.current?.abort();s.set({activeApp:'设置'});}}><ChevronLeft size={18}/>返回设置</button>
    <div className="page-title"><h1>数据备份与恢复</h1><p>一份文件，妥善保存你的 Claudia Phone。</p></div>
    <section className="card form" aria-label="导出备份设置">
      <label className="backup-check"><input type="checkbox" role="switch" aria-label="加密保护" checked={encrypt} disabled={busy} onChange={e=>{setEncrypt(e.target.checked);resetOutput();setPassword('');setRepeat('');}}/>加密保护</label>
      {encrypt&&<><label>设置备份密码<input type="password" aria-label="备份加密密码" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>确认密码<input type="password" aria-label="再次输入密码" autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)}/></label><p className="hint">使用 AES-256 加密。密码不会保存，忘记后无法找回；请使用至少12个字符的独立长密码。部分系统解压工具不支持此加密，可在本应用中恢复。</p></>}
      <p className="hint">默认不包含 API Key。{encrypt?'加密后仍请妥善保管文件。':'未加密 ZIP 可能包含私人聊天、角色和图片，请勿公开分享。'}文件不会自动上传；选择云盘或分享目标由你决定。</p>
      <button className="primary" disabled={busy} onClick={()=>output?void saveFile():exportData()}><Download size={18}/>{busy?'正在处理…':output?'保存或分享备份':'导出备份'}</button>
      {output&&<><p className="backup-filename">{output.file.name} · {(output.file.size/1048576).toFixed(1)} MiB</p><a className="text-button backup-download" href={output.url} download={output.file.name}>直接下载 ZIP</a><button className="text-button" disabled={busy} onClick={exportData}>重新生成备份</button></>}
    </section>
    <section className="card form"><h2><FileCheck size={18}/>恢复备份</h2><input ref={input} type="file" hidden accept=".zip,application/zip,application/x-zip-compressed" aria-label="选择 ZIP 备份" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)selectFile(file);}}/><button disabled={busy} onClick={()=>input.current?.click()}>选择 ZIP 备份</button>
      <p className="hint">从“文件”App选择一份 ZIP。先检查，再由你确认；不会在选择文件后覆盖聊天。</p>
      {selected&&<p className="backup-filename">已选择：{selected.name}</p>}
      {selected&&locked&&!report&&<><label>备份密码<input type="password" aria-label="解密备份密码" autoComplete="off" value={restorePassword} onChange={e=>setRestorePassword(e.target.value)}/></label><button disabled={busy||!restorePassword} onClick={()=>run(signal=>verify(selected,restorePassword,signal))}>验证加密备份</button></>}
    </section>
    {busy&&<button className="text-button" onClick={()=>control.current?.abort()}>取消当前操作</button>}
    {progress&&<p role="status" className="space-notice">{progress}</p>}{error&&<p role="alert" className="space-notice">{error}</p>}
    {report&&<section className="card backup-report" aria-label="校验报告"><h2><ShieldCheck size={18}/>{candidate?'恢复核对通过':'备份已验证'}</h2><p>备份日期：{new Date(report.snapshotCompletedAt).toLocaleString()}</p><p>已核对 {report.totalRecords} 条记录、{report.resources} 个图片资源。</p><p>数据范围：聊天与版本、角色、世界、世界书、桌面、用户资料及备份支持的时间线数据。当前手机数据未修改。</p>{!candidate&&<button className="primary" disabled={busy} onClick={restore}>确认恢复到安全副本</button>}<p className="hint">本次提供安全恢复演练，不替换当前手机的数据；离开页面后移除演练副本。</p></section>}
    <details className="backup-advanced"><summary>高级选项</summary><p className="hint">单个 ZIP 上限32 MiB，采用分块处理。更大数据可使用原格式工具逐个保存，所有数据仍会完整保留。</p><button disabled={busy} onClick={()=>{resetOutput();void clearIncoming().then(()=>{setSelected(null);setLegacy(true);}).catch(()=>setError('旧备份工具暂时无法打开，请重试。'));}}>旧格式备份工具</button><p className="hint">支持旧清单和数据文件、旧加密密码格式，以及大文件备份。</p></details>
  </div></main>;
}
