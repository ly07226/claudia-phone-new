import {backupIsLocked} from './backupGate';
import {db} from './store';
export interface SummaryLease {name:string;owner:string;expiresAt:number;updatedAt:number}
// Long grace period tolerates iOS background timer suspension during a paid request.
const LEASE_MS=30*60*1000;
const HEARTBEAT_MS=20000;
/**
 * Cross-tab fallback when Web Locks is absent.
 * Dexie transactions serialize the compare-and-set on the same key.
 * A lost lease stops new work, but cannot prove a remote API request was not billed.
 */
export async function withSummaryLock(name:string,work:(assertLease:()=>Promise<void>)=>Promise<void>,leaseMs=LEASE_MS,waitMs=0):Promise<void>{
 if(typeof navigator!=='undefined'&&navigator.locks?.request){
  if(waitMs<=0){await navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},async lock=>{if(lock)await work(async()=>{});});return;}
  // Only independently receipted events wait. The deadline covers acquisition,
  // never a paid request after acquisition; ordinary scans/force stay nonblocking.
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),waitMs);
  try{await navigator.locks.request(name,{mode:'exclusive',signal:controller.signal},async()=>{clearTimeout(timer);await work(async()=>{});});}
  catch(error){if(!controller.signal.aborted)throw error;}
  finally{clearTimeout(timer);}
  return;
 }
 const owner=crypto.randomUUID();
 const deadline=Date.now()+Math.max(0,waitMs);let acquired=false;
 do{acquired=await db.transaction('rw',db.summaryLeases,async()=>{
  const previous=await db.summaryLeases.get(name),now=Date.now();
  if(previous&&previous.expiresAt>now)return false;
  await db.summaryLeases.put({name,owner,expiresAt:now+leaseMs,updatedAt:now});
  return true;
 });
 if(acquired)break;
 if(Date.now()>=deadline||typeof document!=='undefined'&&document.hidden||typeof navigator!=='undefined'&&!navigator.onLine)return;
 await new Promise(resolve=>setTimeout(resolve,Math.min(250,Math.max(1,deadline-Date.now()))));
 }while(!acquired);
 let lost=false;
 const beat=setInterval(()=>{void db.transaction('rw',db.summaryLeases,async()=>{
  const current=await db.summaryLeases.get(name);
  if(current?.owner!==owner){lost=true;return;}
  await db.summaryLeases.put({...current,expiresAt:Date.now()+leaseMs,updatedAt:Date.now()});
 }).catch(()=>{if(!backupIsLocked())lost=true;});},HEARTBEAT_MS);
 const assertLease=async()=>{const current=await db.summaryLeases.get(name);if(lost||current?.owner!==owner||current.expiresAt<=Date.now())throw Error('总结任务锁已失效');};
 try{
  await assertLease();
  await work(assertLease);
 }finally{
  clearInterval(beat);
  await db.transaction('rw',db.summaryLeases,async()=>{
   const current=await db.summaryLeases.get(name);
   if(current?.owner===owner)await db.summaryLeases.delete(name);
  });
 }
}
