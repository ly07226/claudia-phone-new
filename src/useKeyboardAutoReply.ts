import {useEffect,useRef,type RefObject} from 'react';
import {keyboardDebugEnabled,keyboardDebugTarget,nextKeyboardDebugDetector,recordKeyboardDebug,type DebugFields} from './keyboardDebug';
interface Options {
  scope:string; identity:string; epoch:number; conversationId?:string; initialTimeline:boolean;
  enabled:boolean; blocked:boolean; savingMessage:boolean;
  canReply:()=>boolean; reply:()=>void;
}
type Phase='idle'|'open'|'closing'|'waiting-save'|'consumed';
/** Presentation-independent, best-effort keyboard cycle. Never writes geometry or focus. */
export function useKeyboardAutoReply(input:RefObject<HTMLTextAreaElement|null>,options:Options){
  const latest=useRef(options);latest.current=options;
  const control=useRef<{cancel:()=>void;send:()=>void;sample:()=>void}|null>(null);
  useEffect(()=>{
    const debug=keyboardDebugEnabled(),detector=nextKeyboardDebugDetector(),availableViewport=window.visualViewport;
    if(!options.enabled||!availableViewport||navigator.maxTouchPoints<1||!matchMedia('(pointer: coarse)').matches){
      if(debug)recordKeyboardDebug('not-mounted',{detector,reason:!options.enabled?'disabled':!availableViewport?'no-viewport':navigator.maxTouchPoints<1?'no-touch':'no-coarse-pointer'});
      return;
    }
    const viewport=availableViewport;
    let scope=options.scope,epoch=options.epoch,initial=options.initialTimeline;
    let phase:Phase='idle',focusSeen=false,composing=false,disposed=false,acceptedSend=false;
    // Learn the actually visible closed viewport, never the larger layout viewport.
    let baseline=viewport.height,width=innerWidth,vwidth=viewport.width,openHeight=0;
    let wasSaving=options.savingMessage;
    let sendPointer:number|undefined;
    let closeHeight=0,closedAt=0,suppressUntil=0,timer:ReturnType<typeof setTimeout>|undefined;
    const armed=()=>phase==='open'||phase==='closing'||phase==='waiting-save';
    const tolerance=()=>Math.max(80,(baseline-openHeight)*.25);
    const valid=()=>Number.isFinite(viewport.height)&&viewport.height>0&&Number.isFinite(viewport.width)&&viewport.width>0&&Number.isFinite(viewport.offsetTop)&&Math.abs(viewport.scale-1)<.02;
    const closed=()=>viewport.height>=baseline-tolerance()&&viewport.height-openHeight>=150;
    const trace=(event:Parameters<typeof recordKeyboardDebug>[0],fields:DebugFields={})=>{
      if(!debug)return;
      recordKeyboardDebug(event,{detector,phase,height:viewport.height,width:viewport.width,offsetTop:viewport.offsetTop,scale:viewport.scale,baseline,openHeight,closeHeight,innerHeight,clientHeight:document.documentElement.clientHeight,armed:armed(),focused:focusSeen,inputFocused:document.activeElement===input.current,saving:latest.current.savingMessage,enabled:latest.current.enabled,blocked:latest.current.blocked,documentFocused:document.hasFocus(),hidden:document.hidden,composing,scopeMatches:scope===latest.current.scope,alive:!disposed,noOverlay:!document.querySelector('[role="dialog"],[role="alertdialog"],dialog[open]'),openFocusPass:focusSeen,openHeightPass:baseline-viewport.height>=Math.max(150,baseline*.2),openThreshold:Math.max(150,baseline*.2),closedMinimum:baseline-tolerance(),closeBaselinePass:viewport.height>=baseline-tolerance(),closeRisePass:viewport.height-openHeight>=150,closeOffsetPass:true,viewportValid:valid(),suppressionRemaining:Math.max(0,suppressUntil-performance.now()),state:armed()?(closed()?'closed':'open'):'unknown',...fields});
    };
    const clear=(reason:DebugFields['reason'])=>{if(timer!==undefined)trace('candidate-cancelled',{reason});clearTimeout(timer);timer=undefined;};
    const reset=(reason:DebugFields['reason'])=>{clear(reason);sendPointer=undefined;phase='idle';focusSeen=false;openHeight=0;closeHeight=0;closedAt=0;acceptedSend=false;trace('reset',{reason});};
    const gate=():DebugFields['reason']|undefined=>{
      if(disposed)return 'cleanup';
      if(!latest.current.enabled)return 'disabled';
      if(document.hidden)return 'gate-hidden';
      if(latest.current.blocked)return 'blocked';
      if(document.querySelector('[role="dialog"],[role="alertdialog"],dialog[open]'))return 'gate-overlay';
      if(composing)return 'gate-composing';
    };
    const sync=()=>{
      if(scope===latest.current.scope)return true;
      // A first local append may lazily create the root while closing/saving.
      if(initial&&!latest.current.initialTimeline&&acceptedSend&&epoch===latest.current.epoch){
        scope=latest.current.scope;initial=false;return true;
      }
      reset('gate-path');scope=latest.current.scope;epoch=latest.current.epoch;initial=latest.current.initialTimeline;return false;
    };
    const pauseComposition=(reason:DebugFields['reason'])=>{
      clear(reason);
      // Pause candidates, not the already observed open keyboard cycle.
      if(armed()){phase='open';closeHeight=0;closedAt=0;}
      trace('composition',{reason});
    };
    function attempt(){
      timer=undefined;
      if(!sync())return;
      const reason=gate();if(reason){if(reason==='gate-composing')pauseComposition(reason);else reset(reason);return;}
      if(!valid()){reset('invalid-viewport');return;}
      // A held send gesture is not evidence of voluntary keyboard dismissal.
      // Resume on release, without polling or changing the input focus.
      if(sendPointer!==undefined){trace('candidate-cancelled',{reason:'send-pointer'});return;}
      if(!closed()){phase='open';closeHeight=0;trace('close-check');return;}
      if(Math.abs(viewport.height-closeHeight)>=24){startClose();return;}
      const remaining=Math.max(400-(performance.now()-closedAt),suppressUntil-performance.now());
      if(remaining>0){timer=setTimeout(attempt,remaining);return;}
      trace('candidate-timer',{attempt:true,heightStable:true,suppressionElapsed:true});
      if(latest.current.savingMessage){phase='waiting-save';trace('reply-check',{reason:'waiting-save'});return;}
      const canReply=latest.current.canReply();trace('reply-check',{canReply,reason:canReply?undefined:'reply-check-failed'});
      // Consume before entering the shared manual path, even if that request fails.
      phase='consumed';acceptedSend=false;trace('reset',{reason:'consumed'});
      if(canReply){trace('reply-requested');latest.current.reply();}
    }
    function startClose(){
      clear('reschedule');phase='closing';closeHeight=viewport.height;closedAt=performance.now();
      const delay=Math.max(400,suppressUntil-performance.now());timer=setTimeout(attempt,delay);
      trace('keyboardClosed');trace('candidate-created',{delay,candidateHeight:closeHeight});
    }
    function sample(event?:Event){
      trace('viewport',{source:event?.type as DebugFields['source']??'setup'});
      if(!sync())return;
      const reason=gate();if(reason){if(reason==='gate-composing')pauseComposition(reason);else reset(reason);return;}
      if(!valid()){reset('invalid-viewport');return;}
      if(Math.abs(innerWidth-width)>2||Math.abs(viewport.width-vwidth)>2){reset('width-changed');width=innerWidth;vwidth=viewport.width;baseline=viewport.height;return;}
      if(!armed()){
        if(focusSeen&&baseline-viewport.height>=Math.max(150,baseline*.2)){
          phase='open';openHeight=viewport.height;trace('keyboardOpen');
        }else if(!focusSeen&&document.activeElement!==input.current)baseline=viewport.height;
        trace('open-check');return;
      }
      if(!closed()){
        clear('not-closed');phase='open';closeHeight=0;openHeight=Math.min(openHeight,viewport.height);trace('close-check');return;
      }
      if(phase==='open'||Math.abs(viewport.height-closeHeight)>=24){startClose();return;}
      if(phase==='waiting-save'&&!latest.current.savingMessage)attempt();
    }
    const focus=(e:FocusEvent)=>{
      trace('focus',{source:'focusin',target:keyboardDebugTarget(e.target,input.current)});
      if(e.target===input.current){focusSeen=true;sample();}else if(e.target!==document.body&&e.target!==document.documentElement)reset('focus-other');
    };
    const blur=(e:FocusEvent)=>{
      if(e.target!==input.current)return;
      trace('blur',{source:'focusout',target:'input',relatedTarget:keyboardDebugTarget(e.relatedTarget,input.current)});
      if(e.relatedTarget===null||e.relatedTarget===document.body||e.relatedTarget===document.documentElement){
        // Never create a close candidate from blur; retain the observed open cycle.
        trace('blur',{reason:'blur-preserved'});return;
      }
      reset('blur-rejected');
    };
    const pointer=(e:PointerEvent)=>{
      trace('pointer',{source:'pointerdown',target:keyboardDebugTarget(e.target,input.current)});
      if(e.target===input.current){focusSeen=true;clear('input-pointer');if(phase==='consumed')phase='idle';sample();return;}
      if(e.target instanceof Element&&e.target.closest('.chat-send')){sendPointer=e.pointerId;clear('send-pointer');if(phase==='closing'||phase==='waiting-save')phase='open';return;}
      // Tapping inert conversation space can be the user's keyboard-dismiss gesture.
      // Controls/navigation still cancel; background alone never creates a candidate.
      if(e.target instanceof Element){
        const control=e.target.closest('.chat-nav,button,a,input,textarea,select,summary,[role="button"],[role="switch"],[role="menuitem"],[role="tab"],[role="dialog"],[role="alertdialog"],[contenteditable="true"],[tabindex]');
        const background=e.target===document.body||e.target===document.documentElement||e.target.matches('.chat-app')||e.target.closest('.chat-view');
        if(background&&!control)return;
      }
      reset('pointer-other');
    };
    const pointerEnd=(e:PointerEvent)=>{
      if(sendPointer!==e.pointerId)return;
      sendPointer=undefined;
      if(e.type==='pointercancel'){reset('send-pointer');return;}
      suppressUntil=performance.now()+600;
      if(armed()&&closed())startClose();
      else sample();
    };
    const compositionStart=()=>{composing=true;pauseComposition('composition-start');};
    const compositionEnd=()=>{composing=false;trace('composition',{reason:'composition-end'});sample();};
    const visibility=(e:Event)=>{if(e.type==='pagehide'||document.hidden)reset(e.type==='pagehide'?'pagehide':'gate-hidden');};
    // iOS can report document/window focus loss for its keyboard UI while visible.
    const windowBlur=()=>{trace('blur',{reason:'window-blur-observed'});if(document.hidden)reset('gate-hidden');};
    const context=(e:Event)=>reset(e.type==='orientationchange'?'orientationchange':'contextmenu');
    const element=input.current;
    viewport.addEventListener('resize',sample);viewport.addEventListener('scroll',sample);
    document.addEventListener('focusin',focus);document.addEventListener('focusout',blur);document.addEventListener('pointerdown',pointer,true);document.addEventListener('pointerup',pointerEnd,true);document.addEventListener('pointercancel',pointerEnd,true);
    element?.addEventListener('compositionstart',compositionStart);element?.addEventListener('compositionend',compositionEnd);
    document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',visibility);window.addEventListener('blur',windowBlur);window.addEventListener('orientationchange',context);document.addEventListener('contextmenu',context,true);
    control.current={cancel:()=>reset('manual-cancel'),send:()=>{acceptedSend=true;suppressUntil=performance.now()+600;trace('send-suppression');},sample:()=>{trace('save-state');if(wasSaving&&!latest.current.savingMessage)trace('save-finished');wasSaving=latest.current.savingMessage;sample();}};
    trace('mounted');sample();
    return()=>{trace('unmounted',{reason:'cleanup'});disposed=true;reset('cleanup');control.current=null;
      viewport.removeEventListener('resize',sample);viewport.removeEventListener('scroll',sample);
      document.removeEventListener('focusin',focus);document.removeEventListener('focusout',blur);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('pointerup',pointerEnd,true);document.removeEventListener('pointercancel',pointerEnd,true);
      element?.removeEventListener('compositionstart',compositionStart);element?.removeEventListener('compositionend',compositionEnd);
      document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',visibility);window.removeEventListener('blur',windowBlur);window.removeEventListener('orientationchange',context);document.removeEventListener('contextmenu',context,true);
    };
  },[options.identity,options.enabled,input]);
  useEffect(()=>{control.current?.sample();},[options.scope,options.blocked,options.savingMessage]);
  return {cancel:()=>control.current?.cancel(),suppressSend:()=>control.current?.send()};
}
