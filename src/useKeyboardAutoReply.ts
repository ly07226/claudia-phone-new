import {useEffect,useRef,type RefObject} from 'react';
import {keyboardDebugEnabled,keyboardDebugTarget,nextKeyboardDebugDetector,recordKeyboardDebug,type DebugFields} from './keyboardDebug';

interface Options {
  scope:string;
  conversationId?:string;
  initialTimeline:boolean;
  enabled:boolean;
  blocked:boolean;
  savingMessage:boolean;
  canReply:()=>boolean;
  reply:()=>void;
}
/** Best-effort intent inference, never a reliable system-keyboard notification.
 * No geometry, focus or scroll writes: this observer is independent of layout.
 */
export function useKeyboardAutoReply(input:RefObject<HTMLTextAreaElement|null>,options:Options){
  const latest=useRef(options);latest.current=options;
  const suppressUntil=useRef(0);
  const savedWithFocus=useRef(false);
  const previousSaving=useRef(options.savingMessage);
  const saveFinished=useRef(()=>{});
  const initialRoot=useRef<string|undefined>(undefined);
  const cancelRef=useRef(()=>{});
  const debugDetector=useRef(0);
  useEffect(()=>{
    const debug=keyboardDebugEnabled(),detector=nextKeyboardDebugDetector();debugDetector.current=detector;
    // Only lazy creation of the first root may retain the already-focused editor.
    // A real path/overlay change requires a fresh input interaction before arming.
    const initializingRoot=initialRoot.current===options.conversationId&&!options.initialTimeline;
    initialRoot.current=options.initialTimeline?options.conversationId:undefined;
    const viewport=window.visualViewport;
    if(!options.enabled||options.blocked||!viewport||navigator.maxTouchPoints<1||!matchMedia('(pointer: coarse)').matches){
      if(debug)recordKeyboardDebug('not-mounted',{detector,enabled:options.enabled,blocked:options.blocked,reason:!options.enabled?'disabled':options.blocked?'blocked':!viewport?'no-viewport':navigator.maxTouchPoints<1?'no-touch':'no-coarse-pointer'});
      return;
    }
    const scope=options.scope;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let armed=false,focused=initializingRoot&&document.activeElement===input.current,composing=false,disposed=false;
    let baseline=Math.max(innerHeight,document.documentElement.clientHeight,viewport.height);
    let width=innerWidth,viewportWidth=viewport.width,openHeight=0;
    const trace=(event:Parameters<typeof recordKeyboardDebug>[0],fields:DebugFields={})=>{
      if(!debug)return;
      recordKeyboardDebug(event,{detector,height:viewport.height,width:viewport.width,offsetTop:viewport.offsetTop,scale:viewport.scale,baseline,openHeight,closeHeight:viewport.height,innerHeight,clientHeight:document.documentElement.clientHeight,widthDelta:Math.abs(viewport.width-viewportWidth),openDelta:baseline-viewport.height,openThreshold:Math.max(150,baseline*.2),closedMinimum:baseline-80,closeDelta:viewport.height-openHeight,armed,focused,inputFocused:document.activeElement===input.current,savedWithFocus:savedWithFocus.current,saving:latest.current.savingMessage,enabled:latest.current.enabled,blocked:latest.current.blocked,documentFocused:document.hasFocus(),hidden:document.hidden,composing,scopeMatches:latest.current.scope===scope,alive:!disposed,noOverlay:!document.querySelector('[role="dialog"],[role="alertdialog"],dialog[open]'),viewportValid:Number.isFinite(viewport.height)&&viewport.height>0&&Number.isFinite(viewport.offsetTop)&&viewport.offsetTop>=0&&Math.abs(viewport.scale-1)<.02,openFocusPass:focused&&document.activeElement===input.current,openHeightPass:baseline-viewport.height>=Math.max(150,baseline*.2),closeBaselinePass:viewport.height>=baseline-80,closeRisePass:viewport.height-openHeight>=150,closeOffsetPass:viewport.offsetTop<=40,suppressionRemaining:Math.max(0,suppressUntil.current-performance.now()),state:armed?(viewport.height>=baseline-80&&viewport.height-openHeight>=150&&viewport.offsetTop<=40?'closed':'open'):'unknown',...fields});
    };
    const clear=(reason:DebugFields['reason']='reschedule')=>{if(timer!==undefined)trace('candidate-cancelled',{reason});clearTimeout(timer);timer=undefined;};
    const reset=(reason:DebugFields['reason']='manual-cancel')=>{clear(reason);armed=false;focused=false;openHeight=0;savedWithFocus.current=false;trace('reset',{reason});};
    cancelRef.current=()=>reset('manual-cancel');
    saveFinished.current=()=>{savedWithFocus.current=document.activeElement===input.current;trace('save-finished');};
    const valid=()=>Number.isFinite(viewport.height)&&viewport.height>0&&Number.isFinite(viewport.offsetTop)&&viewport.offsetTop>=0&&Math.abs(viewport.scale-1)<.02;
    const allowed=()=>!disposed&&latest.current.scope===scope&&latest.current.enabled&&!latest.current.blocked&&!document.hidden&&document.hasFocus()&&!composing&&!document.querySelector('[role="dialog"],[role="alertdialog"],dialog[open]');
    const closed=()=>viewport.height>=baseline-80&&viewport.height-openHeight>=150&&viewport.offsetTop<=40;
    const update=(event?:Event)=>{
      trace('viewport',{source:event?.type as DebugFields['source']??'setup'});
      if(!allowed()||!valid()){reset(!allowed()?'gate':'invalid-viewport');return;}
      if(Math.abs(innerWidth-width)>2||Math.abs(viewport.width-viewportWidth)>2){
        reset('width-changed');width=innerWidth;viewportWidth=viewport.width;baseline=Math.max(innerHeight,document.documentElement.clientHeight,viewport.height);return;
      }
      const inputFocused=document.activeElement===input.current;
      if(!armed){
        trace('open-check');
        if(focused&&inputFocused&&baseline-viewport.height>=Math.max(150,baseline*.2)){
          armed=true;openHeight=viewport.height;
          trace('keyboardOpen');
        }else if(!inputFocused)baseline=Math.max(innerHeight,document.documentElement.clientHeight,viewport.height);
        return;
      }
      trace('close-check');
      if(!closed()){clear('not-closed');return;}
      trace('keyboardClosed');
      clear();const height=viewport.height;
      const delay=Math.max(400,suppressUntil.current-performance.now());
      timer=setTimeout(()=>{
        timer=undefined;
        const attempt=armed&&allowed()&&valid()&&closed()&&Math.abs(viewport.height-height)<24&&performance.now()>=suppressUntil.current;
        trace('candidate-timer',{candidateHeight:height,attempt,viewportValid:valid(),heightStable:Math.abs(viewport.height-height)<24,suppressionElapsed:performance.now()>=suppressUntil.current,reason:attempt?undefined:'timer-rejected'});
        // Consume this open/close cycle before requesting anything, including failure.
        reset('consumed');
        if(attempt){const canReply=latest.current.canReply();trace('reply-check',{canReply,reason:canReply?undefined:'reply-check-failed'});if(canReply){trace('reply-requested');latest.current.reply();}}
      },delay);
      trace('candidate-created',{delay,candidateHeight:height});
    };
    const focus=(e:FocusEvent)=>{trace('focus',{target:keyboardDebugTarget(e.target,input.current),source:'focusin'});if(e.target===input.current){focused=true;update();}else reset('focus-other');};
    // A recent save that demonstrably retained focus may be followed by iOS Done.
    // Preserve only that no-target blur; it never starts the close timer itself.
    // A button focus transfer or blur during the save is still rejected. A script
    // producing identical no-target blur + geometry remains indistinguishable.
    const blur=(e:FocusEvent)=>{
      if(e.target!==input.current)return;
      trace('blur',{source:'focusout',target:'input',relatedTarget:keyboardDebugTarget(e.relatedTarget,input.current)});
      if(e.relatedTarget===null&&savedWithFocus.current&&!latest.current.savingMessage&&performance.now()<suppressUntil.current&&armed&&allowed()){trace('blur',{reason:'blur-preserved'});return;}
      reset('blur-rejected');
    };
    const pointer=(e:PointerEvent)=>{
      trace('pointer',{source:'pointerdown',target:keyboardDebugTarget(e.target,input.current)});
      if(e.target===input.current){clear();focused=true;update();return;}
      if(e.target instanceof Element&&e.target.closest('.chat-send')){clear();savedWithFocus.current=false;suppressUntil.current=performance.now()+600;return;}
      reset('pointer-other');
    };
    const compositionStart=()=>{composing=true;trace('composition',{source:'compositionstart'});reset('composition-start');};
    const compositionEnd=()=>{composing=false;trace('composition',{source:'compositionend'});reset('composition-end');};
    const visibility=(event:Event)=>reset(event.type==='blur'?'window-blur':event.type==='pagehide'?'pagehide':'visibilitychange');
    const context=(event:Event)=>reset(event.type==='orientationchange'?'orientationchange':'contextmenu');
    viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);
    document.addEventListener('focusin',focus);document.addEventListener('focusout',blur);
    document.addEventListener('pointerdown',pointer,true);
    input.current?.addEventListener('compositionstart',compositionStart);input.current?.addEventListener('compositionend',compositionEnd);
    document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',visibility);window.addEventListener('blur',visibility);window.addEventListener('orientationchange',context);document.addEventListener('contextmenu',context,true);
    const element=input.current;
    trace('mounted');
    update();
    return()=>{
      trace('unmounted',{reason:'cleanup'});disposed=true;reset('cleanup');cancelRef.current=()=>{};saveFinished.current=()=>{};
      viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);
      document.removeEventListener('focusin',focus);document.removeEventListener('focusout',blur);document.removeEventListener('pointerdown',pointer,true);
      element?.removeEventListener('compositionstart',compositionStart);element?.removeEventListener('compositionend',compositionEnd);
      document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',visibility);window.removeEventListener('blur',visibility);window.removeEventListener('orientationchange',context);document.removeEventListener('contextmenu',context,true);
    };
  },[options.scope,options.enabled,options.blocked,input]);
  useEffect(()=>{
    recordKeyboardDebug('save-state',{detector:debugDetector.current,saving:options.savingMessage});
    if(previousSaving.current&&!options.savingMessage)saveFinished.current();
    previousSaving.current=options.savingMessage;
  },[options.savingMessage]);
  return {
    cancel:()=>cancelRef.current(),
    suppressSend:()=>{savedWithFocus.current=false;suppressUntil.current=performance.now()+600;recordKeyboardDebug('send-suppression',{detector:debugDetector.current,suppressionRemaining:600});},
  };
}
