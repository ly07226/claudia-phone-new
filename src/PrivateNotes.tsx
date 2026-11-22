import React,{useEffect,useState} from 'react';
import {ArrowLeft,BookOpen,CloudMoon,ImagePlus,Menu,MessageCircle,Moon,NotebookPen,Send,SlidersHorizontal,Sparkles} from 'lucide-react';
import './PrivateNotes.css';

type Kind='日记'|'备忘'|'梦境';
type Note={id:string;kind:Kind;createdAt:number;title:string;body:string;comments:string[]};
type Appearance={theme:number;opacity:number;background:string};
const palettes=[
 ['经典白','#f4f3f0','#8995a3','#344152'],
 ['午夜黑','#252629','#b4b5ba','#f2f2f2'],
 ['鼠尾草绿','#e5ebe3','#91a995','#405648'],
 ['樱花粉','#f8edf1','#d9a3b8','#684c5a'],
 ['雾霾蓝','#e6edf4','#92acc7','#34465a'],
 ['奶油紫','#f8f5f0','#b6a0c9','#5e536c'],
 ['焦糖棕','#f4e9db','#b78e69','#654b39']
] as const;
const key='claudia-private-notes-v1';
const appearanceKey='claudia-private-notes-appearance-v1';
function read<T>(k:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(k)||'null')??fallback}catch{return fallback}}
function relativeDate(ts:number){const today=new Date(),date=new Date(ts);const day=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();const delta=Math.round((day(today)-day(date))/86400000);return delta===0?'今天':delta===1?'昨天':(date.getMonth()+1)+'月'+date.getDate()+'日'}
export function PrivateNotes(){
 const [notes,setNotes]=useState<Note[]>(()=>read(key,[]));
 const [appearance,setAppearance]=useState<Appearance>(()=>read(appearanceKey,{theme:4,opacity:36,background:''}));
 const [page,setPage]=useState<'home'|'settings'>('home');
 const [tab,setTab]=useState<'总览'|Kind>('总览');
 const [open,setOpen]=useState<string|null>(null);
 const [draft,setDraft]=useState<Record<string,string>>({});
 const [status,setStatus]=useState('');
 const [busy,setBusy]=useState(false);
 useEffect(()=>{localStorage.setItem(key,JSON.stringify(notes))},[notes]);
 useEffect(()=>{try{localStorage.setItem(appearanceKey,JSON.stringify(appearance))}catch{setStatus('背景图片太大，无法保存。请换一张较小的图片。')}},[appearance]);
 const colors=palettes[appearance.theme]||palettes[4];
 const update=(patch:Partial<Appearance>)=>setAppearance(old=>({...old,...patch}));
 const visible=notes.filter(n=>tab==='总览'||tab===n.kind).sort((a,b)=>b.createdAt-a.createdAt);
 const addComment=(id:string)=>{const value=(draft[id]||'').trim();if(!value)return;setNotes(old=>old.map(n=>n.id===id?{...n,comments:[...n.comments,value]}:n));setDraft(old=>({...old,[id]:''}))};
 const onImage=(file?:File)=>{if(!file)return;if(!file.type.startsWith('image/')){setStatus('请选择图片文件');return}if(file.size>3*1024*1024){setStatus('当前版本请使用小于 3MB 的图片');return}const reader=new FileReader();reader.onload=()=>{update({background:String(reader.result)});setStatus('背景已更换')};reader.onerror=()=>setStatus('图片读取失败');reader.readAsDataURL(file)};
 const generate=()=>{setBusy(true);setStatus('尚未接入全局 API：不会伪造角色日记，也不会产生扣费。');setBusy(false)};
 return <div className="private-notes" style={{'--pn-bg':colors[1],'--pn-accent':colors[2],'--pn-ink':colors[3],'--pn-alpha':appearance.opacity/100,backgroundImage:appearance.background||'none'} as React.CSSProperties}>
  <div className="pn-shade"/>
  {page==='home'?<main className="pn-content">
   <header className="pn-header"><div><h2>私人记录</h2><small>Private Notes</small></div><button aria-label="外观设置" onClick={()=>setPage('settings')}><Menu size={21}/></button></header>
   <nav className="pn-tabs">{(['总览','日记','备忘','梦境'] as const).map((name,i)=>{const Icon=[BookOpen,NotebookPen,NotebookPen,Moon][i];return <button key={name} className={tab===name?'active':''} onClick={()=>setTab(name)}><Icon size={20}/><span>{name}</span></button>})}</nav>
   {visible.length===0?<div className="pn-empty">还没有角色写下的{tab==='总览'?'私人记录':tab}。<br/>开启自动生成后，记录会出现在这里。</div>:visible.map(n=><article className="pn-card" key={n.id}>
    <button className="pn-note-top" onClick={()=>setOpen(open===n.id?null:n.id)}><span className="pn-note-icon">{n.kind==='梦境'?<CloudMoon/>:n.kind==='日记'?<BookOpen/>:<NotebookPen/>}</span><span><strong>{n.kind}</strong><small>{relativeDate(n.createdAt)} · {new Date(n.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</small></span><span className="pn-expand">{open===n.id?'⌃':'⌄'}</span></button>
    <h3>{n.title}</h3><p className={open===n.id?'pn-full':'pn-preview'}>{n.body}</p>
    <button className="pn-comment-toggle" onClick={()=>setOpen(open===n.id?null:n.id)}><MessageCircle size={16}/> {n.comments.length} 条评论</button>
    {open===n.id&&<div className="pn-comments">{n.comments.map((c,i)=><p key={i}>你：{c}</p>)}<div className="pn-comment-entry"><input value={draft[n.id]||''} onChange={e=>setDraft(old=>({...old,[n.id]:e.target.value}))} placeholder="评论他的记录…"/><button aria-label="发送评论" onClick={()=>addComment(n.id)}><Send size={17}/></button></div></div>}
   </article>)}
   <div className="pn-bottom">全部记录</div>
  </main>:<main className="pn-content">
   <header className="pn-header"><button aria-label="返回" onClick={()=>setPage('home')}><ArrowLeft/></button><h2>外观设置</h2><span/></header>
   <section className="pn-card"><h3>让他写点什么</h3><p>默认自动写。这里可手动触发一次生成。</p><button className="pn-action" disabled={busy} onClick={generate}><Sparkles size={16}/> {busy?'正在书写…':'立即生成'}</button></section>
   <h3 className="pn-section">七种主题</h3><div className="pn-palette">{palettes.map((p,i)=><button key={p[0]} onClick={()=>update({theme:i})} className={appearance.theme===i?'chosen':''}><span style={{background:p[1],boxShadow:'inset 0 -16px '+p[2]}}/>{p[0]}</button>)}</div>
   <h3 className="pn-section">页面背景</h3><label className="pn-upload"><ImagePlus size={26}/><strong>从相册选择背景图片</strong><small>整页铺满 · 不是顶部照片</small><input type="file" accept="image/*" onChange={e=>onImage(e.target.files?.[0])}/></label>
   <div className="pn-presets">{[['主题纯色',''],['晨雾','linear-gradient(135deg,#8496a9,#c5d1d6,#eef0f1)'],['深夜','radial-gradient(circle at 70% 20%,#61799d,#293a55 65%,#121b2d)']].map(([label,value])=><button key={label} style={{background:value||colors[1]}} onClick={()=>update({background:value})}>{label}</button>)}</div>
   <h3 className="pn-section">玻璃透明度 · {appearance.opacity}%</h3><input className="pn-range" type="range" min="8" max="85" value={appearance.opacity} onChange={e=>update({opacity:Number(e.target.value)})}/>
   <button className="pn-action" onClick={()=>setPage('home')}>完成，返回日记</button>
  </main>}
  {status&&<div role="status" className="pn-status"><span>{status}</span><button onClick={()=>setStatus('')}>×</button></div>}
 </div>
}
