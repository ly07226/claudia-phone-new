import {useState,useSyncExternalStore} from 'react';
import {exportRequestDiagnostics,getRequestDiagnostics,requestDebugEnabled,subscribeRequestDiagnostics,type ContextSource} from './chatRequestDiagnostics';
const labels:Record<ContextSource,string>={persona:'人物卡',mode:'聊天模式',world:'世界资料',lore:'世界书',memory:'记忆',history:'历史',time:'时间',reference:'引用', 'story-instruction':'Story 指令','story-input':'Story 输入'};
/** Opt-in, fixed overlay. Rendering never writes storage, focuses or changes requests. */
export function ChatRequestDiagnosticsPanel(){
 const records=useSyncExternalStore(subscribeRequestDiagnostics,getRequestDiagnostics);
 const [open,setOpen]=useState(false),[copied,setCopied]=useState('');
 if(!requestDebugEnabled())return null;
 const latest=records.at(-1);
 return <aside aria-label="聊天请求脱敏诊断" style={{position:'fixed',top:'max(4px, env(safe-area-inset-top))',right:6,zIndex:9999,width:open?'min(340px, 88vw)':'auto',maxHeight:'40dvh',overflow:'auto',borderRadius:10,padding:8,background:'var(--theme-card, #f8f8f3)',color:'var(--theme-text, #293c31)',boxShadow:'0 2px 12px #0002',fontSize:12,lineHeight:1.5}}>
  <button type="button" onPointerDown={e=>e.preventDefault()} onMouseDown={e=>e.preventDefault()} aria-expanded={open} onClick={()=>setOpen(!open)}>请求诊断 · {records.length}/20 {open?'收起':'展开'}</button>
  {open&&<>
   <p>仅内存元数据，无正文。格式特征不等于污染证据。复现时请收起面板。</p>
   {latest?<><strong>#{latest.sequence} · {latest.mode} · {latest.status}</strong>
    <div>历史 {latest.history.included}/{latest.history.available} · 记忆 {latest.memory?.selected??0}</div>
    {latest.sources.map((s,i)=><div key={i}>{labels[s.source]} #{i+1} · {s.chars}字 · ABCD={s.abcdLabels}{s.choiceProtocolHint?' · 选项协议特征':''}{s.duplicateOf!==undefined?` · 与#${s.duplicateOf+1}相同`:''}{s.position?` · ${s.position}`:''}</div>)}
    <div>原始输出：ABCD={latest.response?.abcdLabels??'尚无'} · 协议特征={String(latest.response?.choiceProtocolHint??false)}</div>
    <div>世界书注入 {latest.lore.filter(d=>d.outcome==='injected').length}，跳过 {latest.lore.filter(d=>d.outcome==='skipped').length}</div>
   </>:<p>尚未生成请求。</p>}
   <button type="button" onPointerDown={e=>e.preventDefault()} onMouseDown={e=>e.preventDefault()} onClick={()=>{
    if(!navigator.clipboard?.writeText){setCopied('当前环境不支持剪贴板');return;}
    void navigator.clipboard.writeText(exportRequestDiagnostics()).then(()=>setCopied('已复制脱敏诊断'),()=>setCopied('复制失败，请检查剪贴板权限'));
   }}>复制脱敏诊断</button><span role="status">{copied}</span>
  </>}
 </aside>;
}
