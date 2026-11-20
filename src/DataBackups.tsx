import { RestoreActions } from "./RestoreActions";
import {usePhonePageNavigation} from './phonePageNavigation';
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, FileCheck, ShieldCheck } from "lucide-react";
import { usePhone } from "./store";
import { LegacyBackups } from "./LegacyBackups";
import { createZipBackup, inspectBackupZip, openStreamingBackupZip, validateBackupZipIdentity } from "./backupZip";
import { readBackup, type BackupProgress, type IntegrityReport } from "./backupService";
import { checkAbort, publicBackupError, withBackupPhase, type BackupPhase } from "./backupFormat";
export function DataBackups() {
  const s=usePhone();
  const navigation=usePhonePageNavigation();
  const [legacy,setLegacy]=useState(false);
  const [restorePassword,setRestorePassword]=useState('');
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
    task.current=(async()=>{try{await work(c.signal);}catch(e){if(mounted.current){setError(publicBackupError(e,phase));setProgress('');}}finally{clearTimeout(timer);control.current=null;if(mounted.current){setBusy(false);setRestorePassword('');}}})();
  }
  async function clearIncoming(){innerPassword.current='';verifiedFiles.current=[];setReport(null);}
  const updateProgress=(p:BackupProgress)=>{if(mounted.current)setProgress(`${p.phase} · ${p.records}条 · ${(p.bytes/1048576).toFixed(1)}MiB，请保持前台…`);};
  function exportData(){
    if(!confirm('请先关闭其他 Claudia Phone 标签页及主屏幕应用，只保留当前页面。是否已完成？'))return;
    run('export-read',async signal=>{resetOutput();setSelected(null);await clearIncoming();usePhone.getState().set({assets:[]});const file=await createZipBackup({closedOtherClients:true,includeCredentials:true,credentialConsent:true,signal,onProgress:updateProgress,onWarning:message=>{if(mounted.current)setWarning(message);}});checkAbort(signal);if(!mounted.current)return;let address:string;try{address=URL.createObjectURL(file);}catch(e){throw withBackupPhase(e,'download');}url.current=address;setOutput({file,url:address});setProgress('备份文件已生成，尚未确认保存。请保存到“文件”，再重新选择该 ZIP 验证。');});
  }
  async function saveFile(){if(!output)return;try{
    if(navigator.canShare?.({files:[output.file]})){await navigator.share({files:[output.file],title:'Claudia Phone 备份'});setProgress('已交给系统处理。请确认保存到“文件”；分享完成不等于备份已验证。');}
    else {const a=document.createElement('a');a.href=output.url;a.download=output.file.name;document.body.append(a);a.click();a.remove();setProgress('已请求系统下载。请确认文件实际保存，并重新选择 ZIP 验证。');}
  }catch(e){setError(publicBackupError(e,'share')+' 可再次保存或使用“直接下载 ZIP”；不会重新生成备份。');}}
  async function verify(file:File,secret:string|undefined,signal:AbortSignal){
    const zip=await openStreamingBackupZip(file,signal);
    let checked;
    try{
      await validateBackupZipIdentity(zip,secret);
      const manifests=zip.names.filter(n=>n.endsWith('.manifest.json'));
      if(manifests.length!==1)throw new Error('ZIP 缺少唯一的备份清单。');
      const manifest=await zip.read(manifests[0],secret);
      const names=zip.names.filter(n=>n!=='wechat-identity.encrypted.json');
      const parsed=JSON.parse(await manifest.text());
      if(!Array.isArray(parsed.parts)||!parsed.parts.every((p:{name?:unknown})=>typeof p.name==='string'))throw new Error('ZIP 备份清单无效。');
      const expected=[manifests[0],...parsed.parts.map((p:{name:string})=>p.name)];
      if(expected.length!==names.length||new Set(expected).size!==expected.length||!expected.every(n=>names.includes(n)))throw new Error('ZIP 内存在缺失、重复或未知数据文件。');
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
      <p className="hint">直接导出单个 ZIP，无需设置密码。包含聊天、角色、世界、图片、API 配置及 API Key。ZIP 不设密码，任何获得文件的人都能读取其中的聊天和密钥，请勿分享或上传至不可信位置。</p>
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
    <details className="backup-advanced"><summary>高级选项</summary><p className="hint">单个 ZIP 上限 1024 MiB，解压总量上限 2048 MiB。内部按需读取，最终只生成一个 ZIP 文件。</p><button disabled={busy} onClick={()=>{resetOutput();void clearIncoming().then(()=>{setSelected(null);setLegacy(true);}).catch(()=>setError('旧备份工具暂时无法打开，请重试。'));}}>旧格式备份工具</button><p className="hint">支持旧清单和数据文件、旧加密密码格式，以及大文件备份。</p></details>
  </div></main>;
}
