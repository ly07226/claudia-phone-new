import {backupIsLocked} from './backupGate';
import {db} from './store';
import {withSummaryLock} from './summaryLock';
import {requestReply} from './chatProvider';
import {automationRequest,foregroundUses,sameApi,AutomationRoleFallback} from './automationActivity';
import type {ApiConfig} from './api';
import {automationStatus} from './automationQueue';
const deadlines=new WeakMap<AbortSignal,{start:()=>void;stop:()=>void}>();
/** Waiting for chat/another task does not consume the provider response timeout. */
export function armAutomationTimeout(controller:AbortController,ms:number,onTimeout?:()=>void){
 let timer:ReturnType<typeof setTimeout>|undefined;
 const stop=()=>{if(timer!==undefined)clearTimeout(timer);timer=undefined;};
 deadlines.set(controller.signal,{start:()=>{stop();timer=setTimeout(()=>{onTimeout?.();controller.abort()},ms);},stop});
 return()=>{stop();deadlines.delete(controller.signal);};
}
const preflights=new WeakMap<AbortSignal,()=>Promise<void>>();
export function setAutomationPreflight(signal:AbortSignal,guard:()=>Promise<void>){preflights.set(signal,guard);}
export function inheritAutomationPreflight(from:AbortSignal,to:AbortSignal){const guard=preflights.get(from);if(guard)preflights.set(to,guard);}
const waiting:Array<{run:()=>Promise<boolean>;signal:AbortSignal}>=[];
let running=false,timer:ReturnType<typeof setTimeout>|undefined;
async function busy(config:ApiConfig,key:string){
 if(backupIsLocked())return true;
 if(foregroundUses(config,key))return true;
 const {getGenerationTask,runningTask}=await import('./generationTasks');
 const conversations=await db.conversations.filter(c=>runningTask(getGenerationTask(c.id))||(c.sendingUntil??0)>Date.now()).toArray();
 if(!conversations.length)return false;
 const {resolveApi}=await import('./chatService');
 for(const c of conversations){try{const api=await resolveApi(c);if(sameApi(config,key,api.config,api.key))return true;}catch{return true;}}
 return false;
}
async function drain(){
 if(running)return;running=true;
 try{
  // A FIFO request turn, not a whole multi-chunk summary lease.
  while(waiting.length){
   if(document.hidden||!navigator.onLine){automationStatus('transport',{state:'waiting',reason:document.hidden?'后台暂停，返回后继续':'离线等待网络恢复'});break;}
   const head=waiting.shift()!;
   if(!await head.run())break;
  }
 }finally{running=false;if(waiting.length&&!document.hidden&&navigator.onLine&&timer===undefined)timer=setTimeout(()=>{timer=undefined;void drain()},500);}
}
export function requestAutomationReply(...args:Parameters<typeof requestReply>):Promise<string>{
 const [config,key,messages,signal,transport,fallback,completion]=args;
 let currentMessages=messages,allowFallback=fallback;
 return new Promise((resolve,reject)=>{
  const abort=()=>{const i=waiting.indexOf(entry);if(i>=0)waiting.splice(i,1);reject(new DOMException('请求已取消','AbortError'));};
  const finish=()=>signal.removeEventListener('abort',abort);
  const entry={signal,run:async()=>{
   if(signal.aborted){finish();abort();return true;}
   let acquired=false,blocked=false,retryRole=false;
   try{await withSummaryLock('claudia:automation-request',async assertLease=>{
    if(signal.aborted)return;
    if(document.hidden||!navigator.onLine||await busy(config,key)){blocked=true;return;}
    await assertLease();await preflights.get(signal)?.();
    if(signal.aborted)throw new DOMException('请求已取消','AbortError');
    acquired=true;automationStatus('transport',{state:'running'});
    const marked=Object.assign({...config},{[automationRequest]:true});
    deadlines.get(signal)?.start();
    let result:string;try{result=await requestReply(marked,key,currentMessages,signal,transport,allowFallback,completion);}finally{deadlines.get(signal)?.stop();}
    await assertLease();
    while(backupIsLocked()&&!signal.aborted)await new Promise(r=>setTimeout(r,50));
    if(signal.aborted)throw new DOMException('请求已取消','AbortError');
    resolve(result);
   });}catch(error){if(error instanceof AutomationRoleFallback){currentMessages=error.messages;allowFallback=false;retryRole=true;}else{acquired=true;reject(error);}}
   if(retryRole){waiting.push(entry);return true;}
   if(acquired){finish();automationStatus('transport',{state:'completed'});return true;}
   // Keep FIFO order when chat or another tab owns the transport. Never cancel chat.
   if(signal.aborted){finish();abort();return true;}
   waiting.unshift(entry);automationStatus('transport',{state:'waiting',reason:blocked?'等待普通聊天或前台恢复':'等待其他页面的自动请求',nextAt:Date.now()+500});
   return false;
  }};
  if(signal.aborted){abort();return;}
  signal.addEventListener('abort',abort,{once:true});waiting.push(entry);void drain().catch(reject);
 });
}

const wake=()=>{void drain().catch(()=>{})};
window.addEventListener('online',wake);window.addEventListener('pageshow',wake);document.addEventListener('visibilitychange',wake);
if(import.meta.hot)import.meta.hot.dispose(()=>{if(timer!==undefined)clearTimeout(timer);window.removeEventListener('online',wake);window.removeEventListener('pageshow',wake);document.removeEventListener('visibilitychange',wake)});
