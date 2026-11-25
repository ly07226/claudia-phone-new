/** One scheduler runtime per tab; callers own idempotent lifecycle leases.
 * Database claims still provide the separate cross-tab/request protection. */
type Runtime={wake:()=>void;stop:()=>void};
const runtimes=new Map<string,Runtime&{owners:number}>();
export function acquireAutomationScheduler(name:string,start:()=>Runtime){
 let entry=runtimes.get(name);
 if(entry){entry.owners++;entry.wake();}
 else{entry={...start(),owners:1};runtimes.set(name,entry);}
 const owned=entry;let released=false;
 return()=>{if(released)return;released=true;if(runtimes.get(name)!==owned)return;if(--owned.owners===0){runtimes.delete(name);owned.stop();}};
}
if(import.meta.hot)import.meta.hot.dispose(()=>{for(const entry of runtimes.values())entry.stop();runtimes.clear();});
