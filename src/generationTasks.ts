import {activeMessages} from './messagePath';
import {messageBubbles} from './messageBubbles';
import {audioKeepAliveEnabled} from './AudioKeepAliveSettings';
import {resolveTimelinePath} from './timelines';
import {describeReplyFailure,type ReplyFailureDetails} from './replyFailure';
import {useSyncExternalStore} from 'react';
import {db} from './store';
import {sendMessage,regenerateMessage,continueMessage,type ExpectedPath} from './chatService';
import {cancelGeneration,invalidateGeneration} from './messageOperations';
import type {Conversation,MessageQuote} from './chatTypes';

/** Send the exact saved chat bubbles as separate iOS notifications, in order.
 * Never generate, mutate or split a second copy of the reply.
 */
function shouldNotifyInBackground(){return audioKeepAliveEnabled()&&document.visibilityState==='hidden'&&!document.hasFocus();}
async function notifyHiddenReply(characterId:string,conversationId:string,messageId?:string){
 if(typeof document==='undefined'||!shouldNotifyInBackground()||typeof Notification==='undefined'||Notification.permission!=='granted'||!('serviceWorker'in navigator))return;
 try{
  const registration=await navigator.serviceWorker.getRegistration();
  if(!registration)return;
  const rows=await activeMessages(conversationId);
  const reply=messageId?rows.find(row=>row.id===messageId):rows.at(-1);
  if(!reply||reply.role!=='assistant')return;
  const character=await db.characters.get(characterId);
  const conversation=await db.conversations.get(conversationId);
  const bubbles=messageBubbles(reply,conversation?.mode!=='daily').filter(part=>part.kind==='text'&&part.text.trim());
  for(let index=0;index<bubbles.length;index++){
   // Returning to the app stops the remaining banners; the saved bubbles stay intact.
   if(!shouldNotifyInBackground())break;
   const visible=await activeMessages(conversationId);
   if(!visible.some(row=>row.id===reply.id&&row.activeVariantId===reply.activeVariantId&&row.content===reply.content))break;
   const part=bubbles[index];
   if(part.kind!=='text')continue;
   await registration.showNotification(character?.name??'Claudia Phone',{
    body:part.text.trim().slice(0,300),
    tag:'claudia-reply-'+reply.id+'-'+index,
    data:{conversationId,messageId:reply.id,bubbleIndex:index},
    icon:'/apple-icon.png?v=2'
   });
   if(index<bubbles.length-1)await new Promise<void>(resolve=>setTimeout(resolve,1200));
  }
 }catch{/* Notifications must never affect the stored conversation. */}
}

type Status='saving'|'generating'|'completed'|'failed'|'stopped'|'interrupted';
export interface GenerationTask {
 id:string; conversationId:string; characterId:string; worldId?:string;
 timelineId?:string; epoch:number; startedAt:number; status:Status; saved:boolean; error?:string; failure?:ReplyFailureDetails;
}
interface Request {
 conversation:Conversation; expectedPath:ExpectedPath; text:string; retry:boolean;
 continuationId?:string; messageId?:string; allowArchive?:boolean; images:string[]; replyTo?:MessageQuote;
}
interface Entry {state:GenerationTask;controller:AbortController;done:Promise<void>}
export interface FailedGeneration extends GenerationTask {failure:ReplyFailureDetails;messageId?:string}
const failures=new Map<string,readonly FailedGeneration[]>();
const noFailures:readonly FailedGeneration[]=[];
const tasks=new Map<string,Entry>();
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(listener=>listener());
export const runningTask=(task?:GenerationTask)=>task?.status==='saving'||task?.status==='generating';
export const getGenerationTask=(id?:string)=>id?tasks.get(id)?.state:undefined;
export function useGenerationTask(id?:string){
 return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>getGenerationTask(id),()=>undefined);
}
export function useGenerationFailures(id?:string){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>id?failures.get(id)??noFailures:noFailures,()=>noFailures);}
export async function retainGenerationFailure(state:GenerationTask,error:unknown,messageId?:string){
 if(!messageId&&state.saved){try{messageId=(state.timelineId?await resolveTimelinePath(state.conversationId,state.timelineId):await activeMessages(state.conversationId)).at(-1)?.id;}catch{/* Keep a task placeholder if the message cannot be read. */}}
 const failed:FailedGeneration={...state,status:'failed',failure:describeReplyFailure(error),messageId};
 failures.set(state.conversationId,[...(failures.get(state.conversationId)??[]).filter(f=>f.id!==state.id&&!(messageId&&f.messageId===messageId&&f.timelineId===state.timelineId&&f.epoch===state.epoch)),failed]);emit();
}
/** Owns the controller and promise for the lifetime of this application, not a view.
 * No background retry, no visibility-triggered request, no credentials in task state.
 * The service's transactional token/path checks remain the authority for all writes.
 */
