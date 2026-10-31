import { useEffect, useRef, useState } from "react";
import { chatColors, searchConversation, type ChatSettingsPatch } from "./chatPreferences";
import { upload } from "./store";
import type { Conversation } from "./chatTypes";
export function ConversationSearch({ id, onLocate }: {id:string;onLocate:(id:string)=>void}) {
  const [query,setQuery]=useState("");
  const [rows,setRows]=useState<Awaited<ReturnType<typeof searchConversation>>>([]);
  const [error,setError]=useState("");
  const [limit,setLimit]=useState(50);
  useEffect(()=>{let active=true;setRows([]);setError("");setLimit(50);if(query.trim())void searchConversation(id,query).then(r=>{if(active)setRows(r);}).catch(()=>{if(active)setError("读取聊天记录失败，请稍后重试。");});return()=>{active=false;};},[id,query]);
  return <><label className="chat-search"><input type="search" aria-label="搜索当前聊天记录" placeholder="搜索当前聊天记录…" value={query} onChange={e=>setQuery(e.target.value)}/></label><p className="hint">仅搜索当前会话的有效消息和当前选中版本。</p>{error&&<p role="alert">{error}</p>}{query.trim()&&!rows.length&&!error&&<p className="empty">没有匹配的消息</p>}{rows.slice(0,limit).map(row=><button className="chat-search-result" key={row.id} onClick={()=>onLocate(row.id)}><small>{row.role==='user'?'你':'角色'} · {new Date(row.createdAt).toLocaleString()}</small>{row.before&&<span className="hint">上文：{row.before}</span>}<span>{row.snippet}</span>{row.after&&<span className="hint">下文：{row.after}</span>}</button>)}{rows.length>limit&&<button onClick={()=>setLimit(n=>n+50)}>显示更多结果</button>}</>;
}
export function ConversationBackground({conversation,onSave}:{conversation:Conversation;onSave:(patch:ChatSettingsPatch)=>Promise<void>}) {
  const [working,setWorking]=useState(false),[error,setError]=useState("");
  const input=useRef<HTMLInputElement>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function save(patch:ChatSettingsPatch){setWorking(true);setError("");try{await onSave(patch);}catch{if(alive.current)setError("背景保存失败，请检查图片格式和浏览器存储空间。");}finally{if(alive.current)setWorking(false);}}
  return <><p className="hint">仅作用于当前角色的当前会话，不改变桌面或其他聊天。图片会压缩保存到本机。</p><button className="message-action" disabled={working} onClick={()=>void save({background:null})}>恢复默认背景</button><div className="chat-background-colors">{chatColors.map(color=><button key={color} aria-label={`背景颜色 ${color}`} aria-pressed={conversation.chatSettings?.background?.kind==='color'&&conversation.chatSettings.background.color===color} style={{background:color}} disabled={working} onClick={()=>void save({background:{kind:'color',color}})}/>)}</div><input ref={input} type="file" accept="image/*" hidden aria-label="上传聊天背景图片" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setWorking(true);setError('');try{const id=await upload(file,'wallpaper');if(alive.current)await onSave({background:{kind:'image',assetId:id}});}catch(e){if(alive.current)setError(e instanceof Error?e.message:'图片上传失败。');}finally{if(alive.current)setWorking(false);}}}/><button className="message-action" disabled={working} onClick={()=>input.current?.click()}>{working?'正在保存…':'上传本地图片'}</button>{error&&<p role="alert">{error}</p>}<p role="status">当前：{conversation.chatSettings?.background?.kind==='image'?'图片背景':conversation.chatSettings?.background?.kind==='color'?'纯色背景':'默认背景'}</p></>;
}
