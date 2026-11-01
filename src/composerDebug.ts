import {keyboardDebugEnabled,keyboardDebugTarget,recordKeyboardDebug} from './keyboardDebug';
let nodeSequence=0;
/** Opt-in, memory-only observation. Native attribute calls are forwarded synchronously,
 * recording their leading edge because disabling a focused input can itself fire blur. */
export function observeComposerDebug(){
  if(!keyboardDebugEnabled())return ()=>{};
  let current:HTMLTextAreaElement|null=null,restore=()=>{};
  const fields=()=>({node:nodeSequence,inputFocused:document.activeElement===current,disabled:!!current?.disabled,connected:!!current?.isConnected});
  const attach=()=>{
    const next=document.querySelector<HTMLTextAreaElement>('.chat-compose textarea');
    if(next===current)return;
    if(current){recordKeyboardDebug('input-removed',fields());restore();}
    current=next;if(!next)return;
    nodeSequence++;recordKeyboardDebug('input-mounted',fields());
    const set=next.setAttribute,remove=next.removeAttribute;
    const descriptor=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'disabled')!;
    const previous=['setAttribute','removeAttribute','disabled'].map(k=>Object.getOwnPropertyDescriptor(next,k));
    const changed=(value:boolean)=>{if(next.disabled!==value)recordKeyboardDebug('input-disabled',{...fields(),wasDisabled:next.disabled,disabled:value});};
    next.setAttribute=function(name,value){if(name.toLowerCase()==='disabled')changed(true);return set.call(this,name,value);};
    next.removeAttribute=function(name){if(name.toLowerCase()==='disabled')changed(false);return remove.call(this,name);};
    Object.defineProperty(next,'disabled',{configurable:true,get(){return descriptor.get!.call(this);},set(value){changed(!!value);descriptor.set!.call(this,value);}});
    restore=()=>{['setAttribute','removeAttribute','disabled'].forEach((key,i)=>{if(previous[i])Object.defineProperty(next,key,previous[i]!);else Reflect.deleteProperty(next,key);});};
  };
  const event=(e:Event)=>{
    const target=keyboardDebugTarget(e.target,current);
    if(e.type==='focus'||e.type==='blur'){
      if(e.target===current)recordKeyboardDebug(e.type==='focus'?'input-focus':'input-blur',{...fields(),target,relatedTarget:keyboardDebugTarget((e as FocusEvent).relatedTarget,current)});
    }else if(target==='send')recordKeyboardDebug(e.type==='pointerdown'?'send-pointerdown':e.type==='pointerup'?'send-pointerup':'send-click',{...fields(),target,defaultPrevented:e.defaultPrevented,flow:'ordinary'});
  };
  const types=['pointerdown','pointerup','click','focus','blur'];
  types.forEach(type=>document.addEventListener(type,event,true));
  const observer=new MutationObserver(attach);observer.observe(document.body,{subtree:true,childList:true});attach();
  return()=>{observer.disconnect();types.forEach(type=>document.removeEventListener(type,event,true));if(current)recordKeyboardDebug('input-removed',fields());restore();};
}
