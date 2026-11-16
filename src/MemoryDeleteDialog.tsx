import {useId,useLayoutEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
/** Top-layer portal avoids fixed-position containing blocks created by the phone's
 * backdrop-filter/animation. Native modality blocks background clicks and focus.
 */
export function MemoryDeleteDialog({busy,error,onCancel,onConfirm,titleText='删除这条记忆？',confirmText='确认删除'}:{busy:boolean;error:string;titleText?:string;confirmText?:string;onCancel:()=>void;onConfirm:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),title=useId();
 useLayoutEffect(()=>{
  const element=dialog.current!,viewport=window.visualViewport;
  const position=()=>{
   const width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
   element.style.left=`${(viewport?.offsetLeft??0)+width/2}px`;
   element.style.top=`${(viewport?.offsetTop??0)+height/2}px`;
   element.style.maxWidth=`${Math.max(0,width-32)}px`;
   element.style.maxHeight=`${Math.max(0,height-32)}px`;
  };
  position();element.showModal();cancel.current?.focus({preventScroll:true});
  viewport?.addEventListener('resize',position);viewport?.addEventListener('scroll',position);window.addEventListener('resize',position);
  return()=>{viewport?.removeEventListener('resize',position);viewport?.removeEventListener('scroll',position);window.removeEventListener('resize',position);element.close();};
 },[]);
 return createPortal(<dialog ref={dialog} className="memory-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby={title} aria-busy={busy} onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}>
  <h3 id={title}>{titleText}</h3>
  {error&&<p role="alert">{error}</p>}
  <div className="memory-delete-buttons"><button type="button" ref={cancel} disabled={busy} onClick={onCancel}>取消</button><button type="button" className="memory-delete-confirm" disabled={busy} onClick={onConfirm}>{confirmText}</button></div>
 </dialog>,document.body);
}
