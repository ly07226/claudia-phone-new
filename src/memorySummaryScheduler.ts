import {db} from './store';
import {tryAutoSummary} from './memorySummary';

/** Foreground-only recovery for interrupted PWA summary work.
 * No polling and no background execution promises on iOS.
 * The summary engine owns per-conversation locking, checkpoints and retries.
 */
export function installMemorySummaryScheduler(){
 let running=false;
 const scan=async()=>{
  if(running||document.hidden||!navigator.onLine)return;
  running=true;
  try{
   const conversations=await db.conversations.toArray();
   for(const c of conversations){
    if(document.hidden||!navigator.onLine)break;
    if(!c.memorySummary?.enabled)continue;
    // Never block normal chat or wait for a remote request in this scan.
    await tryAutoSummary(c.id).catch(()=>{});
   }
  }catch{/* Keep chat functional if local storage is unavailable. */}
  finally{running=false;}
 };
 const wake=()=>{void scan();};
 window.addEventListener('online',wake);
 window.addEventListener('pageshow',wake);
 document.addEventListener('visibilitychange',wake);
 void scan();
 return ()=>{window.removeEventListener('online',wake);window.removeEventListener('pageshow',wake);document.removeEventListener('visibilitychange',wake);};
}
