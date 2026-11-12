import {useEffect,useLayoutEffect,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {InterventionNotice} from './interventions';
import './interventionToast.css';
export function InterventionToast({notice,anchor,onDone}:{notice:InterventionNotice;anchor:RefObject<HTMLElement|null>;onDone:()=>void}){
 const [box,setBox]=useState<{left:number;top:number;width:number}|null>(null);
 useLayoutEffect(()=>{
  const measure=()=>{const el=anchor.current;if(!el)return;const rect=el.getBoundingClientRect(),pane=el.closest('.app-scroll')?.getBoundingClientRect()??rect;const width=Math.max(0,Math.min(420,rect.width-24,window.innerWidth-24));setBox({left:Math.max(12,Math.min(window.innerWidth-width-12,rect.left+(rect.width-width)/2)),top:Math.max(8,pane.top+8),width});};
  measure();window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);window.visualViewport?.addEventListener('scroll',measure);
  return()=>{window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('scroll',measure);};
 },[anchor]);
 useEffect(()=>{const timer=setTimeout(onDone,2500);return()=>clearTimeout(timer);},[onDone]);
 if(!box)return null;
 return createPortal(<aside className="phase-intervention-toast" role="status" aria-live="polite" aria-label={`${notice.characterName}：${notice.line} ${notice.effect}`} style={{left:box.left,top:`max(${box.top}px, env(safe-area-inset-top, 0px))`,width:box.width}}><span className="phase-intervention-icon" aria-hidden="true">✧</span><div><p className="phase-intervention-line">{notice.line}</p><p className="phase-intervention-effect">{notice.effect}</p></div></aside>,document.body);
}
