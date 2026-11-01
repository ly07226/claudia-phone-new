const events=['mounted','not-mounted','unmounted','viewport','open-check','close-check','keyboardOpen','keyboardClosed','focus','blur','pointer','composition','reset','candidate-created','candidate-cancelled','candidate-timer','reply-requested','reply-check','reply-returned','send-true','generation-entered','generation-blocked','save-state','save-finished','send-suppression'] as const;
type DebugEvent=typeof events[number];
const reasons=['disabled','blocked','no-viewport','no-touch','no-coarse-pointer','gate','invalid-viewport','width-changed','not-closed','reschedule','consumed','timer-rejected','reply-check-failed','focus-other','blur-rejected','blur-preserved','blur-send-in-progress','pointer-other','send-pointer','input-pointer','composition-start','composition-end','visibilitychange','pagehide','window-blur','orientationchange','contextmenu','cleanup','manual-cancel','no-conversation','busy','service-lock','service-path','service-no-pending','generation-failed','gate-hidden','gate-overlay','gate-composing','gate-path','waiting-save','window-blur-observed'] as const;
type DebugReason=typeof reasons[number];
const numeric=['detector','height','width','offsetTop','scale','baseline','openHeight','closeHeight','innerHeight','clientHeight','widthDelta','openDelta','openThreshold','closedMinimum','closeDelta','suppressionRemaining','delay','candidateHeight'] as const;
const flags=['armed','focused','inputFocused','savedWithFocus','sendFocusPending','saving','enabled','blocked','documentFocused','hidden','composing','scopeMatches','alive','noOverlay','viewportValid','openFocusPass','openHeightPass','closeBaselinePass','closeRisePass','closeOffsetPass','heightStable','suppressionElapsed','attempt','canReply','hasConversation','currentConversation','pathConversation','pathTimeline','pathEpoch','idle','noPending','pendingUser','success'] as const;
type Target='input'|'send'|'reply'|'control'|'none'|'other';
type Source='setup'|'resize'|'scroll'|'focusin'|'focusout'|'pointerdown'|'compositionstart'|'compositionend'|'visibilitychange'|'pagehide'|'blur'|'orientationchange'|'contextmenu';
export type DebugFields=Partial<Record<typeof numeric[number],number>&Record<typeof flags[number],boolean>>&{reason?:DebugReason;target?:Target;relatedTarget?:Target;source?:Source;state?:'open'|'closed'|'unknown';phase?:'idle'|'open'|'closing'|'waiting-save'|'consumed'};
export interface KeyboardDebugRecord {sequence:number;ms:number;event:DebugEvent;fields:DebugFields}
const targets=['input','send','reply','control','none','other'];
const sources=['setup','resize','scroll','focusin','focusout','pointerdown','compositionstart','compositionend','visibilitychange','pagehide','blur','orientationchange','contextmenu'];
let records:readonly KeyboardDebugRecord[]=[],sequence=0,detector=0;
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
  records=[...records.slice(-199),{sequence:++sequence,ms:Math.round(performance.now()),event,fields:safe as DebugFields}];
  for(const notify of listeners)notify();
}
export const getKeyboardDebugRecords=()=>records;
export function subscribeKeyboardDebug(notify:()=>void){if(!keyboardDebugEnabled())return ()=>{};listeners.add(notify);return()=>{listeners.delete(notify);};}
export function keyboardDebugTarget(target:EventTarget|null,input:HTMLElement|null):Target{
  if(target===null)return 'none';if(target===input)return 'input';
  if(target instanceof Element){if(target.closest('.chat-send'))return 'send';if(target.closest('.chat-reply-button'))return 'reply';if(target.closest('button,input,textarea,select,a'))return 'control';}
  return 'other';
}
