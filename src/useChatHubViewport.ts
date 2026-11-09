import {useLayoutEffect,useRef} from 'react';
/** Size only the hub inside its existing phone slot; never resize/scale the phone or document. */
export function useChatHubViewport(){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const root=ref.current,parent=root?.parentElement;if(!root||!parent)return;
  let frame=0,focusFrame=0;const viewport=window.visualViewport;
  const sync=()=>{
   if(viewport&&Math.abs(viewport.scale-1)>.02)return;
   const bounds=parent.getBoundingClientRect(),bottom=viewport?viewport.offsetTop+viewport.height:innerHeight;
   // The phone slot owns the resting height and the footer owns its single safe-area inset.
   // Safari can retain a smaller visualViewport after dismissing the keyboard; do not
   // freeze that transient size into the hub when there is no focused editor.
   const focused=document.activeElement;
   const editing=focused instanceof HTMLElement&&root.contains(focused)&&focused.matches('input,textarea,select');
   const keyboard=editing&&bounds.bottom-bottom>100;
   const height=keyboard?Math.max(0,Math.min(parent.clientHeight,bottom-bounds.top))+'px':'100%';
   if(root.style.height!==height)root.style.height=height;
   cancelAnimationFrame(focusFrame);focusFrame=requestAnimationFrame(()=>{
    const focused=document.activeElement;if(!(focused instanceof HTMLElement)||!root.contains(focused)||!focused.matches('input,textarea,select'))return;
    const panel=focused.closest<HTMLElement>('[role=tabpanel]');if(!panel)return;
    const input=focused.getBoundingClientRect(),area=panel.getBoundingClientRect();
    if(input.bottom>area.bottom-8)panel.scrollTop+=input.bottom-area.bottom+8;
    else if(input.top<area.top+8)panel.scrollTop-=area.top-input.top+8;
   });
  };
  const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(sync);};
  // Sync before the first paint; later viewport/slot changes are coalesced per event.
  const observer=new ResizeObserver(measure);observer.observe(parent);sync();
  window.addEventListener('resize',measure);window.addEventListener('orientationchange',measure);viewport?.addEventListener('resize',measure);viewport?.addEventListener('scroll',measure);root.addEventListener('focusin',measure);root.addEventListener('focusout',measure);window.addEventListener('pageshow',measure);
  return()=>{observer.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(focusFrame);window.removeEventListener('resize',measure);window.removeEventListener('orientationchange',measure);viewport?.removeEventListener('resize',measure);viewport?.removeEventListener('scroll',measure);root.removeEventListener('focusin',measure);root.removeEventListener('focusout',measure);window.removeEventListener('pageshow',measure);};
 },[]);
 return ref;
}
