import {useEffect,useRef,useState} from 'react';
/** Local to the story App; never changes chat viewport, focus or document scrolling. */
export function useStoryViewport(){
 const ref=useRef<HTMLElement>(null),[height,setHeight]=useState<number>();
 useEffect(()=>{
  const root=ref.current,parent=root?.parentElement;if(!root||!parent)return;
  let frame=0;
  const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   const viewport=window.visualViewport,top=root.getBoundingClientRect().top;
   const bottom=viewport?viewport.height+viewport.offsetTop:window.innerHeight;
   const available=Math.max(0,Math.min(parent.clientHeight,bottom-top));setHeight(available);
  });};
  const resize=new ResizeObserver(measure);resize.observe(parent);window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);window.visualViewport?.addEventListener('scroll',measure);measure();
  return()=>{resize.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('scroll',measure);};
 },[]);
 return {ref,height};
}
