import React,{useEffect,useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {db} from './store';
import {startWechatLogin,pollWechatLogin} from './wechatQrLogin';
import {listWechatCloudBindings} from './wechatCloudIdentity';
import {clearWechatCloudConfig,readWechatCloudConfig,saveWechatCloudConfig} from './wechatCloudConfig';

/** WeChat-only opt-in configuration; no cross-user shared project. */
export function WechatIntegrationSettings(){
 const initial=readWechatCloudConfig();
 const [section,setSection]=useState<'cloud'|'account'|null>(null);
 const [url,setUrl]=useState(initial?.url??'');
 const [key,setKey]=useState(initial?.publishableKey??'');
 const [configured,setConfigured]=useState(!!initial);
 const [notice,setNotice]=useState('');
 const [bindings,setBindings]=useState<Array<{id:string;character_id:string;conversation_id:string;status:string}>|null>(null);
 const [loading,setLoading]=useState(false);
 const [daily,setDaily]=useState<Array<{id:string;characterId:string}>>([]);
 const [target,setTarget]=useState('');
 const [qr,setQr]=useState<{attemptId:string;qrContent:string;expiresAt:string}|null>(null);
 const [qrStatus,setQrStatus]=useState('未开始');
 const [polling,setPolling]=useState(false);
 const [pollTick,setPollTick]=useState(0);
 useEffect(()=>{
  if(section!=='account')return;
  let active=true;
  void db.conversations.toArray().then(rows=>{
   if(!active)return;
   const list=rows.filter(c=>c.mode==='daily'&&!c.worldId).map(c=>({id:c.id,characterId:c.characterId}));
   setDaily(list);setTarget(current=>current&&list.some(c=>c.id===current)?current:list[0]?.id??'');
  }).catch(()=>setNotice('无法读取日常聊天列表。'));
  return ()=>{active=false;};
 },[section]);
 const begin=async()=>{
  const chosen=daily.find(c=>c.id===target);
  if(!chosen)return setNotice('请选择一个日常角色。');
  setLoading(true);setNotice('');setQr(null);
  try{setQr(await startWechatLogin(chosen.id,chosen.characterId));setQrStatus('等待扫码');}
  catch(error){setNotice(error instanceof Error?error.message:'无法获取二维码');}
  finally{setLoading(false);}
 };
 useEffect(()=>{
  if(!qr||section!=='account'||qrStatus==='已连接'||qrStatus==='已过期')return;
  let cancelled=false;
  const timer=window.setTimeout(async()=>{
   if(cancelled)return;
   setPolling(true);
   try{
    const result=await pollWechatLogin(qr.attemptId);
    if(cancelled)return;
    const names:Record<string,string>={wait:'等待扫码',scaned:'已扫码，请在微信确认',confirmed:'已连接',
      expired:'已过期',need_verifycode:'需要微信验证码（暂不支持）',
      verify_code_blocked:'验证被限制',scaned_but_redirect:'需要服务端跳转支持',
      binded_redirect:'该微信账号已有绑定'};
    setQrStatus(names[result.status]??result.status);
    if(result.status==='confirmed')void load();
    if(result.status==='wait'||result.status==='scaned')setPollTick(v=>v+1);
   }catch(error){if(!cancelled)setNotice(error instanceof Error?error.message:'扫码状态查询失败');}
   finally{if(!cancelled)setPolling(false);}
  },2000);
  return ()=>{cancelled=true;window.clearTimeout(timer);};
 },[qr,section,qrStatus,pollTick]);
 const load=async()=>{
  if(loading)return;
  setLoading(true);setNotice('');
  try{setBindings(await listWechatCloudBindings());}
  catch(error){setNotice(error instanceof Error?error.message:'绑定查询失败');}
  finally{setLoading(false);}
 };
 const save=()=>{
  try{saveWechatCloudConfig({url,publishableKey:key});setConfigured(true);setNotice('微信专用 Supabase 公共配置已保存在本设备。尚未连接微信或部署云端服务。');}
  catch(error){setNotice(error instanceof Error?error.message:'配置保存失败');}
 };
 const clear=()=>{clearWechatCloudConfig();setConfigured(false);setUrl('');setKey('');setNotice('本设备的微信云端配置已清除。云端已有数据不会因此自动删除。');};
 return <section className="card form" aria-label="微信接入">
  <h3>微信接入</h3>
  <p>微信接入使用你自己的云端项目，不会把聊天上传到网站维护者的 Supabase。</p>
  <button type="button" className="list-row" onClick={()=>{setSection(section==='cloud'?null:'cloud');setNotice('');}}>
   <span>微信共享云端后台</span><span style={{marginLeft:'auto'}}>{configured?'已填写':'未配置'}　›</span>
  </button>
  {section==='cloud'&&<div className="card form">
   <p>填写自己的 Supabase 项目 URL 和公开的 publishable / anon Key。不要填写 service_role、secret Key 或数据库密码。</p>
   <label>Supabase 项目 URL
    <input type="url" value={url} onChange={e=>setUrl(e.target.value)}
     placeholder="https://your-project.supabase.co" autoComplete="off"/>
   </label>
   <label>Supabase publishable / anon 公钥
    <input type="text" value={key} onChange={e=>setKey(e.target.value)}
     placeholder="sb_publishable_… 或 anon Key" autoComplete="off"/>
   </label>
   <button type="button" onClick={save}>保存本设备配置</button>
   {configured&&<button type="button" onClick={clear}>清除本设备配置</button>}
   <p>保存配置不代表云端已经部署，也不会自动创建账号或上传本地 API Key。</p>
  </div>}
  <button type="button" className="list-row" onClick={()=>{setSection(section==='account'?null:'account');setNotice('');}}>
   <span>微信账号绑定</span><span style={{marginLeft:'auto'}}>尚未连接　›</span>
  </button>
  {section==='account'&&<div className="card form">
   <p>真实微信扫码绑定尚未完成。这里只查询你自己 Supabase 项目下的绑定记录；其他世界不会接入。</p>
   <button type="button" disabled={!configured||loading} onClick={()=>void load()}>
    {loading?'正在查询…':'查询我的微信绑定'}
   </button>
   {bindings!==null&&<div aria-live="polite">
    {bindings.length===0?<p>当前没有微信绑定记录。</p>:
     bindings.map(b=><div key={b.id} className="list-row">
      <span>角色 {b.character_id}</span><span style={{marginLeft:'auto'}}>{b.status}</span>
     </div>)}
   </div>}
   <label>选择日常聊天角色
    <select value={target} onChange={e=>setTarget(e.target.value)} disabled={!!qr&&qrStatus!=='已过期'}>
     {daily.map(d=><option key={d.id} value={d.id}>{d.characterId}</option>)}
    </select>
   </label>
   <button type="button" disabled={!configured||!target||loading} onClick={()=>void begin()}>
    {loading?'正在获取二维码…':qr?'重新生成二维码':'生成微信登录二维码'}
   </button>
   {qr&&<div className="card form" aria-live="polite">
    <p>使用微信扫一扫，并在微信中确认授权。</p>
    <div style={{background:'#fff',padding:16,width:'fit-content',maxWidth:'100%',margin:'auto'}}>
     <QRCodeSVG value={qr.qrContent} size={220} level="M" marginSize={2}/>
    </div>
    <p>扫码状态：{qrStatus}{polling?' · 查询中':''}</p>
    <p>二维码过期时间：{new Date(qr.expiresAt).toLocaleTimeString()}</p>
   </div>}
   <p>仅保存 Supabase 配置还不能让微信自动回复。云端 AI 需要额外授权，且必须能在手机关闭后安全运行。</p>
  </div>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
