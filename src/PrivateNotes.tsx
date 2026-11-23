import {CharacterLifePanel} from './CharacterLifePanel';
import {liveQuery} from 'dexie';
import {readCharacterNotes,privateNotesMetadata,privateNotesTaskStatus,archiveAppearance,appendPrivateNoteComment,saveNoteSchedule,type NoteSchedule} from './privateNotesArchive';
import {generatePrivateNote,replyToPrivateNoteComment,loadNotes,type GeneratedNote} from './privateNotesGeneration';
import {usePhone} from './store';
import React,{useEffect,useState} from 'react';
import {ArrowLeft,BookOpen,CloudMoon,ImagePlus,Menu,MessageCircle,Moon,NotebookPen,Send,Sparkles} from 'lucide-react';
import './PrivateNotes.css';

type Kind='日记'|'备忘'|'梦境';

type Appearance={theme:number;opacity:number;background:string};
const commentKey=(owner:string,id:string)=>JSON.stringify([owner,id]);
const palettes=[
 ['经典白','#f4f3f0','#8995a3','#344152'],
 ['午夜黑','#252629','#b4b5ba','#f2f2f2'],
 ['鼠尾草绿','#e5ebe3','#91a995','#405648'],
 ['樱花粉','#f8edf1','#d9a3b8','#684c5a'],
 ['雾霾蓝','#e6edf4','#92acc7','#34465a'],
 ['奶油紫','#f8f5f0','#b6a0c9','#5e536c'],
 ['焦糖棕','#f4e9db','#b78e69','#654b39']
] as const;

