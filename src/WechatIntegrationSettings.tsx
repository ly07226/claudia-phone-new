import React,{useState} from 'react';
import {clearWechatCloudConfig,readWechatCloudConfig,saveWechatCloudConfig} from './wechatCloudConfig';

/** WeChat-only opt-in configuration; no cross-user shared project. */
export function WechatIntegrationSettings(){
 const initial=readWechatCloudConfig();
 const [section,setSection]=useState<'cloud'|'account'|null>(null);
 const [url,setUrl]=useState(initial?.url??'');
 const [key,setKey]=useState(initial?.publishableKey??'');
 const [configured,setConfigured]=useState(!!initial);
 const [notice,setNotice]=useState('');
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
   <p>真实微信扫码绑定尚未完成。后续在这里选择日常角色并完成微信账号授权；其他世界不会接入。</p>
   <p>仅保存 Supabase 配置还不能让微信自动回复。云端 AI 需要额外授权，且必须能在手机关闭后安全运行。</p>
  </div>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
