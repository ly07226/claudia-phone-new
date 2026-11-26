import {MemoryDeleteDialog} from './MemoryDeleteDialog';
import {MemorySummarySettings} from './MemorySummarySettings';
import {SmartTimeMemoryPanel} from './SmartTimeMemoryPanel';
import {useEffect,useRef,useState,useMemo} from 'react';
import {liveQuery} from 'dexie';
import {Brain,Plus,ShieldCheck,ChevronLeft,ChevronRight,Heart,BookOpen,Sparkles} from 'lucide-react';
import {db,usePhone} from './store';
import {getConversation} from './chatService';
import {getMemoryScope,listMemories,readShortMemory,createMemory,updateMemory,deleteMemory,getMemoryHistory,clearMemoryCategory} from './memoryStore';
import {memoryLimits,type MemoryScope,type EffectiveMemory,type MemoryEntry,type StoredMemoryKind,type ShortMemory} from './memoryTypes';
import './memoryApp.css';
const errorText=(e:unknown)=>e instanceof Error?e.message:'记忆读取失败，请重试。';
/** Preview only: the complete interval digest stays in IndexedDB and backup. */
function IntervalSummaryText({text}:{text:string}){
 const [expanded,setExpanded]=useState(false);const large=text.length>4000;
 return <><p>{large&&!expanded?text.slice(0,4000):text}</p>{large&&<button type="button" onClick={()=>setExpanded(v=>!v)}>{expanded?'收起完整摘要':`展开完整区间摘要（${text.length}字，当前仅预览）`}</button>}</>;
}
export function MemoryApp(){
 const s=usePhone();const [world,setWorld]=useState(''),[character,setCharacter]=useState(''),[scope,setScope]=useState<MemoryScope>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
 const characters=s.characters.filter(c=>!world||s.worldProfiles.some(p=>p.worldId===world&&p.characterId===c.id));
 useEffect(()=>{let alive=true;const timer=setTimeout(()=>{if(alive){setLoading(false);setError('记忆空间读取超时，请稍后重试。');}},15000);setScope(undefined);setError('');if(!character){clearTimeout(timer);setLoading(false);return;}setLoading(true);let subscription:ReturnType<ReturnType<typeof liveQuery>['subscribe']>|undefined;
  void getConversation(character,world||undefined).then(c=>{if(!alive)return;subscription=liveQuery(()=>db.conversations.get(c.id)).subscribe({next:()=>{void getMemoryScope(c.id).then(next=>{if(alive){clearTimeout(timer);setScope(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);setLoading(false);}}).catch(e=>{if(alive){clearTimeout(timer);setScope(undefined);setError(errorText(e));setLoading(false);}});},error:e=>{if(alive){clearTimeout(timer);setScope(undefined);setError(errorText(e));setLoading(false);}}});}).catch(e=>{if(alive){clearTimeout(timer);setScope(undefined);setError(errorText(e));setLoading(false);}});
  return()=>{alive=false;clearTimeout(timer);subscription?.unsubscribe();};
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
 const [visibleCounts,setVisibleCounts]=useState({core:50,long:50});
 const clearRevision=useRef({store:0,summary:0});
 const [clearKind,setClearKind]=useState<'short'|'core'|'long'>();
 const [addChoice,setAddChoice]=useState(false);const [view,setView]=useState<'home'|'core'|'long'|'summary'|'detail'|'short'|'time'>('home'),[selectedId,setSelectedId]=useState<string>(),[kind,setKind]=useState<StoredMemoryKind|'short'>('core'),[entries,setEntries]=useState<EffectiveMemory[]>([]),[short,setShort]=useState<ShortMemory>(),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [editor,setEditor]=useState<{entry?:EffectiveMemory;kind:StoredMemoryKind;text:string;revision:number}>(),[history,setHistory]=useState<MemoryEntry[]>(),[remove,setRemove]=useState<EffectiveMemory>(),[deleteError,setDeleteError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);const lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;setLoading(true);setError('');const timer=setTimeout(()=>{if(mounted.current){setLoading(false);setError('读取记忆超时，请确认没有其他窗口正在恢复数据，然后重试。');}},15000);const subscription=liveQuery(async()=>({stored:await listMemories(scope),short:view==='short'?await readShortMemory(scope):undefined})).subscribe({next:r=>{clearTimeout(timer);setEntries(r.stored.entries);setRevision(r.stored.revision);setShort(r.short);setLoading(false);setError('');},error:e=>{clearTimeout(timer);setError(errorText(e));setLoading(false);}});return()=>{mounted.current=false;clearTimeout(timer);subscription.unsubscribe();};},[scope,reload,view]);
 async function act(fn:()=>Promise<unknown>,deleting=false){if(lock.current)return;lock.current=true;setBusy(true);setError('');if(deleting)setDeleteError('');try{await fn();if(mounted.current){setEditor(undefined);setRemove(undefined);setClearKind(undefined);setHistory(undefined);if(deleting){setView(kind==='long'?'long':'core');setSelectedId(undefined);}}}catch(e){if(mounted.current){if(deleting)setDeleteError(errorText(e));else setError(errorText(e));}}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 const categorized=useMemo(()=>({core:entries.filter(e=>e.kind==='core'),long:entries.filter(e=>e.kind==='long'),legacy:entries.filter(e=>e.source==='auto'&&!e.sourceReceiptId).length}),[entries]);
 const currentEntries=view==='core'?categorized.core:categorized.long;
 const selected=entries.find(e=>e.id===selectedId);
 const openList=(next:'core'|'long')=>{setKind(next);setView(next);setSelectedId(undefined);setEditor(undefined);setHistory(undefined);setRemove(undefined);};
 const goBack=()=>{setEditor(undefined);setHistory(undefined);setRemove(undefined);if(view==='detail')setView(selected?.kind==='long'?'long':'core');else setView('home');};
 return <section aria-label="角色记忆" className="memory-panel">
 <p className="memory-scope">{scope.mode==='daily'?'日常记忆 · 持续积累，不按剧情分支拆分':'剧情记忆 · 当前有效时间线（继承共同过去，独立积累未来）'}</p>
 <div className="memory-nav-head">{view!=='home'&&<button type="button" aria-label="返回记忆首页" onClick={goBack}><ChevronLeft size={20}/></button>}{(['core','long','short'] as string[]).includes(view)&&<button type="button" disabled={busy||loading} onClick={()=>{clearRevision.current={store:revision,summary:short?.summaryRevision??0};setClearKind(view as 'core'|'long'|'short');}}>清空当前分类</button>}<h3>{view==='home'?'记忆卡片':view==='core'?'核心记忆':view==='long'?'长期记忆':view==='summary'?'自动记忆':view==='short'?'短期记忆':view==='time'?'智能时间记忆':'记忆详情'}</h3>{(view==='core'||view==='long')&&<button type="button" aria-label="添加记忆" title="添加记忆" onClick={()=>{if(view==='core'){setAddChoice(v=>!v);return;}setEditor({kind:view,text:'',revision});setSelectedId(undefined);setHistory(undefined);setRemove(undefined);}}><Plus size={20}/></button>}</div>
 {!!categorized.legacy&&<p role="status">{categorized.legacy} 条旧版自动记忆缺少来源绑定，仍可查看和编辑；核对后保存为手动记忆即可确认。</p>}
 {loading&&<p role="status">正在读取…</p>}{error&&<p role="alert">{error}<button disabled={busy} onClick={()=>{setLoading(true);setReload(n=>n+1);}}>重新读取</button></p>}
 {view==='home'&&<div className="memory-home-links">
 <button onClick={()=>setView('short')}><BookOpen size={22}/><span><strong>近期事件</strong><small>自动整理的最近经历与约定</small></span><ChevronRight size={18}/></button>
 <button onClick={()=>openList('core')}><Heart size={22}/><span><strong>核心记忆</strong><small>稳定事实与重要关系 · {categorized.core.length}条</small></span><ChevronRight size={18}/></button>
 <button onClick={()=>openList('long')}><BookOpen size={22}/><span><strong>长期记忆</strong><small>过去的经历与关系进展 · {categorized.long.length}条</small></span><ChevronRight size={18}/></button>
 <button onClick={()=>setView('summary')}><Sparkles size={22}/><span><strong>自动记忆</strong><small>自动运行状态与 API 设置</small></span><ChevronRight size={18}/></button>

 </div>}
 {view==='summary'&&<><MemorySummarySettings scope={scope}/><button type="button" className="memory-list-entry" onClick={()=>setView('short')}>查看短期记忆与近期事件摘要 <ChevronRight size={18}/></button></>}
 {view==='time'&&<SmartTimeMemoryPanel scope={scope}/>}
 {(view==='core'||view==='long')&&<>{view==='core'&&addChoice&&<div className="memory-actions"><button type="button" onClick={()=>{setEditor({kind:'core',text:'',revision});setAddChoice(false);}}>普通核心记忆</button><button type="button" onClick={()=>{setView('time');setAddChoice(false);}}>智能时间记忆</button></div>}<div className="memory-list-caption"><small>点击一条记忆查看完整内容</small><span>{currentEntries.length}条</span></div>
 {editor&&!editor.entry&&<form className="memory-editor" onSubmit={e=>{e.preventDefault();void act(()=>createMemory(scope,{kind:editor.kind,content:editor.text,source:'manual'},editor.revision));}}><h3>新增{view==='core'?'核心':'长期'}记忆</h3><label>记忆内容<textarea autoComplete="off" value={editor.text} maxLength={memoryLimits.entryChars} required onChange={e=>setEditor({...editor,text:e.target.value})}/></label><div className="memory-actions"><button type="submit" disabled={busy||!editor.text.trim()}>保存记忆</button><button type="button" disabled={busy} onClick={()=>setEditor(undefined)}>取消</button></div></form>}
 {!loading&&currentEntries.length===0&&<p className="memory-empty">暂无{view==='core'?'核心':'长期'}记忆。</p>}
 {currentEntries.slice(0,visibleCounts[view==='core'?'core':'long']).map(e=><button type="button" className="memory-list-entry" key={e.id} onClick={()=>{setSelectedId(e.id);setView('detail');setEditor(undefined);setHistory(undefined);setRemove(undefined);}}><span><strong>{e.content.slice(0,36)}{e.content.length>36?'…':''}</strong><small>{e.source==='manual'?'手动 · 已保护':'自动总结'} · {new Date(e.updatedAt).toLocaleDateString()}</small></span><ChevronRight size={18}/></button>)}
 {currentEntries.length>visibleCounts[view==='core'?'core':'long']&&<button onClick={()=>setVisibleCounts(v=>({...v,[view]:v[view==='core'?'core':'long']+50}))}>继续显示更多记忆</button>}
 </>}
 {view==='detail'&&selected&&<article className="memory-card"><div className="memory-meta"><span>{selected.source==='manual'?'手动 · 已保护':'自动总结'}</span>{selected.source==='manual'&&<ShieldCheck size={15} aria-label="手动保护"/>}{scope.mode==='world'&&<span>{selected.inherited?'继承记忆':'当前分支独有'}</span>}</div><small>更新于 {new Date(selected.updatedAt).toLocaleString()} · 修订 {selected.revision}{selected.sourceReceiptId&&` · 来源总结 ${selected.sourceReceiptId}`}</small><p>{selected.content}</p>{selected.source==='auto'&&!selected.sourceReceiptId&&<small role="status">旧版自动记忆未绑定可核验原文，内容仍完整保留。核对后使用编辑保存可确认为手动记忆。</small>}<div className="memory-actions"><button disabled={busy} onClick={()=>{setEditor({entry:selected,kind:selected.kind,text:selected.content,revision});setHistory(undefined);}}>编辑</button><button disabled={busy} onClick={()=>{void getMemoryHistory(scope,selected.id).then(rows=>{if(mounted.current){setHistory(rows);setEditor(undefined);}}).catch(err=>{if(mounted.current)setError(errorText(err));});}}>历史版本</button><button disabled={busy} onClick={()=>{setDeleteError('');setRemove(selected);setEditor(undefined);setHistory(undefined);}}>删除</button></div>
 {editor?.entry&&<form className="memory-editor" onSubmit={e=>{e.preventDefault();void act(()=>updateMemory(scope,editor.entry!.id,{kind:editor.kind,content:editor.text,source:'manual'},editor.entry!.revision));}}><label>编辑记忆<textarea value={editor.text} maxLength={memoryLimits.entryChars} onChange={e=>setEditor({...editor,text:e.target.value})}/></label><div className="memory-actions"><button disabled={busy||!editor.text.trim()}>保存</button><button type="button" onClick={()=>setEditor(undefined)}>取消</button></div></form>}
 </article>}
 {clearKind&&<MemoryDeleteDialog busy={busy} error={error} titleText={`清空当前角色的${clearKind==='short'?'短期':clearKind==='core'?'核心':'长期'}记忆？`} confirmText="确认清空" onCancel={()=>setClearKind(undefined)} onConfirm={()=>void act(()=>clearMemoryCategory(scope,clearKind,clearRevision.current.store,clearRevision.current.summary))}/>}
 {remove&&<MemoryDeleteDialog busy={busy} error={deleteError} onCancel={()=>setRemove(undefined)} onConfirm={()=>void act(()=>deleteMemory(scope,remove.id,remove.revision),true)}/>}
 {history&&<section className="memory-history" aria-label="记忆历史版本"><h3>历史版本</h3><button onClick={()=>setHistory(undefined)}>关闭历史</button>{history.map(e=><article key={e.revision}><small>修订 {e.revision} · {e.source==='manual'?'手动 · 已保护':'自动总结'} · {new Date(e.updatedAt).toLocaleString()}</small><p>{e.deleted?'已删除（局部删除标记）':e.content}</p></article>)}</section>}
 {view==='short'&&<>
 <p className="memory-scope">展示已完成总结中最近的重要事件。不会因打开页面额外调用模型；原始聊天始终保留。清空只停止当前范围的短期摘要展示与注入。</p>
 {!loading&&!short?.summaries?.length&&<p className="memory-empty">暂无近期事件。正常聊天达到总结条件后会自动整理。</p>}
 {short?.summaries?.map(item=><article className="memory-card" key={item.id}>
 <div className="memory-meta"><span>自动总结 · {new Date(item.createdAt).toLocaleString()}</span></div><IntervalSummaryText text={item.text}/>
 <details><summary>查看来源 · {item.turns.length} 轮对话</summary><p>当前角色与记忆空间；来源节点：{item.throughNodeId}</p><small>来源消息：{item.turns.flatMap(t=>[...t.userIds,t.assistantId]).join('、')}</small></details>
 </article>)}
 <button onClick={()=>setView('summary')}>自动记忆设置</button>
 </>}
 </section>;
}
