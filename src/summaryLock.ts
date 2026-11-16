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
export async function withSummaryLock(name:string,work:()=>Promise<void>):Promise<void>{
 if(typeof navigator!=='undefined'&&navigator.locks?.request){
  await navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},async lock=>{if(lock)await work();});
  return;
 }
 const owner=crypto.randomUUID();
 const acquired=await db.transaction('rw',db.summaryLeases,async()=>{
  const previous=await db.summaryLeases.get(name),now=Date.now();
  if(previous&&previous.expiresAt>now)return false;
  await db.summaryLeases.put({name,owner,expiresAt:now+LEASE_MS,updatedAt:now});
  return true;
 });
 if(!acquired)return;
 let lost=false;
 const beat=setInterval(()=>{void db.transaction('rw',db.summaryLeases,async()=>{
  const current=await db.summaryLeases.get(name);
  if(current?.owner!==owner){lost=true;return;}
  await db.summaryLeases.put({...current,expiresAt:Date.now()+LEASE_MS,updatedAt:Date.now()});
 }).catch(()=>{lost=true;});},HEARTBEAT_MS);
 try{
  if(lost)throw Error('总结任务锁已失效');
  await work();
 }finally{
  clearInterval(beat);
  await db.transaction('rw',db.summaryLeases,async()=>{
   const current=await db.summaryLeases.get(name);
   if(current?.owner===owner)await db.summaryLeases.delete(name);
  });
 }
}
