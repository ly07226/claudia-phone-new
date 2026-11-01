import {useSyncExternalStore} from 'react';
import {getKeyboardDebugRecords,getKeyboardDebugFirst,keyboardDebugEnabled,subscribeKeyboardDebug} from './keyboardDebug';
export function KeyboardDebugPanel(){
  const events=useSyncExternalStore(subscribeKeyboardDebug,getKeyboardDebugRecords);
  if(!keyboardDebugEnabled())return null;
  const latest=[...events].reverse();
  const first=getKeyboardDebugFirst();
  const stamp=(e:typeof events[number]|undefined)=>e?`#${e.sequence} +${e.ms}ms`:'尚无';
  const detector=latest.find(e=>['mounted','not-mounted','unmounted'].includes(e.event));
  const mounted=detector?.event==='mounted';
  const state=latest.find(e=>e.fields.state)?.fields.state??'unknown';
  const armed=latest.find(e=>e.fields.armed!==undefined)?.fields.armed;
  const stopped=latest.find(e=>e.fields.reason&&e.fields.reason!=='consumed'&&['reset','not-mounted','candidate-cancelled','generation-blocked','reply-returned'].includes(e.event));
  const geometry=latest.find(e=>e.fields.height!==undefined)?.fields;
  const checks=latest.find(e=>e.fields.pendingUser!==undefined)?.fields;
  return <aside inert aria-label="键盘开发诊断" style={{position:'fixed',top:'max(4px, env(safe-area-inset-top))',right:4,width:'min(330px, 84vw)',maxHeight:'min(340px, calc(100svh - 12px))',overflow:'hidden',zIndex:10000,pointerEvents:'none',userSelect:'none',WebkitUserSelect:'none',background:'#1e3028',color:'#f5f7ed',borderRadius:8,padding:7,fontSize:11,lineHeight:1.35,whiteSpace:'normal',overflowWrap:'anywhere'}}>
    <strong>键盘诊断（只读／推断） · {events.length}/200</strong>
    <div data-debug-summary>检测器：{mounted?'已挂载':'未挂载'} · D{detector?.fields.detector??0} · armed={String(armed??false)}</div>
    <div>keyboard={state} save={String(geometry?.saving??'?')} h={geometry?.height??'?'} top={geometry?.offsetTop??'?'} B={geometry?.baseline??'?'}</div>
    <div data-debug-reason>最近取消／阻止：{stopped?.fields.reason??'无'}（D{stopped?.fields.detector??0}）</div>
    {checks&&<div>待回复={+!!checks.pendingUser} 空闲={+!!checks.idle} 无锁={+!!checks.noPending} 路径={+!!(checks.pathConversation&&checks.pathTimeline&&checks.pathEpoch)}</div>}
    <div data-debug-first>首次失焦：{stamp(first.blur)}<br/>首次视口恢复：{stamp(first.viewport)}<br/>首次自动触发：{stamp(first.auto)}<br/>首次 disabled：{stamp(first.disabled)}</div>
    <div>最近事件（旧→新；+ms 自页面加载）</div>
    {events.slice(-3).map(e=><div data-debug-event key={e.sequence} style={{whiteSpace:'normal',overflowWrap:'anywhere'}}>{e.sequence} · {e.ms}ms · {e.event}{e.fields.flow?` · ${e.fields.flow}`:''}{e.fields.reason?` · ${e.fields.reason}`:''}{e.fields.inputFocused!==undefined?` F=${+e.fields.inputFocused}`:''}{e.fields.disabled!==undefined?` D=${+e.fields.disabled}`:''}</div>)}
  </aside>;
}
