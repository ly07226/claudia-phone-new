import {useEffect,useState} from 'react';
import {liveQuery} from 'dexie';
import {db} from './store';
import {activeMessages} from './messagePath';
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
  let disposed=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let running=false;
  let queued=false;
  let nextDeadline:number|null=null;
  const clear=()=>{if(timer!==undefined)clearTimeout(timer);timer=undefined;};
  const schedule=()=>{
   clear();
   if(disposed||document.visibilityState!=='visible'||nextDeadline===null)return;
   const delay=Math.max(0,nextDeadline-Date.now());
   // Browser timers can be clamped. Re-evaluate from persisted timestamps on foreground.
   timer=setTimeout(()=>{timer=undefined;void check();},delay);
  };
  const check=async()=>{
   if(disposed||document.visibilityState!=='visible')return;
   if(running){queued=true;return;}
   running=true;
   try{await scanProactiveMessages();}catch{/* Automatic sends are silent; manual tests surface errors. */}
   finally{running=false;if(queued){queued=false;void check();}else schedule();}
  };
  const subscription=liveQuery(async()=>{
   const conversations=await db.conversations.toArray();
   let earliest:number|null=null;
   for(const c of conversations){
    const settings=c.chatSettings;
    if(c.mode!=='daily'||c.worldId||!settings?.proactiveEnabled)continue;
    const hours=settings.proactiveHours??3;
    if(!Number.isFinite(hours)||hours<0.5||hours>24)continue;
    const messages=await activeMessages(c.id);
    const lastUser=[...messages].reverse().find(m=>m.role==='user')?.createdAt??0;
    const anchor=Math.max(c.createdAt,settings.proactiveEnabledAt??c.createdAt,lastUser);
    if(settings.proactiveAttemptFor===anchor)continue;
    const deadline=Math.max(anchor+hours*3600000,c.sendingUntil??0);
    earliest=earliest===null?deadline:Math.min(earliest,deadline);
   }
   return earliest;
  }).subscribe({
   next:deadline=>{
    if(disposed)return;
    nextDeadline=deadline;
    if(document.visibilityState!=='visible'){clear();return;}
    if(deadline!==null&&deadline<=Date.now())void check();
    else schedule();
   },
   error:()=>{nextDeadline=null;clear();}
  });
  const foreground=()=>{
   if(document.visibilityState!=='visible'){clear();return;}
   void check();
  };
  document.addEventListener('visibilitychange',foreground);
  window.addEventListener('focus',foreground);
  // Initial and resumed scans use persisted timestamps; no fixed polling.
  void check();
  return()=>{
   disposed=true;clear();subscription.unsubscribe();
   document.removeEventListener('visibilitychange',foreground);
   window.removeEventListener('focus',foreground);
  };
 },[route.screen,route.spaceId]);
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
