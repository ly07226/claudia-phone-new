import Dexie from 'dexie';
import {db} from './store';
let revision=0,installed=false;const transactions=new WeakSet<object>();
/** Conservative invalidation, not cached database truth. Writes in any relevant
 * conversation invalidate this view; rollback merely causes an extra read. */
export function chatDataRevision(){
 if(!installed){installed=true;const touch=(tx:any)=>{if(transactions.has(tx))return;transactions.add(tx);revision++;tx.on('complete',()=>{revision++;});};
 for(const table of [db.messages,db.messageVariants,db.pathNodes,db.timelines]){table.hook('creating',(_key,_value,tx)=>{touch(tx);});table.hook('updating',(_mods,_key,_value,tx)=>{touch(tx);});table.hook('deleting',(_key,_value,tx)=>{touch(tx);});}
 Dexie.on('storagemutated',parts=>{if(Object.keys(parts).some(key=>['messages','messageVariants','pathNodes','timelines'].some(name=>key.includes('/'+name+'/'))))revision++;});
 db.on('ready',()=>{revision++;});
 }return revision;
}
