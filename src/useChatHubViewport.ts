import {useLayoutEffect,useRef} from 'react';
/** Size only the hub inside its existing phone slot; never resize/scale the phone or document. */
export function useChatHubViewport(){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const root=ref.current,parent=root?.parentElement;if(!root||!parent)return;
  let frame=0,focusFrame=0;const viewport=window.visualViewport;
  const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   if(viewport&&Math.abs(viewport.scale-1)>.02)return;
   const bounds=parent.getBoundingClientRect(),bottom=viewport?viewport.offsetTop+viewport.height:innerHeight;
   root.style.height=Math.max(0,Math.min(parent.clientHeight,bottom-bounds.top))+'px';
   cancelAnimationFrame(focusFrame);focusFrame=requestAnimationFrame(()=>{
    const focused=document.activeElement;if(!(focused instanceof HTMLElement)||!root.contains(focused)||!focused.matches('input,textarea,select'))return;
    const panel=focused.closest<HTMLElement>('[role=tabpanel]');if(!panel)return;
    const input=focused.getBoundingClientRect(),area=panel.getBoundingClientRect();
    if(input.bottom>area.bottom-8)panel.scrollTop+=input.bottom-area.bottom+8;
    else if(input.top<area.top+8)panel.scrollTop-=area.top-input.top+8;
   });
  });};
  const observer=new ResizeObserver(measure);observer.observe(parent);measure();
  window.addEventListener('resize',measure);window.addEventListener('orientationchange',measure);viewport?.addEventListener('resize',measure);viewport?.addEventListener('scroll',measure);root.addEventListener('focusin',measure);
  return()=>{observer.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(focusFrame);window.removeEventListener('resize',measure);window.removeEventListener('orientationchange',measure);viewport?.removeEventListener('resize',measure);viewport?.removeEventListener('scroll',measure);root.removeEventListener('focusin',measure);};
 },[]);
 return ref;
}
