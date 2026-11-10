import {noteViewportDecision} from './viewportDiagnostics';
import './chatViewport.css';
import {displayEnvironment} from './presentation';
const closedViewports=new WeakMap<HTMLElement,{height:number;width:number;keyboard:boolean;standalone:boolean}>();
/** Geometry only. Never persists data, changes focus, or scrolls the document. */
export function readChatViewport(scope:HTMLElement){
 const viewport=window.visualViewport;
 if(viewport&&Math.abs(viewport.scale-1)>.02)return null;
 const layoutHeight=window.innerHeight,standalone=displayEnvironment().standalone;
 const focused=document.activeElement;
 const editing=focused instanceof HTMLElement&&scope.contains(focused)&&focused.matches('input,textarea,select');
 const visibleHeight=viewport?.height||layoutHeight;
 // Learn the visible pre-focus baseline; browser chrome can make it smaller
 // than innerHeight even without a keyboard. Never call that difference keyboard height.
 let closed=closedViewports.get(scope);
 if(!closed||closed.standalone!==standalone)closed={height:visibleHeight,width:innerWidth,keyboard:false,standalone};
 // During standalone rotation, CSS/layout may settle before innerHeight or keyboard events.
 else if(closed.width!==innerWidth)closed={height:editing?Math.max(visibleHeight,layoutHeight,standalone?document.documentElement.clientHeight:0):visibleHeight,width:innerWidth,keyboard:closed.keyboard,standalone};
 // A blur may precede the keyboard's closing animation. Retain a confirmed
 // keyboard frame until its geometry recovers, without scrolling or refocusing.
 const reduced=closed.height-visibleHeight>Math.max(100,closed.height*.15);
 const keyboard=(editing||closed.keyboard)&&reduced;
 if(!editing&&!keyboard)closed.height=visibleHeight;
 closed.keyboard=keyboard;closedViewports.set(scope,closed);
 // A panned viewport's offset is a coordinate, not another height deduction.
 const top=keyboard?Math.max(0,viewport?.offsetTop||0):0;
 const height=keyboard?visibleHeight:layoutHeight;
 // In standalone there is no Safari toolbar to reserve. Let CSS own the
 // closed viewport: an early/stale innerHeight must not pin a shorter px shell.
 const cssHeight=!keyboard&&standalone?(CSS.supports('height','100dvh')?'100dvh':'100vh'):`${height}px`;
 noteViewportDecision({scope:scope.matches('[data-chat-hub]')?'hub':'conversation',innerHeight:layoutHeight,visibleHeight,baseline:closed.height,keyboard,standalone,top,height,cssHeight});
 return {top,height,bottom:top+height,keyboard,standalone,cssHeight};
}
const listeners=new Set<()=>void>();
let release:(()=>void)|undefined;
/** One event subscription and one scheduled frame shared by chat's current view. */
export function watchChatViewport(sync:()=>void){
 listeners.add(sync);
 if(!release){
  let frame=0;const viewport=window.visualViewport,media=matchMedia('(display-mode: standalone)');
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;listeners.forEach(fn=>fn());});};
  const foreground=()=>{if(!document.hidden)schedule();};
  document.addEventListener('visibilitychange',foreground);
  if(media.addEventListener)media.addEventListener('change',schedule);else media.addListener(schedule);
  window.addEventListener('resize',schedule);window.addEventListener('orientationchange',schedule);window.addEventListener('pageshow',schedule);
  viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
  release=()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',foreground);if(media.removeEventListener)media.removeEventListener('change',schedule);else media.removeListener(schedule);window.removeEventListener('resize',schedule);window.removeEventListener('orientationchange',schedule);window.removeEventListener('pageshow',schedule);viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);};
 }
 sync();
 return ()=>{listeners.delete(sync);if(!listeners.size){release?.();release=undefined;}};
}
export function setChatViewportValue(el:HTMLElement|undefined|null,name:string,value:string){if(el&&el.style.getPropertyValue(name)!==value)el.style.setProperty(name,value);}
