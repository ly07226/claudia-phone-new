import {withSummaryLock} from './summaryLock';
import {db} from './store';
import {getGenerationTask,runningTask} from './generationTasks';
type Job={key:string;run:()=>Promise<unknown>;done:()=>void};
const queue:Job[]=[];
const keys=new Map<string,Promise<void>>();
let running=false;
let wake:ReturnType<typeof setTimeout>|undefined;
export function enqueueAutomation(key:string,run:()=>Promise<unknown>):Promise<void>{
 const existing=keys.get(key);if(existing)return existing;
 let done!:()=>void;
 const promise=new Promise<void>(resolve=>{done=resolve});
 keys.set(key,promise);queue.push({key,run,done});void drain();return promise;
}
async function drain(){
 if(running||!queue.length)return;
 running=true;
 try{
  if(document.hidden||!navigator.onLine)return;
  await withSummaryLock('claudia:foreground-automation',async()=>{
  if(document.hidden||!navigator.onLine)return;
  const global=await db.themes.get('global');
  if(!global?.dedicatedSummaryApi?.enabled){
   const conversations=await db.conversations.toArray();
   if(conversations.some(c=>runningTask(getGenerationTask(c.id))||(c.sendingUntil??0)>Date.now()))return;
  }
  const job=queue.shift();
  if(job)try{await job.run()}catch{/* task owns failure state */}finally{keys.delete(job.key);job.done()}
  });
 }catch{/* retry local readiness on next wake */}finally{
  running=false;
  if(queue.length&&wake===undefined)wake=setTimeout(()=>{wake=undefined;void drain()},document.hidden||!navigator.onLine?30000:2000);
 }
}
