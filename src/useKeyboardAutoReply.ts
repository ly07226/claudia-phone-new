import {useEffect,useRef,type RefObject} from 'react';

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
  useEffect(()=>{
    // Only lazy creation of the first root may retain the already-focused editor.
    // A real path/overlay change requires a fresh input interaction before arming.
    const initializingRoot=initialRoot.current===options.conversationId&&!options.initialTimeline;
    initialRoot.current=options.initialTimeline?options.conversationId:undefined;
    const viewport=window.visualViewport;
    if(!options.enabled||options.blocked||!viewport||navigator.maxTouchPoints<1||!matchMedia('(pointer: coarse)').matches)return;
    const scope=options.scope;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let armed=false,focused=initializingRoot&&document.activeElement===input.current,composing=false,disposed=false;
    let baseline=Math.max(innerHeight,document.documentElement.clientHeight,viewport.height);
    let width=innerWidth,viewportWidth=viewport.width,openHeight=0;
    const clear=()=>{clearTimeout(timer);timer=undefined;};
    const reset=()=>{clear();armed=false;focused=false;openHeight=0;savedWithFocus.current=false;};
    cancelRef.current=reset;
    saveFinished.current=()=>{savedWithFocus.current=document.activeElement===input.current;};
    const valid=()=>Number.isFinite(viewport.height)&&viewport.height>0&&Number.isFinite(viewport.offsetTop)&&viewport.offsetTop>=0&&Math.abs(viewport.scale-1)<.02;
    const allowed=()=>!disposed&&latest.current.scope===scope&&latest.current.enabled&&!latest.current.blocked&&!document.hidden&&document.hasFocus()&&!composing&&!document.querySelector('[role="dialog"],[role="alertdialog"],dialog[open]');
    const closed=()=>viewport.height>=baseline-80&&viewport.height-openHeight>=150&&viewport.offsetTop<=40;
    const update=()=>{
      if(!allowed()||!valid()){reset();return;}
      if(Math.abs(innerWidth-width)>2||Math.abs(viewport.width-viewportWidth)>2){
        reset();width=innerWidth;viewportWidth=viewport.width;baseline=Math.max(innerHeight,document.documentElement.clientHeight,viewport.height);return;
      }
      const inputFocused=document.activeElement===input.current;
      if(!armed){
        if(focused&&inputFocused&&baseline-viewport.height>=Math.max(150,baseline*.2)){
          armed=true;openHeight=viewport.height;
        }else if(!inputFocused)baseline=Math.max(innerHeight,document.documentElement.clientHeight,viewport.height);
        return;
      }
      if(!closed()){clear();return;}
      clear();const height=viewport.height;
      timer=setTimeout(()=>{
        timer=undefined;
        const attempt=armed&&allowed()&&valid()&&closed()&&Math.abs(viewport.height-height)<24&&performance.now()>=suppressUntil.current;
        // Consume this open/close cycle before requesting anything, including failure.
        reset();
        if(attempt&&latest.current.canReply())latest.current.reply();
      },Math.max(400,suppressUntil.current-performance.now()));
    };
    const focus=(e:FocusEvent)=>{if(e.target===input.current){focused=true;update();}else reset();};
    // A recent save that demonstrably retained focus may be followed by iOS Done.
    // Preserve only that no-target blur; it never starts the close timer itself.
    // A button focus transfer or blur during the save is still rejected. A script
    // producing identical no-target blur + geometry remains indistinguishable.
    const blur=(e:FocusEvent)=>{
      if(e.target!==input.current)return;
      if(e.relatedTarget===null&&savedWithFocus.current&&!latest.current.savingMessage&&performance.now()<suppressUntil.current&&armed&&allowed())return;
      reset();
    };
    const pointer=(e:PointerEvent)=>{
      if(e.target===input.current){clear();focused=true;update();return;}
      if(e.target instanceof Element&&e.target.closest('.chat-send')){clear();savedWithFocus.current=false;suppressUntil.current=performance.now()+600;return;}
      reset();
    };
    const compositionStart=()=>{composing=true;reset();};
    const compositionEnd=()=>{composing=false;reset();};
    const visibility=()=>reset();
    const context=()=>reset();
    viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);
    document.addEventListener('focusin',focus);document.addEventListener('focusout',blur);
    document.addEventListener('pointerdown',pointer,true);
    input.current?.addEventListener('compositionstart',compositionStart);input.current?.addEventListener('compositionend',compositionEnd);
    document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',visibility);window.addEventListener('blur',visibility);window.addEventListener('orientationchange',context);document.addEventListener('contextmenu',context,true);
    const element=input.current;
    update();
    return()=>{
      disposed=true;reset();cancelRef.current=()=>{};saveFinished.current=()=>{};
      viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);
      document.removeEventListener('focusin',focus);document.removeEventListener('focusout',blur);document.removeEventListener('pointerdown',pointer,true);
      element?.removeEventListener('compositionstart',compositionStart);element?.removeEventListener('compositionend',compositionEnd);
      document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',visibility);window.removeEventListener('blur',visibility);window.removeEventListener('orientationchange',context);document.removeEventListener('contextmenu',context,true);
    };
  },[options.scope,options.enabled,options.blocked,input]);
  useEffect(()=>{
    if(previousSaving.current&&!options.savingMessage)saveFinished.current();
    previousSaving.current=options.savingMessage;
  },[options.savingMessage]);
  return {
    cancel:()=>cancelRef.current(),
    suppressSend:()=>{savedWithFocus.current=false;suppressUntil.current=performance.now()+600;},
  };
}
