const events=['mounted','not-mounted','unmounted','viewport','open-check','close-check','keyboardOpen','keyboardClosed','focus','blur','pointer','composition','reset','candidate-created','candidate-cancelled','candidate-timer','reply-requested','reply-check','reply-returned','send-true','generation-entered','generation-blocked','save-state','save-finished','send-suppression','send-pointerdown','send-pointerup','send-click','send-start','message-save-start','message-save-end','input-focus','input-blur','input-disabled','input-mounted','input-removed','generation-allowed','ai-start'] as const;
type DebugEvent=typeof events[number];
const reasons=['disabled','blocked','no-viewport','no-touch','no-coarse-pointer','gate','invalid-viewport','width-changed','not-closed','reschedule','consumed','timer-rejected','reply-check-failed','focus-other','blur-rejected','blur-preserved','blur-send-in-progress','pointer-other','send-pointer','input-pointer','composition-start','composition-end','visibilitychange','pagehide','window-blur','orientationchange','contextmenu','cleanup','manual-cancel','no-conversation','busy','service-lock','service-path','service-no-pending','generation-failed','gate-hidden','gate-overlay','gate-composing','gate-path','waiting-save','window-blur-observed'] as const;
type DebugReason=typeof reasons[number];
const numeric=['detector','height','width','offsetTop','scale','baseline','openHeight','closeHeight','innerHeight','clientHeight','widthDelta','openDelta','openThreshold','closedMinimum','closeDelta','suppressionRemaining','delay','candidateHeight','node'] as const;
const flags=['armed','focused','inputFocused','savedWithFocus','sendFocusPending','saving','enabled','blocked','documentFocused','hidden','composing','scopeMatches','alive','noOverlay','viewportValid','openFocusPass','openHeightPass','closeBaselinePass','closeRisePass','closeOffsetPass','heightStable','suppressionElapsed','attempt','canReply','hasConversation','currentConversation','pathConversation','pathTimeline','pathEpoch','idle','noPending','pendingUser','success','disabled','wasDisabled','connected','defaultPrevented'] as const;
type Target='input'|'send'|'reply'|'control'|'none'|'other';
type Source='setup'|'resize'|'scroll'|'focusin'|'focusout'|'pointerdown'|'compositionstart'|'compositionend'|'visibilitychange'|'pagehide'|'blur'|'orientationchange'|'contextmenu';
export type DebugFields=Partial<Record<typeof numeric[number],number>&Record<typeof flags[number],boolean>>&{reason?:DebugReason;target?:Target;relatedTarget?:Target;source?:Source;state?:'open'|'closed'|'unknown';flow?:'ordinary'|'automatic'|'manual'|'other';phase?:'idle'|'open'|'closing'|'waiting-save'|'consumed'};
export interface KeyboardDebugRecord {sequence:number;ms:number;event:DebugEvent;fields:DebugFields}
const targets=['input','send','reply','control','none','other'];
const sources=['setup','resize','scroll','focusin','focusout','pointerdown','compositionstart','compositionend','visibilitychange','pagehide','blur','orientationchange','contextmenu'];
let records:readonly KeyboardDebugRecord[]=[],sequence=0,detector=0;
let first:Partial<Record<'blur'|'viewport'|'auto'|'disabled',KeyboardDebugRecord>>={};
export const getKeyboardDebugFirst=()=>first;
const listeners=new Set<()=>void>();
export function keyboardDebugEnabled(){return typeof location!=='undefined'&&new URLSearchParams(location.search).get('keyboardDebug')==='1';}
export function nextKeyboardDebugDetector(){return keyboardDebugEnabled()?++detector:0;}
/** Strict allowlist: arbitrary text, URLs, IDs, errors and credentials cannot enter the buffer. */
export function recordKeyboardDebug(event:DebugEvent,fields:DebugFields={}){
  if(!keyboardDebugEnabled()||!events.includes(event))return;
  const safe:Record<string,unknown>={};
  for(const key of numeric){const value=fields[key];if(typeof value==='number'&&Number.isFinite(value))safe[key]=value;}
  for(const key of flags){const value=fields[key];if(typeof value==='boolean')safe[key]=value;}
  if(fields.reason&&reasons.includes(fields.reason))safe.reason=fields.reason;
  if(fields.target&&targets.includes(fields.target))safe.target=fields.target;
  if(fields.relatedTarget&&targets.includes(fields.relatedTarget))safe.relatedTarget=fields.relatedTarget;
  if(fields.source&&sources.includes(fields.source))safe.source=fields.source;
  if(fields.state&&['open','closed','unknown'].includes(fields.state))safe.state=fields.state;
  if(fields.phase&&['idle','open','closing','waiting-save','consumed'].includes(fields.phase))safe.phase=fields.phase;
  if(fields.flow&&['ordinary','automatic','manual','other'].includes(fields.flow))safe.flow=fields.flow;
  const record={sequence:++sequence,ms:Math.round(performance.now()*10)/10,event,fields:safe as DebugFields};
  records=[...records.slice(-199),record];
  const mark=event==='input-blur'?'blur':event==='viewport'&&fields.armed&&fields.closeBaselinePass&&fields.closeRisePass?'viewport':event==='reply-requested'?'auto':event==='input-disabled'&&fields.disabled?'disabled':undefined;
  if(mark&&!first[mark])first={...first,[mark]:record};
  for(const notify of listeners)notify();
}
export const getKeyboardDebugRecords=()=>records;
export function subscribeKeyboardDebug(notify:()=>void){if(!keyboardDebugEnabled())return ()=>{};listeners.add(notify);return()=>{listeners.delete(notify);};}
export function keyboardDebugTarget(target:EventTarget|null,input:HTMLElement|null):Target{
  if(target===null)return 'none';if(target===input)return 'input';
  if(target instanceof Element){if(target.closest('.chat-send'))return 'send';if(target.closest('.chat-reply-button'))return 'reply';if(target.closest('button,input,textarea,select,a'))return 'control';}
  return 'other';
}

/** Snapshot only: no DOM reads, persistence, network, or recovery of discarded events. */
export function exportKeyboardDebugLog(){
  if(!keyboardDebugEnabled())return '';
  const snapshot=records;
  const dropped=sequence-snapshot.length;
  const header=[
    'Claudia Phone keyboard diagnostic v1',
    `记录=${snapshot.length}；丢弃=${dropped}；上限=200`,
    dropped?'已截断：仅导出保留事件，并非完整历史。':'未截断：包含本页当前全部诊断事件。',
    'ms 为页面加载后的 performance.now()；sequence 为统一事件序号。',
    'flow=null 表示未归属普通/手动/自动流程，不推断归属。',
    'context 为保留日志中的最近观测值；null 表示尚无观测，不代表实际状态。',
  ];
  const context:Record<string,number|boolean|string|null>={state:null,phase:null,armed:null,inputFocused:null,disabled:null,height:null,offsetTop:null,baseline:null,openHeight:null};
  const lines=snapshot.map(record=>{
    for(const key of Object.keys(context)){
      const value=record.fields[key as keyof DebugFields];
      if(value!==undefined)context[key]=value;
    }
    return JSON.stringify({sequence:record.sequence,ms:record.ms,event:record.event,flow:record.fields.flow??null,context:{...context},fields:record.fields});
  });
  return [...header,...lines].join('\n');
}
