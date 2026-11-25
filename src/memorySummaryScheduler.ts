import {acquireAutomationScheduler} from './automationSchedulerLease';
import {enqueueCoreMemory} from './memoryCoreBuilder';
import {getMemoryScope} from './memoryStore';
import {db} from './store';
import {tryAutoSummary} from './memorySummary';

/** Foreground-only recovery for interrupted PWA summary work.
 * Periodic sweep plus foreground/network wake; no iOS background promises.
 * The summary engine owns per-conversation locking, checkpoints and retries.
 */
function startScheduler(){
 let running=false,stopped=false,queued=false;
 const scan=async()=>{
  if(stopped||running||document.hidden||!navigator.onLine)return;
  running=true;
  try{
   const conversations=await db.conversations.toArray();
   for(const c of conversations){
    if(stopped||document.hidden||!navigator.onLine)break;
    if(!c.memorySummary?.enabled)continue;
    // Never block normal chat or wait for a remote request in this scan.
    await tryAutoSummary(c.id,()=>!stopped).catch(()=>{});
    if((c.memorySummary?.receipts.length??0)>=5)void enqueueCoreMemory(await getMemoryScope(c.id),()=>!stopped);
   }
  }catch{/* Keep chat functional if local storage is unavailable. */}
  finally{running=false;if(queued&&!stopped){queued=false;wake();}}
 };
 const wake=()=>{if(running){queued=true;return;}void scan();};
 const timer=setInterval(wake,60000);
 window.addEventListener('online',wake);
 window.addEventListener('pageshow',wake);
 document.addEventListener('visibilitychange',wake);
 wake();
 return {wake,stop:()=>{stopped=true;clearInterval(timer);window.removeEventListener('online',wake);window.removeEventListener('pageshow',wake);document.removeEventListener('visibilitychange',wake);}};
}

export function installMemorySummaryScheduler(){return acquireAutomationScheduler('memory',startScheduler);}
