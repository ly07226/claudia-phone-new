import Dexie from 'dexie';
const transactions=new WeakMap<object,Promise<boolean>>();
const root=(tx:any):any=>tx?.parent?root(tx.parent):tx;
/** Reuse the existing read-only SW window inventory protocol. Mutation broadcasts
 * alone cannot prove another tab's write has already been delivered here.
 * Unknown/multiple clients fail closed to ordinary full source reads. */
export function canReuseSourceCache():Promise<boolean>{
 const tx=root(Dexie.currentTransaction);const previous=tx&&transactions.get(tx);if(previous)return previous;
 const worker=typeof navigator==='undefined'?undefined:navigator.serviceWorker?.controller;
 if(!worker||typeof MessageChannel==='undefined')return Promise.resolve(false);
 const request=new Promise<boolean>(resolve=>{const channel=new MessageChannel();let settled=false;const finish=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);channel.port1.close();resolve(ok);};const timer=setTimeout(()=>finish(false),800);channel.port1.onmessage=e=>finish(navigator.serviceWorker.controller===worker&&e.data?.count===1);try{worker.postMessage({type:'claudia-backup-clients-v1'},[channel.port2]);}catch{finish(false);}});
 const promise=tx?Dexie.waitFor(request):request;if(tx)transactions.set(tx,promise);return promise;
}