export function startGenerationTask(request:Request,onSaved?:()=>void){
 const {conversation:c,expectedPath}=request;
 if(runningTask(getGenerationTask(c.id)))throw Error('此会话正在回复中，请稍候。');
 const controller=new AbortController();
 const entry:Entry={state:{id:crypto.randomUUID(),conversationId:c.id,characterId:c.characterId,worldId:c.worldId,timelineId:expectedPath.timelineId,epoch:expectedPath.epoch,startedAt:Date.now(),status:'saving',saved:request.retry||!!request.messageId||!!request.continuationId},controller,done:Promise.resolve()};
 const update=(patch:Partial<GenerationTask>)=>{entry.state={...entry.state,...patch};emit();};
 tasks.set(c.id,entry);
 // Defer work until the entry and synchronous duplicate-request guard are installed.
 entry.done=Promise.resolve().then(async()=>{
  const saved=async(path:ExpectedPath)=>{
   // Use the service transaction's captured path, never a later UI/current-path read.
   update({saved:true,status:'generating',timelineId:path.timelineId,epoch:path.epoch});
   try{onSaved?.();}catch{/* A detached view cannot fail the model request. */}
  };
  try{
   const result=request.continuationId?await continueMessage(c.id,request.continuationId,controller.signal,expectedPath,saved):request.messageId?await regenerateMessage(c.id,request.messageId,controller.signal,request.allowArchive,expectedPath,saved):await sendMessage(c.id,request.text,controller.signal,request.retry,saved,expectedPath,request.images,request.replyTo);
   update({status:result?.interruption?'interrupted':'completed',saved:true});
   if(!result?.interruption)void notifyHiddenReply(c.characterId,c.id,request.messageId??request.continuationId);
   if(request.retry||request.messageId||request.continuationId){try{const target=request.messageId??request.continuationId??(await activeMessages(c.id)).filter(m=>m.role==='user').at(-1)?.id;if(target){failures.set(c.id,(failures.get(c.id)??[]).filter(f=>f.messageId!==target||f.timelineId!==entry.state.timelineId||f.epoch!==entry.state.epoch));emit();}}catch{/* Failure-display cleanup cannot turn a saved reply into a failed generation. */}}
  }catch(error){
   update({status:controller.signal.aborted?'stopped':'failed',failure:controller.signal.aborted?undefined:describeReplyFailure(error),error:controller.signal.aborted?'回复已停止或当前路径已变化，已保存的消息和版本保留。':error instanceof Error?error.message:'回复未完成，已保存的消息保留。'});
   if(!controller.signal.aborted)await retainGenerationFailure(entry.state,error,request.messageId??request.continuationId);
   throw error;
  }
 });
 // A navigation may detach the caller. Always handle the promise at its owner too.
 void entry.done.catch(()=>{});
 emit();
 return {controller,done:entry.done};
}
export async function stopGenerationTask(id:string){
 const entry=tasks.get(id);
 if(runningTask(entry?.state))entry!.controller.abort();
 cancelGeneration(id);
 await db.transaction('rw',db.conversations,async()=>{if(await db.conversations.get(id))await invalidateGeneration(id);});
 if(entry&&runningTask(entry.state))await entry.done.catch(()=>{});
}
