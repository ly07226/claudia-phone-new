import React,{useState} from 'react';
import {cloudConfigured,hasCloudIdentity} from './cloudIdentity';

/** Honest opt-in entry: no fake QR or browser-side Supabase admin keys. */
export function WechatIntegrationSettings(){
 const [expanded,setExpanded]=useState(false);
 const configured=cloudConfigured();
 return <section className="card form" aria-label="微信接入设置">
  <h3>微信接入</h3>
  <p>把日常聊天角色接入微信。只在主动开启后使用云端服务，不影响原有聊天和其他世界。</p>
  <div className="list-row" style={{justifyContent:'space-between'}}>
   <span>共享云端后台</span><strong>{configured?'已配置':'尚未配置'}</strong>
  </div>
  <div className="list-row" style={{justifyContent:'space-between'}}>
   <span>本设备云端身份</span><strong>{hasCloudIdentity()?'已有匿名身份':'尚未创建'}</strong>
  </div>
  <div className="list-row" style={{justifyContent:'space-between'}}>
   <span>微信扫码绑定</span><strong>暂未开放</strong>
  </div>
  <button type="button" onClick={()=>setExpanded(v=>!v)}
   aria-expanded={expanded}>{expanded?'收起说明':'查看接入说明'}</button>
  {expanded&&<div>
   <p>普通使用者无需自己注册 Supabase 或填写 URL、密钥。后台由小手机部署者统一配置，聊天与微信账号按用户隔离。</p>
   <p>微信扫码、真实消息收发和云端 AI 授权仍在开发中。当前不支持输入或上传 API Key，也不会自动启用云端回复。</p>
   <p>普通日常聊天无需登录。微信接入未来需要可恢复的账号绑定，防止换手机后丢失关联。</p>
  </div>}
 </section>;
}
