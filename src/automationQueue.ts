import {db} from './store';
import {getGenerationTask,runningTask} from './generationTasks';
type Job={key:string;run:()=>Promise<unknown>;done:()=>void};
const queue:Job[]=[];
const keys=new Set<string>();
let running=false;
let wake:ReturnType<typeof setTimeout>|undefined;
export function enqueueAutomation(key:string,run:()=>Promise<unknown>):Promise<void>{
 if(keys.has(key))return Promise.resolve();
 keys.add(key);
 return new Promise(resolve=>{queue.push({key,run,done:resolve});void drain()});
}
async function drain(){
 if(running||!queue.length)return;
 running=true;
 try{
  if(document.hidden||!navigator.onLine)return;
  const global=await db.themes.get('global');
  if(!global?.dedicatedSummaryApi?.enabled){
   const conversations=await db.conversations.toArray();
   if(conversations.some(c=>runningTask(getGenerationTask(c.id))||(c.sendingUntil??0)>Date.now()))return;
  }
  const job=queue.shift();
  if(job)try{await job.run()}catch{/* task owns failure state */}finally{keys.delete(job.key);job.done()}
 }catch{/* retry local readiness on next wake */}finally{
  running=false;
  if(queue.length&&wake===undefined)wake=setTimeout(()=>{wake=undefined;void drain()},2000);
 }
}
