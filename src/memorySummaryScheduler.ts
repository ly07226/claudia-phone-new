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
 // Only schedule core-memory consolidation when the receipt identity changes.
 // A periodic foreground wake must not enqueue the same work every minute.
 const lastCoreReceiptSignature=new Map<string,string>();
 const scan=async()=>{
  if(stopped||running||document.hidden||!navigator.onLine)return;
  running=true;
  try{
   const conversations=await db.conversations.toArray();
   for(const c of conversations){
    if(stopped||document.hidden||!navigator.onLine)break;
    if(!c.memorySummary?.enabled)continue;
    // Launch eligible work without serially blocking the sweep on one chat.
    // The summary engine owns per-conversation exclusion and persistence.
    void tryAutoSummary(c.id,()=>!stopped).catch(()=>{});
    const receipts=c.memorySummary?.receipts??[];
    // A receipt can be replaced after regeneration without changing the count.
    // Use persisted receipt IDs rather than a count to avoid missing updates.
    const receiptSignature=receipts.map(receipt=>`${receipt.id}:${receipt.revision}:${receipt.sourceFingerprint??''}`).join('|');
    if(receipts.length>=5 && lastCoreReceiptSignature.get(c.id)!==receiptSignature){
      lastCoreReceiptSignature.set(c.id,receiptSignature);
      void getMemoryScope(c.id).then(scope=>enqueueCoreMemory(scope,()=>!stopped)).catch(()=>{
        lastCoreReceiptSignature.delete(c.id);
      });
    }
   }
  }catch{/* Keep chat functional if local storage is unavailable. */}
  finally{running=false;if(queued&&!stopped){queued=false;wake();}}
 };
 const wake=()=>{if(running){queued=true;return;}void scan();};
 // Event-driven wake: a completed AI reply should be eligible immediately.
 // Periodic scan remains a fallback for restored foreground sessions.
 const onReplyCommitted=(event:Event)=>{
  const id=(event as CustomEvent<{conversationId?:string}>).detail?.conversationId;
  // Only inspect the conversation whose reply was committed. The periodic
  // foreground sweep still catches interrupted or previously pending work.
  if(id&&!stopped&&!document.hidden&&navigator.onLine){
   void tryAutoSummary(id,()=>!stopped).catch(()=>{});
  }else wake();
 };
 window.addEventListener('claudia:assistant-reply-committed',onReplyCommitted);
 const timer=setInterval(wake,60000);
 window.addEventListener('online',wake);
 window.addEventListener('pageshow',wake);
 document.addEventListener('visibilitychange',wake);
 wake();
 return {wake,stop:()=>{stopped=true;lastCoreReceiptSignature.clear();clearInterval(timer);window.removeEventListener('claudia:assistant-reply-committed',onReplyCommitted);window.removeEventListener('online',wake);window.removeEventListener('pageshow',wake);document.removeEventListener('visibilitychange',wake);}};
}

export function installMemorySummaryScheduler(){return acquireAutomationScheduler('memory',startScheduler);}

/** Call after the assistant reply has been committed to the local timeline. */
export function notifyAssistantReplyCommitted(conversationId:string){
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('claudia:assistant-reply-committed',{detail:{conversationId}}));
}
