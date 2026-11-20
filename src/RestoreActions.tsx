import {useEffect,useState,useRef} from 'react';
import type Dexie from 'dexie';
import {createPortal} from 'react-dom';
import {restoreToCurrent,previousRestore} from './restoreService';
import {prepareImport,prepareZipImport,defaultImportOptions,type ImportPlan,type ImportOptions,type DataCounts} from './importPlan';
import {publicBackupError} from './backupFormat';
import type {IntegrityReport} from './backupService';
const labels:Record<keyof DataCounts,string>={characters:'角色',conversations:'聊天会话',messages:'消息',worlds:'世界',lorebooks:'世界书',identities:'用户身份（非独立面具）',apiConfigs:'API 配置',timelines:'时间线',assets:'图片资源'};
export function RestoreActions({files,zipFile,report,password,disabled=false,database,encrypted=false,archiveVersion}:{files:File[];zipFile?:File|null;report?:IntegrityReport|null;password?:string;disabled?:boolean;database?:Dexie;encrypted?:boolean;archiveVersion?:number}) {
  const [busy,setBusy]=useState(false),[planning,setPlanning]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[ack,setAck]=useState(false),[done,setDone]=useState(false),[secret,setSecret]=useState('');
  const [options,setOptions]=useState<ImportOptions>({...defaultImportOptions}),[plan,setPlan]=useState<ImportPlan|null>(null),[refresh,setRefresh]=useState(0);
  const committedRef=useRef(false),activePlan=useRef<ImportPlan|null>(null),operation=useRef<AbortController|null>(null);
  const saved=previousRestore(database?.name),signature=JSON.stringify(options);
  useEffect(()=>()=>operation.current?.abort(),[]);
  useEffect(()=>{if(report?.credentials==='included')setOptions(o=>o.keys==='none'?{...o,keys:'missing'}:o);},[report?.manifestDigest,report?.credentials]);
  useEffect(()=>{
    const c=new AbortController();let alive=true;
    const old=activePlan.current;activePlan.current=null;setPlan(null);setAck(false);setError('');
    if(!report||disabled||(!files.length&&!zipFile)){void old?.dispose();return;}
    if(report.credentials==='encrypted'&&!password&&!secret){void old?.dispose();setStatus('请输入备份密码并生成导入预览。');return;}
    setPlanning(true);setStatus('正在生成完整导入预览，当前手机未修改…');
    void(async()=>{try{await old?.dispose();const p=zipFile?await prepareZipImport(zipFile,options,{database,password:secret||password,signal:c.signal}):await prepareImport(files,options,{database,password:secret||password,signal:c.signal});if(!alive){await p.dispose();return;}activePlan.current=p;setPlan(p);setStatus('预览已核对。尚未导入到当前手机。');}catch(e){if(alive){setError(publicBackupError(e,'restore-preview'));setStatus('预览失败，当前手机未修改。');}}finally{if(alive)setPlanning(false);}})();
    return()=>{alive=false;c.abort();void activePlan.current?.dispose();activePlan.current=null;};
  },[report?.manifestDigest,signature,disabled,refresh,zipFile]);
  useEffect(()=>{if(!busy)return;const root=document.getElementById('root'),previous=root?.inert;if(root)root.inert=true;const prevent=(e:BeforeUnloadEvent)=>{if(!committedRef.current)e.preventDefault();};window.addEventListener('beforeunload',prevent);return()=>{if(root)root.inert=previous??false;window.removeEventListener('beforeunload',prevent);};},[busy]);
  function change<K extends keyof ImportOptions>(k:K,v:ImportOptions[K]){
    if(operation.current)return;
    const old=activePlan.current;activePlan.current=null;setPlan(null);setAck(false);void old?.dispose();
    setOptions(o=>{const next={...o,[k]:v};if(k==='api'&&v===false)next.keys='none';if(k==='mode'&&v==='merge')next.desktop=false;return next;});
  }
  const currentPlan=plan&&plan.preview.manifestDigest===report?.manifestDigest&&JSON.stringify(plan.preview.options)===signature&&activePlan.current===plan;

  async function restore(rollback=false){
    if(operation.current||busy||done||disabled||!ack||(!rollback&&!currentPlan))return;
    const text=rollback?'确认用恢复前副本替换全部当前数据（包括副本内的 API 配置和密钥）？当前状态也会先保存回退副本。':`${options.mode==='merge'?'合并导入：保留当前数据，并按预览加入独立副本':'覆盖恢复：替换所选范围，不是合并'}。密钥策略：${options.keys==='none'?'不导入密钥，保留本机密钥':options.keys==='missing'?'只补充缺失密钥，不覆盖已有密钥':'允许替换预览中对应配置的密钥'}。${options.mode==='overwrite'&&options.api&&options.apiReplace?'已选择替换 API 范围：将删除不在备份内的 API 配置和不匹配的密钥。':''}请确认预览，并关闭其他窗口。继续？`;
    if(!confirm(text))return;
    committedRef.current=false;operation.current=new AbortController();setBusy(true);setError('');setStatus('等待其他窗口关闭');let committed=false;
    try{await restoreToCurrent(files,{confirmed:true,password:secret||password,rollback,database,plan:rollback?undefined:plan!,signal:operation.current.signal,onProgress:p=>setStatus(p.phase)});committed=true;committedRef.current=true;setDone(true);setStatus('数据写入并核对完成，正在重启应用复核实际列表…');history.replaceState(null,'','/#spaces');location.reload();}
    catch(e){if(committed){setDone(true);setStatus('数据已提交，请重新打开应用完成启动复核。');return;}setSecret('');setError(publicBackupError(e,'restore-write'));setStatus('导入未提交，当前数据保留。请重新生成预览后再试。');setBusy(false);}
    finally{operation.current=null;}
  }
  if(!report&&!saved)return null;
  return <section className="card form restore-actions" aria-label="恢复到当前手机">
    <h2>导入到当前手机</h2>
    {report&&<>
      <p>备份时间：{new Date(report.snapshotCompletedAt).toLocaleString()} · {archiveVersion?`ZIP v${archiveVersion} / `:'原格式分卷 / '}备份 v{report.formatVersion??(report.schemaVersion===5?1:2)} / 数据 v{report.schemaVersion}</p>
      <p>{encrypted||report.credentials==='encrypted'?'加密备份':'未加密备份'} · {report.credentials==='excluded'?'不包含 API Key':report.credentials==='encrypted'?'包含加密 API Key':'包含 API Key（未加密）'}</p>
      <p className="hint">来源：{report.sourceOrigin??'旧备份未记录来源站点'}<br/>当前：{location.origin}。不同 Netlify／Vercel 域名以及不同浏览器存储容器互不共享本地数据。</p>
      <label>导入模式<select aria-label="导入模式" value={options.mode} disabled={busy} onChange={e=>change('mode',e.target.value as ImportOptions['mode'])}><option value="overwrite">覆盖恢复</option><option value="merge">合并导入</option></select></label>
      <fieldset disabled={busy}><legend>导入范围</legend>{([['story','角色、聊天、世界及世界书（完整关联组）'],['desktop','桌面、布局与主题外观'],['identities','用户身份、头像和世界关联'],['api','API 配置、模型参数和绑定']] as const).map(([k,name])=><label className="backup-check" key={k}><input type="checkbox" checked={options[k]} disabled={options.mode==='merge'&&k==='desktop'} onChange={e=>change(k,e.target.checked)}/>{name}</label>)}</fieldset>
      <p className="hint">资源按内容去重，并保留本机资源，避免破坏未选择的数据。合并保留当前桌面；需要替换外观时请单独选择覆盖恢复。不会按同名角色拼接聊天。</p>
      {options.mode==='merge'&&<><label>剧情冲突处理<select aria-label="剧情冲突处理" value={options.conflicts} onChange={e=>change('conflicts',e.target.value as ImportOptions['conflicts'])}><option value="copy">导入为独立副本，完整重映射关联</option><option value="skip">保留当前，冲突时跳过剧情关联组</option></select></label><label>同空间用户身份冲突<select value={options.identityConflict} onChange={e=>change('identityConflict',e.target.value as ImportOptions['identityConflict'])}><option value="keep">保留当前身份</option><option value="replace">使用备份身份（会替换）</option></select></label></>}
<label>API 配置冲突<select aria-label="API 配置冲突" value={options.apiConflict} onChange={e=>change('apiConflict',e.target.value as ImportOptions['apiConflict'])}><option value="copy">导入为副本，保留当前配置</option><option value="keep">保留当前同 ID 配置</option></select></label>
      <label>API 密钥处理<select aria-label="API 密钥处理" value={options.keys} disabled={report.credentials==='excluded'||!options.api||busy} onChange={e=>change('keys',e.target.value as ImportOptions['keys'])}><option value="none">不导入密钥，保留当前密钥</option><option value="missing">仅补充缺失密钥</option><option value="replace">允许替换对应配置密钥</option></select></label>
      <p className="hint">API 配置冲突默认导入为副本，已有配置和 Key 不会绑定到另一地址。默认保留当前有效默认配置；空手机使用备份默认配置。角色／会话绑定随配置 ID 重映射。</p>
      {report.credentials==='encrypted'&&!password&&<label>备份解密密码<input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)}/></label>}
      <button disabled={busy||planning||disabled} onClick={()=>setRefresh(x=>x+1)}>重新生成导入预览</button>
    </>}
    {plan&&<section aria-label="导入预览"><p>独立面具：0（当前没有独立面具表；用户身份列于下方）。</p><p>{options.mode==='overwrite'?'覆盖所选范围；未选数据保留。下面为备份／当前／完成后的数量。':'合并保留当前数据；下面为备份／当前／完成后的数量。'}</p><dl className="import-counts">{(Object.keys(labels) as (keyof DataCounts)[]).map(k=><div key={k}><dt>{labels[k]}</dt><dd>{plan.preview.incoming[k]} / {plan.preview.current[k]} / {plan.preview.result[k]}{options.mode==='merge'?`（新增 ${plan.preview.added[k]}）`:''}</dd></div>)}</dl><p>凭据将新增 {plan.preview.credentialChanges.added}、替换 {plan.preview.credentialChanges.replaced}、删除 {plan.preview.credentialChanges.removed}、保留／跳过 {plan.preview.credentialChanges.kept}。{plan.preview.credentialChanges.names.length>0?'涉及配置：'+plan.preview.credentialChanges.names.join('、'):'没有凭据变更。'}</p><p>重复记录 {plan.preview.duplicates} · 冲突 {plan.preview.conflicts} · 变更编码大小约 {(plan.preview.bytes/1048576).toFixed(2)} MiB（非峰值内存）。</p>{plan.preview.warnings.map(w=><p className="hint" key={w}>{w}</p>)}</section>}
    <p className="hint">导入前创建并验证本机回退副本，再以全表原子事务提交；失败保留原数据。需要额外本地空间。回退副本含本机凭据，不会上传。</p>
    <label className="backup-check"><input type="checkbox" checked={ack} disabled={busy||planning||disabled} onChange={e=>setAck(e.target.checked)}/>我了解替换范围，已关闭其他标签页和 PWA</label>
    {report&&<button className="primary" disabled={!ack||!currentPlan||busy||planning||disabled||done} onClick={()=>void restore()}>{options.mode==='merge'?'合并导入':'覆盖恢复'}</button>}
    {saved&&<><p className="hint">恢复前副本：{new Date(saved.createdAt).toLocaleString()}。回退也会还原副本内原有 API 配置和密钥。</p><button disabled={!ack||busy||disabled||done} onClick={()=>void restore(true)}>恢复上次恢复前的数据</button></>}
    {error&&<p role="alert">{error}</p>}{!busy&&status&&<p role="status">{planning?'正在生成导入预览…':status}</p>}
    {busy&&createPortal(<div className="restore-maintenance" role="alertdialog" aria-modal="true" aria-label="正在恢复数据"><h2>{status}</h2><p>请保持前台，不要关闭页面。成功提交后仍需重新启动并检查实际数据。</p>{done&&<button onClick={()=>location.reload()}>重新打开 Claudia Phone</button>}</div>,document.body)}
  </section>;
}
