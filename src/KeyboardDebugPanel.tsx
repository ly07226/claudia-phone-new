import {useSyncExternalStore} from 'react';
import {getKeyboardDebugRecords,keyboardDebugEnabled,subscribeKeyboardDebug} from './keyboardDebug';
export function KeyboardDebugPanel(){
  const events=useSyncExternalStore(subscribeKeyboardDebug,getKeyboardDebugRecords);
  if(!keyboardDebugEnabled())return null;
  const latest=[...events].reverse();
  const detector=latest.find(e=>['mounted','not-mounted','unmounted'].includes(e.event));
  const mounted=detector?.event==='mounted';
  const state=latest.find(e=>e.fields.state)?.fields.state??'unknown';
  const armed=latest.find(e=>e.fields.armed!==undefined)?.fields.armed;
  const stopped=latest.find(e=>e.fields.reason&&e.fields.reason!=='consumed'&&['reset','not-mounted','candidate-cancelled','generation-blocked','reply-returned'].includes(e.event));
  const geometry=latest.find(e=>e.fields.height!==undefined)?.fields;
  const checks=latest.find(e=>e.fields.pendingUser!==undefined)?.fields;
  return <aside inert aria-label="键盘开发诊断" style={{position:'fixed',top:'max(4px, env(safe-area-inset-top))',right:4,width:'min(330px, 84vw)',maxHeight:'min(220px, calc(100svh - 12px))',overflow:'hidden',zIndex:10000,pointerEvents:'none',userSelect:'none',WebkitUserSelect:'none',background:'#1e3028',color:'#f5f7ed',borderRadius:8,padding:7,fontSize:11,lineHeight:1.35,whiteSpace:'normal',overflowWrap:'anywhere'}}>
    <strong>键盘诊断（只读／推断） · {events.length}/200</strong>
    <div data-debug-summary>检测器：{mounted?'已挂载':'未挂载'} · D{detector?.fields.detector??0} · armed={String(armed??false)}</div>
    <div>keyboard={state} · save={String(geometry?.saving??'?')}</div>
    <div>h={geometry?.height??'?'} w={geometry?.width??'?'} top={geometry?.offsetTop??'?'} scale={geometry?.scale??'?'}</div>
    <div>B={geometry?.baseline??'?'} openH={geometry?.openHeight??'?'} hold={Math.round(geometry?.suppressionRemaining??0)}ms</div>
    <div data-debug-reason>最近取消／阻止：{stopped?.fields.reason??'无'}（D{stopped?.fields.detector??0}）</div>
    {checks&&<div>待回复={+!!checks.pendingUser} 空闲={+!!checks.idle} 无锁={+!!checks.noPending} 路径={+!!(checks.pathConversation&&checks.pathTimeline&&checks.pathEpoch)}</div>}
    <div>最近事件（新→旧）</div>
    {events.slice(-3).reverse().map(e=><div data-debug-event key={e.sequence} style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.sequence} · {e.ms}ms · {e.event}{e.fields.reason?` · ${e.fields.reason}`:''}</div>)}
  </aside>;
}
