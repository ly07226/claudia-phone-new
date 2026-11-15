import {MemoryDeleteDialog} from './MemoryDeleteDialog';
import {MemorySummarySettings} from './MemorySummarySettings';
import {SmartTimeMemoryPanel} from './SmartTimeMemoryPanel';
import {runDailyDigest} from './dailyDigest';
import {useEffect,useRef,useState} from 'react';
import {liveQuery} from 'dexie';
import {Brain,Plus,ShieldCheck,ChevronLeft,ChevronRight,Heart,BookOpen,Sparkles} from 'lucide-react';
import {db,usePhone} from './store';
import {getConversation} from './chatService';
import {getMemoryScope,listMemories,readShortMemory,createMemory,updateMemory,deleteMemory,getMemoryHistory} from './memoryStore';
import {memoryLimits,type MemoryScope,type EffectiveMemory,type MemoryEntry,type StoredMemoryKind,type ShortMemory} from './memoryTypes';
import './memoryApp.css';
const errorText=(e:unknown)=>e instanceof Error?e.message:'记忆读取失败，请重试。';
export function MemoryApp(){
 const s=usePhone();const [world,setWorld]=useState(''),[character,setCharacter]=useState(''),[scope,setScope]=useState<MemoryScope>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
 const characters=s.characters.filter(c=>!world||s.worldProfiles.some(p=>p.worldId===world&&p.characterId===c.id));
 useEffect(()=>{let alive=true;setScope(undefined);setError('');if(!character){setLoading(false);return;}setLoading(true);let subscription:ReturnType<ReturnType<typeof liveQuery>['subscribe']>|undefined;
  void getConversation(character,world||undefined).then(c=>{if(!alive)return;subscription=liveQuery(()=>db.conversations.get(c.id)).subscribe({next:()=>{void getMemoryScope(c.id).then(next=>{if(alive){setScope(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);setLoading(false);}}).catch(e=>{if(alive){setScope(undefined);setError(errorText(e));setLoading(false);}});},error:e=>{if(alive){setScope(undefined);setError(errorText(e));setLoading(false);}}});}).catch(e=>{if(alive){setScope(undefined);setError(errorText(e));setLoading(false);}});
  return()=>{alive=false;subscription?.unsubscribe();};
 },[world,character,retry]);
 return <div className="memory-app"><div className="memory-heading"><Brain aria-hidden="true"/><h2>记忆</h2><p>留住重要的事，也尊重每段故事的边界。</p></div>
 <div className="memory-selectors"><label>记忆空间<select aria-label="记忆空间" value={world} onChange={e=>{setWorld(e.target.value);setCharacter('');}}><option value="">日常聊天</option>{s.worlds.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>角色<select aria-label="角色" value={character} onChange={e=>setCharacter(e.target.value)}><option value="">选择角色</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
 {!characters.length&&<p className="memory-empty">{world?'此世界尚未关联角色。':'尚无角色，请先在角色管理中创建。'}</p>}
 {!character&&characters.length>0&&<p className="memory-empty">选择角色，查看属于你们的记忆。</p>}
 {loading&&<p role="status">正在读取记忆…</p>}{error&&<div role="alert">{error}<button onClick={()=>setRetry(n=>n+1)}>重试</button></div>}
 {scope&&<MemoryPanel key={JSON.stringify(scope)} scope={scope}/>}
 </div>;
}
function MemoryPanel({scope}:{scope:MemoryScope}){
 useEffect(()=>{void runDailyDigest(scope).catch(()=>{});},[scope]);
 const [addChoice,setAddChoice]=useState(false);const [view,setView]=useState<'home'|'core'|'long'|'summary'|'detail'|'short'|'time'>('home'),[selectedId,setSelectedId]=useState<string>(),[kind,setKind]=useState<StoredMemoryKind|'short'>('core'),[entries,setEntries]=useState<EffectiveMemory[]>([]),[short,setShort]=useState<ShortMemory>(),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [editor,setEditor]=useState<{entry?:EffectiveMemory;kind:StoredMemoryKind;text:string;revision:number}>(),[history,setHistory]=useState<MemoryEntry[]>(),[remove,setRemove]=useState<EffectiveMemory>(),[deleteError,setDeleteError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);const lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;const subscription=liveQuery(async()=>({stored:await listMemories(scope),short:await readShortMemory(scope)})).subscribe({next:r=>{setEntries(r.stored.entries);setRevision(r.stored.revision);setShort(r.short);setLoading(false);setError('');},error:e=>{setError(errorText(e));setLoading(false);}});return()=>{mounted.current=false;subscription.unsubscribe();};},[scope,reload]);
 async function act(fn:()=>Promise<unknown>,deleting=false){if(lock.current)return;lock.current=true;setBusy(true);setError('');if(deleting)setDeleteError('');try{await fn();if(mounted.current){setEditor(undefined);setRemove(undefined);setHistory(undefined);}}catch(e){if(mounted.current){if(deleting)setDeleteError(errorText(e));else setError(errorText(e));}}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 const selected=entries.find(e=>e.id===selectedId);
 const openList=(next:'core'|'long')=>{setKind(next);setView(next);setSelectedId(undefined);setEditor(undefined);setHistory(undefined);setRemove(undefined);};
 const goBack=()=>{setEditor(undefined);setHistory(undefined);setRemove(undefined);if(view==='detail')setView(selected?.kind==='long'?'long':'core');else setView('home');};
 return <section aria-label="角色记忆" className="memory-panel">
 <p className="memory-scope">{scope.mode==='daily'?'日常记忆 · 持续积累，不按剧情分支拆分':'剧情记忆 · 当前有效时间线（继承共同过去，独立积累未来）'}</p>
 <div className="memory-nav-head">{view!=='home'&&<button type="button" aria-label="返回记忆首页" onClick={goBack}><ChevronLeft size={20}/></button>}<h3>{view==='home'?'记忆卡片':view==='core'?'核心记忆':view==='long'?'长期记忆':view==='summary'?'自动记忆总结':view==='short'?'短期记忆':view==='time'?'智能时间记忆':'记忆详情'}</h3>{(view==='core'||view==='long')&&<button type="button" aria-label="添加记忆" title="添加记忆" onClick={()=>{if(view==='core'){setAddChoice(v=>!v);return;}setEditor({kind:view,text:'',revision});setSelectedId(undefined);setHistory(undefined);setRemove(undefined);}}><Plus size={20}/></button>}</div>
 {loading&&<p role="status">正在读取…</p>}{error&&<p role="alert">{error}<button disabled={busy} onClick={()=>{setLoading(true);setReload(n=>n+1);}}>重新读取</button></p>}
 {view==='home'&&<div className="memory-home-links">
 <button onClick={()=>openList('core')}><Heart size={22}/><span><strong>核心记忆</strong><small>重要事件、深度交流与智能时间记忆 · {entries.filter(e=>e.kind==='core').length}条</small></span><ChevronRight size={18}/></button>
 <button onClick={()=>openList('long')}><BookOpen size={22}/><span><strong>长期记忆</strong><small>人物背景、经历与持续性信息 · {entries.filter(e=>e.kind==='long').length}条</small></span><ChevronRight size={18}/></button>
 <button onClick={()=>setView('summary')}><Sparkles size={22}/><span><strong>自动记忆总结</strong><small>一级总结、二级总结、专用 API</small></span><ChevronRight size={18}/></button>

 </div>}
 {view==='summary'&&<><MemorySummarySettings scope={scope}/><button type="button" className="memory-list-entry" onClick={()=>setView('short')}>查看短期记忆与近期事件摘要 <ChevronRight size={18}/></button></>}
 {view==='time'&&<SmartTimeMemoryPanel scope={scope}/>}
 {(view==='core'||view==='long')&&<>{view==='core'&&addChoice&&<div className="memory-actions"><button type="button" onClick={()=>{setEditor({kind:'core',text:'',revision});setAddChoice(false);}}>普通核心记忆</button><button type="button" onClick={()=>{setView('time');setAddChoice(false);}}>智能时间记忆</button></div>}<div className="memory-list-caption"><small>点击一条记忆查看完整内容</small><span>{entries.filter(e=>e.kind===view).length}条</span></div>
 {editor&&!editor.entry&&<form className="memory-editor" onSubmit={e=>{e.preventDefault();void act(()=>createMemory(scope,{kind:editor.kind,content:editor.text,source:'manual'},editor.revision));}}><h3>新增{view==='core'?'核心':'长期'}记忆</h3><label>记忆内容<textarea autoComplete="off" value={editor.text} maxLength={memoryLimits.entryChars} required onChange={e=>setEditor({...editor,text:e.target.value})}/></label><div className="memory-actions"><button type="submit" disabled={busy||!editor.text.trim()}>保存记忆</button><button type="button" disabled={busy} onClick={()=>setEditor(undefined)}>取消</button></div></form>}
 {!loading&&entries.filter(e=>e.kind===view).length===0&&<p className="memory-empty">暂无{view==='core'?'核心':'长期'}记忆。</p>}
 {entries.filter(e=>e.kind===view).map(e=><button type="button" className="memory-list-entry" key={e.id} onClick={()=>{setSelectedId(e.id);setView('detail');setEditor(undefined);setHistory(undefined);setRemove(undefined);}}><span><strong>{e.content.slice(0,36)}{e.content.length>36?'…':''}</strong><small>{e.source==='manual'?'手动 · 已保护':'自动总结'} · {new Date(e.updatedAt).toLocaleDateString()}</small></span><ChevronRight size={18}/></button>)}
 </>}
 {view==='detail'&&selected&&<article className="memory-card"><div className="memory-meta"><span>{selected.source==='manual'?'手动 · 已保护':'自动总结'}</span>{selected.source==='manual'&&<ShieldCheck size={15} aria-label="手动保护"/>}{scope.mode==='world'&&<span>{selected.inherited?'继承记忆':'当前分支独有'}</span>}</div><p>{selected.content}</p><div className="memory-actions"><button disabled={busy} onClick={()=>{setEditor({entry:selected,kind:selected.kind,text:selected.content,revision});setHistory(undefined);}}>编辑</button><button disabled={busy} onClick={()=>{void getMemoryHistory(scope,selected.id).then(rows=>{if(mounted.current){setHistory(rows);setEditor(undefined);}}).catch(err=>{if(mounted.current)setError(errorText(err));});}}>历史版本</button><button disabled={busy} onClick={()=>{setDeleteError('');setRemove(selected);setEditor(undefined);setHistory(undefined);}}>删除</button></div>
 {editor?.entry&&<form className="memory-editor" onSubmit={e=>{e.preventDefault();void act(()=>updateMemory(scope,editor.entry!.id,{kind:editor.kind,content:editor.text,source:'manual'},editor.entry!.revision));}}><label>编辑记忆<textarea value={editor.text} maxLength={memoryLimits.entryChars} onChange={e=>setEditor({...editor,text:e.target.value})}/></label><div className="memory-actions"><button disabled={busy||!editor.text.trim()}>保存</button><button type="button" onClick={()=>setEditor(undefined)}>取消</button></div></form>}
 </article>}
 {remove&&<MemoryDeleteDialog busy={busy} error={deleteError} onCancel={()=>setRemove(undefined)} onConfirm={()=>void act(()=>deleteMemory(scope,remove.id,remove.revision),true)}/>}
 {history&&<section className="memory-history" aria-label="记忆历史版本"><h3>历史版本</h3><button onClick={()=>setHistory(undefined)}>关闭历史</button>{history.map(e=><article key={e.revision}><small>修订 {e.revision} · {e.source==='manual'?'手动 · 已保护':'自动总结'} · {new Date(e.updatedAt).toLocaleString()}</small><p>{e.deleted?'已删除（局部删除标记）':e.content}</p></article>)}</section>}
 {view==='short'&&<>
 <p className="memory-scope">已完成的剧情事件摘要按时间展示；最近30条原始消息仍可查看。摘要只读，遵循当前世界与剧情分支。</p>
 <h3>事件摘要</h3>
 {!loading&&!short?.summaries?.length&&<p className="memory-empty">暂无已完成的事件摘要。</p>}
 {short?.summaries?.map((item,index)=><article className="memory-card" key={item.throughNodeId+':'+index}>
  <div className="memory-meta"><span>第 {index+1} 组 · {new Date(item.createdAt).toLocaleString()}</span></div>
  <p>{item.text}</p>
 </article>)}
 <details><summary>查看最近30条原始消息</summary>
 {short?.messages.map(m=><article className="memory-card" key={m.nodeId??m.messageId}><small>{m.role==='user'?'用户':'角色'}</small><p>{m.content||'图片消息'}{m.assetIds.length>0&&`［${m.assetIds.length} 张图片］`}</p></article>)}
 </details>
 </>}
 </section>;
}
