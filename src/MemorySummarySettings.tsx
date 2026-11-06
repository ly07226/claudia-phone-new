import {useEffect,useState} from 'react';
import {liveQuery} from 'dexie';
import {db} from './store';
import type {MemoryScope} from './memoryTypes';
import {summaryStatus,saveSummarySettings,runMemorySummary} from './memorySummary';
import {summaryFailureText} from './memorySummaryTypes';
export function MemorySummarySettings({scope}:{scope:MemoryScope}){
 const [state,setState]=useState<Awaited<ReturnType<typeof summaryStatus>>>(),[error,setError]=useState(''),[saving,setSaving]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let alive=true,sequence=0;const subscription=liveQuery(()=>db.conversations.get(scope.conversationId)).subscribe({next:()=>{const ticket=++sequence;void summaryStatus(scope).then(s=>{if(alive&&ticket===sequence){setState(s);setError('');}}).catch(()=>{if(alive&&ticket===sequence)setError('总结状态暂时不可用，请刷新状态。');});},error:()=>{if(alive)setError('总结状态暂时不可用，请刷新状态。');}});return()=>{alive=false;sequence++;subscription.unsubscribe();};},[scope,refresh]);
 async function settings(enabled:boolean,interval:number){setSaving(true);try{await saveSummarySettings(scope,enabled,interval);}catch{setError('设置保存失败，原设置未清除。');}finally{setSaving(false);}}
 return <section className="memory-editor" aria-label="自动总结设置"><h3>自动总结设置</h3><p>开启后，每完成指定轮次会额外请求当前 API，消耗 Token。默认关闭。手动总结也会消耗 Token。</p>
 {!state&&<p role="status">正在读取总结进度…</p>}{error&&<p role="alert">{error}<button onClick={()=>setRefresh(n=>n+1)}>刷新状态</button></p>}
 {state&&<><label className="memory-summary-toggle">自动总结<input type="checkbox" role="switch" aria-label="自动总结" checked={state.enabled} disabled={saving} onChange={e=>void settings(e.target.checked,state.interval)}/></label>
 <label>总结间隔<select aria-label="总结间隔" value={state.interval} disabled={saving} onChange={e=>void settings(state.enabled,Number(e.target.value))}>{Array.from({length:9},(_,i)=>20+i*10).map(n=><option key={n} value={n}>{n} 轮</option>)}</select></label>
 <p className="memory-scope">当前有效路径有 {state.pending} 轮尚未总结；已完成 {state.receipts} 段。仅读取本会话，图片仅标记存在，不额外识图。</p>
 {state.job?.status==='running'&&<p role="status">{state.busy?'总结任务已登记，可能在其他窗口处理中。聊天不受影响；若上次页面已关闭，请90秒后刷新状态再手动重试。':'上次总结可能已中断，不会自动重试；重试可能再次消耗 Token。'}</p>}
 {state.job?.status==='failed'&&<p role="alert">{summaryFailureText[state.job.error??'state']}</p>}
 {state.job?.status==='succeeded'&&<p role="status">上次总结成功：新增 {state.job.added??0} 条长期记忆，跳过 {state.job.duplicates??0} 条重复内容。</p>}
 <div className="memory-actions"><button disabled={saving||state.busy||state.pending===0} onClick={()=>{if(!window.confirm('立即总结将额外调用当前模型并消耗 API Token。失败或上次任务中断后重试也可能再次计费。是否继续？'))return;setSaving(true);void runMemorySummary(scope,true).catch(()=>setError('总结未能启动，请检查路径、容量或稍后重试。')).finally(()=>setSaving(false));}}>立即总结{state.job?.status==='failed'?' / 重试':''}</button><button disabled={saving} onClick={()=>setRefresh(n=>n+1)}>刷新状态</button></div></>}
 </section>;
}
