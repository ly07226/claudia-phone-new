import {useEffect} from 'react';
import {liveQuery} from 'dexie';
import {db} from './store';
import {activeMessages} from './messagePath';
import {scanProactiveMessages} from './proactiveMessages';

export function ProactiveScheduler(){
 useEffect(()=>{
  let disposed=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let running=false;
  let queued=false;
  let nextDeadline:number|null=null;
  const clear=()=>{if(timer!==undefined)clearTimeout(timer);timer=undefined;};
  const schedule=()=>{
   clear();
   if(disposed||document.visibilityState!=='visible'||nextDeadline===null)return;
   const delay=Math.max(1000,nextDeadline-Date.now());
   // Browser timers can be clamped. Re-evaluate from persisted timestamps on foreground.
   timer=setTimeout(()=>{timer=undefined;void check();},delay);
  };
  const check=async()=>{
   if(disposed||document.visibilityState!=='visible'||!navigator.onLine)return;
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
  const fallback=setInterval(foreground,60000);
  void check();
  return()=>{
   clearInterval(fallback);
   disposed=true;clear();subscription.unsubscribe();
   document.removeEventListener('visibilitychange',foreground);
   window.removeEventListener('focus',foreground);
  };
 },[]);
 return null;
}