const appearanceKey='claudia-private-notes-appearance-v1';
function read<T>(k:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(k)||'null')??fallback}catch{return fallback}}
function relativeDate(ts:number){const today=new Date(),date=new Date(ts);const day=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();const delta=Math.round((day(today)-day(date))/86400000);return delta===0?'今天':delta===1?'昨天':(date.getMonth()+1)+'月'+date.getDate()+'日'}
export function PrivateNotes(){
 const characters=usePhone(state=>state.characters);
 const [characterId,setCharacterId]=useState('');
 const selectedCharacterRef=React.useRef('');
 selectedCharacterRef.current=characterId;
 const [notes,setNotes]=useState<GeneratedNote[]>([]);
 const [loadedOwner,setLoadedOwner]=useState('');
 const [loadError,setLoadError]=useState('');
 const [automaticFailed,setAutomaticFailed]=useState(false);
 useEffect(()=>{setAutomaticFailed(false);if(!characterId)return;const sub=liveQuery(()=>privateNotesTaskStatus(characterId)).subscribe({next:s=>setAutomaticFailed(!!s?.failed||!!s?.until&&s.until<=Date.now()),error:()=>setAutomaticFailed(true)});return()=>sub.unsubscribe()},[characterId]);
 useEffect(()=>{if(!characterId&&characters.length)setCharacterId(characters[0].id)},[characters,characterId]);
 useEffect(()=>{
  let active=true,subscription:{unsubscribe:()=>void}|undefined;setLoadError('');
  if(characterId)void loadNotes(characterId).then(()=>{
   if(!active)return;
   subscription=liveQuery(()=>readCharacterNotes(characterId)).subscribe({
    next:rows=>{if(active){setNotes(rows);setLoadedOwner(characterId);setLoadError('')}},
    error:()=>{if(active)setLoadError('记录读取失败，请返回后重试')}
   });
  }).catch(()=>{if(active)setLoadError('记录读取失败，请返回后重试')});
  else setNotes([]);
  return()=>{active=false;subscription?.unsubscribe()};
 },[characterId]);
 useEffect(()=>{if(!characterId)return;let cancelled=false;const check=()=>{if(document.visibilityState==='hidden')return;void generatePrivateNote(characterId).then(async n=>{if(!n||cancelled)return;const rows=await loadNotes(characterId);if(!cancelled){setNotes(rows);setLoadedOwner(characterId)}}).catch(()=>{if(!cancelled)setStatus('自动书写未完成；可在设置中手动重试，不会自动重复请求')})};check();const timer=setInterval(check,60000);return()=>{cancelled=true;clearInterval(timer)}},[characterId]);
 const [appearance,setAppearance]=useState<Appearance>(()=>read(appearanceKey,{theme:4,opacity:36,background:''}));
 const [page,setPage]=useState<'home'|'settings'>('home');
 const [tab,setTab]=useState<'总览'|'生活'|Kind>('总览');
 const [open,setOpen]=useState<string|null>(null);
 const [draft,setDraft]=useState<Record<string,string>>({});
 const [status,setStatus]=useState('');
 const [busy,setBusy]=useState(false);
 const [replyBusy,setReplyBusy]=useState<string|null>(null);
 const [schedule,setSchedule]=useState<NoteSchedule>({mode:'both',intervalMinutes:60});
 const [custom,setCustom]=useState('');
 const changeSchedule=(next:NoteSchedule)=>{setSchedule(next);void saveNoteSchedule(next).catch(()=>setStatus('书写设置保存失败，请重试'))};
 
 useEffect(()=>{let active=true;void privateNotesMetadata().then(a=>{if(active){if(a.appearance)setAppearance(a.appearance);if(a.schedule)setSchedule(a.schedule)}}).catch(()=>{});return()=>{active=false}},[]);
 useEffect(()=>{try{localStorage.setItem(appearanceKey,JSON.stringify(appearance))}catch{}},[appearance]);
 const colors=palettes[appearance.theme]||palettes[4];
 const update=(patch:Partial<Appearance>)=>setAppearance(old=>{const next={...old,...patch};void archiveAppearance(next).catch(()=>setStatus('外观保存失败，请重试'));return next});
 const visible=(loadedOwner===characterId?notes:[]).filter(n=>n.characterId===characterId).filter(n=>tab==='总览'||tab===n.kind).sort((a,b)=>b.createdAt-a.createdAt);
 const addComment=(id:string)=>{const owner=characterId,key=commentKey(owner,id),value=(draft[key]||'').trim();if(!value||!owner||replyBusy===key)return;setReplyBusy(key);setStatus('');setDraft(old=>({...old,[key]:''}));void appendPrivateNoteComment(owner,id,value).then(async()=>{if(selectedCharacterRef.current===owner){const rows=await loadNotes(owner);if(selectedCharacterRef.current===owner)setNotes(rows)};try{await replyToPrivateNoteComment(owner,id,value)}catch{if(selectedCharacterRef.current===owner)setStatus('评论已保存，角色回复失败；不会自动重复扣费')}if(selectedCharacterRef.current===owner){const rows=await loadNotes(owner);if(selectedCharacterRef.current===owner)setNotes(rows)}}).catch(()=>{if(selectedCharacterRef.current===owner)setStatus('评论保存失败，请重试');setDraft(old=>({...old,[key]:value}))}).finally(()=>setReplyBusy(current=>current===key?null:current))};
 const retryReply=(id:string)=>{
  const owner=characterId,key=commentKey(owner,id),note=notes.find(n=>n.id===id);
  if(!owner||!note||replyBusy===key)return;
  const last=note.comments.at(-1);
  if(typeof last!=='string')return;
  setReplyBusy(key);setStatus('');
  void replyToPrivateNoteComment(owner,id,last).then(()=>loadNotes(owner)).then(rows=>{if(selectedCharacterRef.current===owner)setNotes(rows)}).catch(()=>{if(selectedCharacterRef.current===owner)setStatus('角色回复失败，请稍后手动重试')}).finally(()=>setReplyBusy(current=>current===key?null:current));
 };
 const onImage=(file?:File)=>{if(!file)return;if(!file.type.startsWith('image/')){setStatus('请选择图片文件');return}if(file.size>3*1024*1024){setStatus('当前版本请使用小于 3MB 的图片');return}const reader=new FileReader();reader.onload=()=>{update({background:String(reader.result)});setStatus('背景已更换')};reader.onerror=()=>setStatus('图片读取失败');reader.readAsDataURL(file)};
 const generate=async(kind?:Kind)=>{const owner=characterId;if(!characterId){setStatus('请先创建角色');return}setBusy(true);setStatus('正在书写…');try{const note=await generatePrivateNote(owner,true,kind);if(!note&&selectedCharacterRef.current===owner)setStatus('该角色正在书写，请稍候');if(note){const rows=await loadNotes(owner);if(selectedCharacterRef.current!==owner)return;setNotes(rows);setStatus('已写入一篇'+note.kind);setPage('home');setTab('总览');setOpen(note.id)}}catch(error){if(selectedCharacterRef.current===owner)setStatus(error instanceof Error?error.message:'生成失败，请重试')}finally{setBusy(false)}};
 return <div className="private-notes" style={{'--pn-bg':colors[1],'--pn-accent':colors[2],'--pn-ink':colors[3],'--pn-alpha':appearance.opacity/100,backgroundImage:appearance.background.startsWith('data:image/')?`url("${appearance.background}")`:appearance.background||'none'} as React.CSSProperties}>
  <div className="pn-shade"/>
  {page==='home'?<main className="pn-content">
   <header className="pn-header"><div><h2>私人记录</h2><small>Private Notes</small></div><button aria-label="私人记录设置" onClick={()=>setPage('settings')}><Menu size={21}/></button></header>
   <div className="pn-character"><label htmlFor="pn-character">当前角色</label><select id="pn-character" value={characterId} onChange={e=>{setCharacterId(e.target.value);setStatus('');setOpen(null)}}>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
   <nav className="pn-tabs">{(['总览','日记','备忘','梦境','生活'] as const).map((name,i)=>{const Icon=[BookOpen,NotebookPen,NotebookPen,Moon,Sparkles][i];return <button key={name} className={tab===name?'active':''} onClick={()=>setTab(name)}><Icon size={20}/><span>{name}</span></button>})}</nav>
   {tab==='生活'?<CharacterLifePanel key={characterId} owner={characterId}/>:loadError?<div role="alert" className="pn-empty">{loadError}</div>:loadedOwner!==characterId&&characterId?<div className="pn-empty">正在读取记录…</div>:visible.length===0?<div className="pn-empty">还没有角色写下的{tab==='总览'?'私人记录':tab}。<br/>开启自动生成后，记录会出现在这里。</div>:visible.map(n=><article className="pn-card" key={n.id}>
    <button className="pn-note-top" onClick={()=>setOpen(open===n.id?null:n.id)}><span className="pn-note-icon">{n.kind==='梦境'?<CloudMoon/>:n.kind==='日记'?<BookOpen/>:<NotebookPen/>}</span><span><strong>{n.kind}</strong><small>{relativeDate(n.createdAt)} · {new Date(n.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</small></span><span className="pn-expand">{open===n.id?'⌃':'⌄'}</span></button>
    <h3>{n.title}</h3><p className={open===n.id?'pn-full':'pn-preview'}>{n.body}</p>
    <button className="pn-comment-toggle" onClick={()=>setOpen(open===n.id?null:n.id)}><MessageCircle size={16}/> {n.comments.length} 条评论</button>
    {open===n.id&&<div className="pn-comments">{n.comments.map((c,i)=><p key={i}>{typeof c==='string'?'你：'+c:(c.author==='character'?'角色：':'你：')+c.text}</p>)}{replyBusy===commentKey(characterId,n.id)?<p>角色正在回复…</p>:typeof n.comments.at(-1)==='string'&&<button className="pn-comment-toggle" onClick={()=>retryReply(n.id)}>重新请求角色回复</button>}<div className="pn-comment-entry"><input value={draft[commentKey(characterId,n.id)]||''} onChange={e=>setDraft(old=>({...old,[commentKey(characterId,n.id)]:e.target.value}))} placeholder="评论他的记录…"/><button aria-label="发送评论" disabled={replyBusy===commentKey(characterId,n.id)} onClick={()=>addComment(n.id)}><Send size={17}/></button></div></div>}
   </article>)}
   <div className="pn-bottom">全部记录</div>
  </main>:<main className="pn-content">
   <header className="pn-header"><button aria-label="返回" onClick={()=>setPage('home')}><ArrowLeft/></button><h2>私人记录设置</h2><span/></header>
   {automaticFailed&&<p role="alert">自动书写曾失败，已停止自动请求；原记录保留。可点击立即生成手动恢复。</p>}
   <section className="pn-card"><h3>让他写点什么</h3><p>自动书写及角色回复会使用当前 API 额度，仅在应用可执行时检查，不补发离线记录。失败可手动重试。</p><button className="pn-action" disabled={busy} onClick={()=>generate()}><Sparkles size={16}/> {busy?'正在书写…':'立即生成日记或备忘录'}</button><button className="pn-action" disabled={busy} onClick={()=>generate('梦境')}><CloudMoon size={16}/> 单独生成梦境</button></section>
   <section className="pn-card"><h3>自动书写方式</h3><p>角色可按时间书写，也可在重要事件发生后主动记录。</p><div className="pn-character"><select aria-label="自动书写方式" value={schedule.mode} onChange={e=>changeSchedule({...schedule,mode:e.target.value as NoteSchedule['mode']})}><option value="both">定时与重要事件同时开启</option><option value="interval">仅按时间间隔</option><option value="important">仅重要事件</option></select></div>{schedule.mode!=='important'&&<><h3>书写时间间隔</h3><div className="pn-character"><select aria-label="书写时间间隔" value={[60,180].includes(schedule.intervalMinutes)?String(schedule.intervalMinutes):'custom'} onChange={e=>{if(e.target.value!=='custom')changeSchedule({...schedule,intervalMinutes:Number(e.target.value)});else changeSchedule({...schedule,intervalMinutes:240})}}><option value="60">每 1 小时</option><option value="180">每 3 小时</option><option value="custom">自定义</option></select></div>{![60,180].includes(schedule.intervalMinutes)&&<div className="pn-character"><label>自定义分钟数（至少 60 分钟）</label><input type="number" min="60" step="1" value={custom||String(schedule.intervalMinutes)} onChange={e=>setCustom(e.target.value)} onBlur={()=>{const n=Number(custom);if(Number.isFinite(n)&&n>=60)changeSchedule({...schedule,intervalMinutes:Math.floor(n)});else setStatus('请输入至少 60 分钟的间隔');setCustom('')}}/></div>}</>}</section>
   <h3 className="pn-section">七种主题</h3><div className="pn-palette">{palettes.map((p,i)=><button key={p[0]} onClick={()=>update({theme:i})} className={appearance.theme===i?'chosen':''}><span style={{background:p[1],boxShadow:'inset 0 -16px '+p[2]}}/>{p[0]}</button>)}</div>
   <h3 className="pn-section">页面背景</h3><label className="pn-upload"><ImagePlus size={26}/><strong>从相册选择背景图片</strong><small>整页铺满 · 不是顶部照片</small><input type="file" accept="image/*" onChange={e=>onImage(e.target.files?.[0])}/></label>
   <div className="pn-presets">{[['主题纯色',''],['晨雾','linear-gradient(135deg,#8496a9,#c5d1d6,#eef0f1)'],['深夜','radial-gradient(circle at 70% 20%,#61799d,#293a55 65%,#121b2d)']].map(([label,value])=><button key={label} style={{background:value||colors[1]}} onClick={()=>update({background:value})}>{label}</button>)}</div>
   <h3 className="pn-section">玻璃透明度 · {appearance.opacity}%</h3><input className="pn-range" type="range" min="8" max="85" value={appearance.opacity} onChange={e=>update({opacity:Number(e.target.value)})}/>
   <button className="pn-action" onClick={()=>setPage('home')}>完成，返回日记</button>
  </main>}
  {status&&<div role="status" className="pn-status"><span>{status}</span><button onClick={()=>setStatus('')}>×</button></div>}
 </div>
}
