import './chatViewport.css';
const closedViewports=new WeakMap<HTMLElement,{height:number;width:number;editing:boolean}>();
/** Geometry only. Never persists data, changes focus, or scrolls the document. */
export function readChatViewport(scope:HTMLElement){
 const viewport=window.visualViewport;
 if(viewport&&Math.abs(viewport.scale-1)>.02)return null;
 const layoutHeight=window.innerHeight;
 const focused=document.activeElement;
 const editing=focused instanceof HTMLElement&&scope.contains(focused)&&focused.matches('input,textarea,select');
 const visibleHeight=viewport?.height||layoutHeight;
 // Learn the visible pre-focus baseline; browser chrome can make it smaller
 // than innerHeight even without a keyboard. Never call that difference keyboard height.
 let closed=closedViewports.get(scope);
 if(!closed||closed.width!==innerWidth)closed={height:visibleHeight,width:innerWidth,editing:false};
 if(!editing){closed.height=visibleHeight;closed.editing=false;}
 const keyboard=editing&&closed.height-visibleHeight>Math.max(100,closed.height*.15);
 closed.editing=editing;closedViewports.set(scope,closed);
 // A panned viewport's offset is a coordinate, not another height deduction.
 const top=keyboard?Math.max(0,viewport?.offsetTop||0):0;
 const height=keyboard?visibleHeight:layoutHeight;
 return {top,height,bottom:top+height,keyboard};
}
const listeners=new Set<()=>void>();
let release:(()=>void)|undefined;
/** One event subscription and one scheduled frame shared by chat's current view. */
export function watchChatViewport(sync:()=>void){
 listeners.add(sync);
 if(!release){
  let frame=0;const viewport=window.visualViewport;
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;listeners.forEach(fn=>fn());});};
  window.addEventListener('resize',schedule);window.addEventListener('orientationchange',schedule);window.addEventListener('pageshow',schedule);
  viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
  release=()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('orientationchange',schedule);window.removeEventListener('pageshow',schedule);viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);};
 }
 sync();
 return ()=>{listeners.delete(sync);if(!listeners.size){release?.();release=undefined;}};
}
export function setChatViewportValue(el:HTMLElement|undefined|null,name:string,value:string){if(el&&el.style.getPropertyValue(name)!==value)el.style.setProperty(name,value);}
