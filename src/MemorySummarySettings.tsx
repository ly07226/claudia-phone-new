import {useEffect,useState} from 'react';
import {liveQuery} from 'dexie';
import {db} from './store';
import type {MemoryScope} from './memoryTypes';
import {summaryStatus,saveSummarySettings,runMemorySummary} from './memorySummary';
import {SummaryApiEditor} from './SummaryApiEditor';
import type {DedicatedSummaryApi} from './dedicatedSummaryApi';

/** Compact memory controls. The legacy summaries remain readable during migration,
 * but daily-digest and multi-stage execution controls are no longer exposed here.
 */
export function MemorySummarySettings({scope}:{scope:MemoryScope}){
 const [state,setState]=useState<Awaited<ReturnType<typeof summaryStatus>>>();
 const [api,setApi]=useState<DedicatedSummaryApi>({provider:'openai-compatible',baseUrl:'',model:'',apiKey:'',temperature:0.2,maxTokens:3000,enabled:true});
 const [showApi,setShowApi]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;const sub=liveQuery(async()=>({status:await summaryStatus(scope),global:await db.themes.get('global')})).subscribe({next:v=>{if(!active)return;setState(v.status);if(v.global?.dedicatedSummaryApi)setApi(v.global.dedicatedSummaryApi);},error:()=>{if(active)setError('记忆状态读取失败，请稍后重试。');}});return()=>{active=false;sub.unsubscribe();};},[scope]);
 async function configure(enabled:boolean){setBusy(true);setError('');try{await saveSummarySettings(scope,enabled,state?.interval??40);}catch{setError('自动记忆设置保存失败。');}finally{setBusy(false);}}
 async function summarize(){if(!state||busy)return;setBusy(true);setError('');try{await runMemorySummary(scope,true);}catch(e){setError(e instanceof Error?e.message:'记忆总结失败，请检查接口。');}finally{setBusy(false);}}
 return <section className="memory-summary-screen" aria-label="自动记忆">
  <h3>自动记忆</h3>
  <p>聊天时自动整理重要事件、关系变化与长期记忆。默认每 40 轮检查一次，不影响正常回复。</p>
  {!state?<p role="status">正在读取记忆状态…</p>:<>
   <label className="memory-summary-toggle">自动记忆<input type="checkbox" role="switch" aria-label="自动记忆" checked={state.enabled} disabled={busy} onChange={e=>void configure(e.target.checked)}/></label>
   <div className="memory-summary-stats"><div><strong>{state.pending}</strong><small>待整理轮次</small></div><div><strong>{state.receipts}</strong><small>已保存批次</small></div></div>
   {state.job?.status==='running'&&<p role="status">正在整理记忆，聊天不受影响。</p>}
   {state.job?.status==='failed'&&<p role="alert">上次整理未完成，原聊天和已保存的记忆仍保留。{state.job.error?(' 原因：'+state.job.error):''}</p>}
   {state.job?.status==='succeeded'&&<p role="status">上次整理已完成。</p>}
   <div className="memory-actions"><button type="button" disabled={busy||state.busy||state.pending===0} onClick={()=>void summarize()}>立即整理{state.job?.status==='failed'?' / 重试':''}</button><button type="button" aria-expanded={showApi} onClick={()=>setShowApi(v=>!v)}>API 设置</button></div>
  </>}
  {showApi&&<SummaryApiEditor value={api} onChange={setApi}/>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
