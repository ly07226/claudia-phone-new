import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {useSpaces} from './spaces';
import {usePhone} from './store';
import {openPhoneApp} from './phonePageNavigation';
import {scanProactiveMessages,proactiveEvent,type ProactiveNotice} from './proactiveMessages';
import './proactiveToast.css';

let pendingOpen:string|undefined;
export function takeProactiveOpen(){const id=pendingOpen;pendingOpen=undefined;return id;}
export function ProactiveScheduler(){
 const route=useSpaces(s=>s.route);
 const [queue,setQueue]=useState<ProactiveNotice[]>([]);
 const [current,setCurrent]=useState<ProactiveNotice|null>(null);
 const [leaving,setLeaving]=useState(false);
 useEffect(()=>{
  if(route.screen!=='phone'||route.spaceId!=='daily')return;
  const check=()=>{if(document.visibilityState==='visible')void scanProactiveMessages().catch(()=>{});};
  check();const interval=setInterval(check,30000);
  document.addEventListener('visibilitychange',check);
  return()=>{clearInterval(interval);document.removeEventListener('visibilitychange',check);};
 },[route]);
 useEffect(()=>{
  const onNotice=(e:Event)=>{const notice=(e as CustomEvent<ProactiveNotice>).detail;if(notice?.conversationId)setQueue(q=>[...q,notice].slice(-10));};
  window.addEventListener(proactiveEvent,onNotice);
  return()=>window.removeEventListener(proactiveEvent,onNotice);
 },[]);
 useEffect(()=>{if(!current&&queue.length){setCurrent(queue[0]);setQueue(q=>q.slice(1));setLeaving(false);}},[current,queue]);
 useEffect(()=>{if(!current)return;const out=setTimeout(()=>setLeaving(true),5000);const done=setTimeout(()=>{setCurrent(null);setLeaving(false);},5350);return()=>{clearTimeout(out);clearTimeout(done);};},[current]);
 function open(){if(!current)return;pendingOpen=current.characterId;const phone=usePhone.getState();if(phone.activeApp!=='聊天')openPhoneApp('聊天');window.dispatchEvent(new Event('claudia:open-proactive-chat'));setCurrent(null);setLeaving(false);}
 if(!current||route.screen!=='phone'||route.spaceId!=='daily')return null;
 return createPortal(<div className="claudia-proactive-layer" aria-live="polite"><button type="button" className={'claudia-proactive-toast'+(leaving?' is-leaving':'')} onClick={open} aria-label={current.name+'发来新消息，点击打开聊天'}><span className="claudia-proactive-avatar">{current.avatar?<Avatar id={current.avatar}/>:current.name.slice(0,1)}</span><span className="claudia-proactive-content"><span className="claudia-proactive-heading"><strong>{current.name}</strong><small>现在</small></span><span className="claudia-proactive-preview">{current.text}</span></span></button></div>,document.body);
}
function Avatar({id}:{id:string}){const asset=usePhone(s=>s.assets.find(a=>a.id===id));return asset?.data?<img src={asset.data} alt="" />:null;}
