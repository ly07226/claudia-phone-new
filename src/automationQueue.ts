import {withSummaryLock} from './summaryLock';
import {db} from './store';
import {getGenerationTask,runningTask} from './generationTasks';
export type AutomationState={key:string;state:'queued'|'running'|'waiting'|'failed'|'completed';reason?:string;nextAt?:number;updatedAt:number};
const statuses=new Map<string,AutomationState>();
export function automationStatus(key:string,value:Omit<AutomationState,'key'|'updatedAt'>){statuses.delete(key);statuses.set(key,{key,...value,updatedAt:Date.now()});if(statuses.size>100)statuses.delete(statuses.keys().next().value!);window.dispatchEvent(new Event('claudia-automation-status'));}
export function automationStatuses(){return [...statuses.values()];}
type Job={key:string;run:()=>Promise<unknown>;done:()=>void};
const queue:Job[]=[],keys=new Map<string,Promise<void>>();
let draining=false,wake:ReturnType<typeof setTimeout>|undefined;
const active=new Set<string>();
export function enqueueAutomation(key:string,run:()=>Promise<unknown>):Promise<void>{
 const existing=keys.get(key);if(existing)return existing;
 let done!:()=>void;const promise=new Promise<void>(resolve=>done=resolve);
 keys.set(key,promise);queue.push({key,run,done});automationStatus(key,{state:'queued'});void drain();return promise;
}
async function drain(){
 if(draining)return;draining=true;
 try{
  if(document.hidden||!navigator.onLine)return;
  const global=await db.themes.get('global');
  if(!global?.dedicatedSummaryApi?.enabled){const conversations=await db.conversations.toArray();if(conversations.some(c=>runningTask(getGenerationTask(c.id))||(c.sendingUntil??0)>Date.now()))return;}
  while(queue.length&&active.size<8){
   const index=queue.findIndex(job=>[...active].filter(k=>k.split(':')[0]===job.key.split(':')[0]).length<2);
   if(index<0)break;
   const [job]=queue.splice(index,1);active.add(job.key);
   // Task-specific lease prevents duplicate owners without monopolizing all task types.
   void withSummaryLock('claudia:automation-job:'+job.key,async()=>{
    automationStatus(job.key,{state:'running'});await job.run();if(statuses.get(job.key)?.state!=='failed')automationStatus(job.key,{state:'completed'});
   }).catch(()=>automationStatus(job.key,{state:'failed',reason:'任务未完成，请查看对应功能的失败详情'})).finally(()=>{active.delete(job.key);keys.delete(job.key);job.done();void drain()});
  }
 }catch{automationStatus('queue',{state:'failed',reason:'读取自动任务状态失败，等待恢复',nextAt:Date.now()+1000});}finally{draining=false;if(queue.length&&!document.hidden&&navigator.onLine&&wake===undefined)wake=setTimeout(()=>{wake=undefined;void drain()},1000);}
}

const resume=()=>{void drain().catch(()=>{})};
window.addEventListener('online',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);
if(import.meta.hot)import.meta.hot.dispose(()=>{if(wake!==undefined)clearTimeout(wake);window.removeEventListener('online',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume)});
