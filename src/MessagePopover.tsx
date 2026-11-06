import {useLayoutEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import type {BubblePart} from './messageBubbles';
import './messageActions.css';
export interface MessageSelection {part:BubblePart;anchor:HTMLElement}
export function menuPosition(anchor:{left:number;right:number;top:number;bottom:number},view:{left:number;top:number;width:number;height:number},height:number,footerTop:number){
 const width=Math.min(240,view.width-24),top=view.top+8,bottom=Math.max(top+60,Math.min(view.top+view.height-8,footerTop-8));
 const maxHeight=Math.max(60,bottom-top),h=Math.min(height,maxHeight);
 const y=anchor.bottom+10+h<=bottom?anchor.bottom+10:anchor.top-10-h>=top?anchor.top-10-h:Math.max(top,Math.min(bottom-h,anchor.top-h-10));
 return {left:Math.max(view.left+12,Math.min(view.left+view.width-width-12,anchor.left)),top:y,width,maxHeight};
}
/** The inverse clip leaves the actual selected DOM bubble clear: no cloned message. */
export function MessagePopover({anchor,onClose,children}:{anchor:HTMLElement;onClose:()=>void;children:React.ReactNode}){
 const backdropDown=useRef(false);
 const root=useRef<HTMLDivElement>(null),menu=useRef<HTMLElement>(null),shade=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
 useLayoutEffect(()=>{
  const prior=document.activeElement as HTMLElement|null,viewport=window.visualViewport;
  const measure=()=>{
   if(!anchor.isConnected){close.current();return;}
   const view={left:viewport?.offsetLeft||0,top:viewport?.offsetTop||0,width:viewport?.width||innerWidth,height:viewport?.height||innerHeight};
   const box=anchor.getBoundingClientRect(),historyBox=anchor.closest('.chat-history')?.getBoundingClientRect();
   const footer=document.querySelector('.chat-footer')?.getBoundingClientRect();
   const position=menuPosition(box,view,menu.current?.scrollHeight||240,footer?.top??view.top+view.height);
   Object.assign(root.current!.style,{left:`${view.left}px`,top:`${view.top}px`,width:`${view.width}px`,height:`${view.height}px`});
   Object.assign(menu.current!.style,{left:`${position.left-view.left}px`,top:`${position.top-view.top}px`,width:`${position.width}px`,maxHeight:`${position.maxHeight}px`});
   const l=Math.max(box.left,view.left,historyBox?.left??view.left)-view.left,r=Math.min(box.right,view.left+view.width,historyBox?.right??view.left+view.width)-view.left;
   const t=Math.max(box.top,view.top,historyBox?.top??view.top)-view.top,b=Math.min(box.bottom,view.top+view.height,historyBox?.bottom??view.top+view.height)-view.top;
   if(r<=l||b<=t){close.current();return;}
   const radius=Math.min(parseFloat(getComputedStyle(anchor.querySelector('img')||anchor).borderTopLeftRadius)||0,(r-l)/2,(b-t)/2);
   shade.current!.style.clipPath=`path(evenodd, "M0 0H${view.width}V${view.height}H0Z M${l+radius} ${t}H${r-radius}Q${r} ${t} ${r} ${t+radius}V${b-radius}Q${r} ${b} ${r-radius} ${b}H${l+radius}Q${l} ${b} ${l} ${b-radius}V${t+radius}Q${l} ${t} ${l+radius} ${t}Z")`;
  };
  const observer=new ResizeObserver(measure);if(menu.current)observer.observe(menu.current);
  measure();viewport?.addEventListener('resize',measure);viewport?.addEventListener('scroll',measure);window.addEventListener('resize',measure);document.addEventListener('scroll',measure,true);
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close.current();}if(event.key==='Tab'){
   const buttons=[...menu.current!.querySelectorAll<HTMLButtonElement>('button:not([disabled])')],first=buttons[0],last=buttons.at(-1);
   if(!menu.current?.contains(document.activeElement)){event.preventDefault();first?.focus({preventScroll:true});}
   else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus({preventScroll:true});}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus({preventScroll:true});}
  }};
  document.addEventListener('keydown',escape);
  if(prior?.classList.contains('message-access'))menu.current?.querySelector('button')?.focus({preventScroll:true});
  const token=crypto.randomUUID();let pushed=false;
  try{history.pushState({...history.state,claudiaMessageMenu:token},'',location.href);pushed=true;}catch{/* Dismissal remains available without browser history. */}
  const back=()=>close.current();window.addEventListener('popstate',back);
  return()=>{observer.disconnect();viewport?.removeEventListener('resize',measure);viewport?.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);document.removeEventListener('scroll',measure,true);document.removeEventListener('keydown',escape);window.removeEventListener('popstate',back);
   if(pushed&&window.history.state?.claudiaMessageMenu===token)window.history.back();
   // Never force the composer to focus/reopen a soft keyboard on dismissal.
   if(prior?.isConnected&&prior.classList.contains('message-access'))prior.focus({preventScroll:true});
  };
 },[anchor]);

 return createPortal(<div ref={root} className="message-backdrop message-popover-backdrop" onPointerDown={e=>{backdropDown.current=e.target===e.currentTarget;}} onPointerCancel={()=>{backdropDown.current=false;}} onClick={e=>{if(backdropDown.current&&e.target===e.currentTarget)close.current();backdropDown.current=false;}}><div ref={shade} className="message-popover-shade" aria-hidden="true"/><section ref={menu} className="message-popover" role="dialog" aria-modal="true" aria-label="消息操作">{children}</section></div>,document.body);
}
