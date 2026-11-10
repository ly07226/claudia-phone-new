import {readChatViewport,watchChatViewport,setChatViewportValue} from './chatViewport';
import {useLayoutEffect,useRef} from 'react';
/** Keep the chat phone slot and its content on the shared viewport baseline. */
export function useChatHubViewport(){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const root=ref.current,parent=root?.parentElement;if(!root||!parent)return;
  const phone=root.closest<HTMLElement>('.phone'),stage=phone?.closest<HTMLElement>('.stage');let focusFrame=0;
  const sync=()=>{
   const frame=readChatViewport(root);if(!frame)return;
   // The same frame drives the phone and its child, never a shorter child in a tall shell.
   setChatViewportValue(stage,'--chat-shell-height',frame.keyboard?`${frame.bottom}px`:frame.cssHeight);
   root.toggleAttribute('data-chat-keyboard',frame.keyboard);
   const height='100%';if(root.style.height!==height)root.style.height=height;
   cancelAnimationFrame(focusFrame);focusFrame=requestAnimationFrame(()=>{
    const focused=document.activeElement;if(!(focused instanceof HTMLElement)||!root.contains(focused)||!focused.matches('input,textarea,select'))return;
    const panel=focused.closest<HTMLElement>('[role=tabpanel]');if(!panel)return;
    const input=focused.getBoundingClientRect(),area=panel.getBoundingClientRect();
    if(input.bottom>area.bottom-8)panel.scrollTop+=input.bottom-area.bottom+8;
    else if(input.top<area.top+8)panel.scrollTop-=area.top-input.top+8;
   });
  };
  const stop=watchChatViewport(sync);
  const observer=new ResizeObserver(sync);observer.observe(parent);
  return()=>{stop();observer.disconnect();cancelAnimationFrame(focusFrame);stage?.style.removeProperty('--chat-shell-height');root.style.removeProperty('height');root.removeAttribute('data-chat-keyboard');};
 },[]);
 return ref;
}
