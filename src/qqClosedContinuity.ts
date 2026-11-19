/** Opt-in QQ recovery, same foreground cadence as WeChat. No background
 * execution while iOS closes the PWA; no cloud identity creation without opt-in.
 */
import {db} from './store';
import {listQqCloudBindings} from './qqQrLogin';
import {syncQqDailyConversation} from './qqDailySync';
import {buildContext} from './chatContext';
import {syncQqContext} from './qqAiAuthorization';

const prefix='claudia-qq-closed-continuity:';
export function setQqClosedContinuity(bindingId:string,enabled:boolean){
 localStorage.setItem(prefix+bindingId,enabled?'yes':'no');
}
export function getQqClosedContinuity(bindingId:string){
 return localStorage.getItem(prefix+bindingId)==='yes';
}
let pending:Promise<void>|null=null;
export function reconcileQqAfterReopen():Promise<void>{
 if(pending)return pending;
 pending=(async()=>{
  if(document.visibilityState!=='visible'||!navigator.onLine)return;
  const optedIn=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i))
   .some(key=>key?.startsWith(prefix)&&localStorage.getItem(key)==='yes');
  if(!optedIn)return;
  const bindings=await listQqCloudBindings();
  for(const binding of bindings){
   if(!getQqClosedContinuity(binding.id)||binding.status!=='connected')continue;
   const conversation=await db.conversations.get(binding.conversation_id);
   if(!conversation||conversation.mode!=='daily'||conversation.worldId||
      conversation.characterId!==binding.character_id)continue;
   try{
    const added=await syncQqDailyConversation(conversation.id);
    const dirtyKey='claudia-qq-context-dirty:'+binding.id;
    if(added>0)localStorage.setItem(dirtyKey,'yes');
    if(localStorage.getItem(dirtyKey)!=='yes')continue;
    const fresh=await db.conversations.get(conversation.id);
    if(!fresh||fresh.activeTimelineId!==conversation.activeTimelineId||
       (fresh.timelineEpoch??0)!==(conversation.timelineEpoch??0))continue;
    const context=await buildContext(fresh);
    if(context.some(m=>m.images?.length))throw Error('有效上下文包含图片，QQ 云端暂不支持完整同步');
    const messages=context.map(m=>({role:m.role,content:m.content}));
    if(!messages.some(m=>m.role==='system')||messages.length>64||JSON.stringify(messages).length>80000)
      throw Error('QQ 有效上下文超过安全容量或缺少系统设定');
    await syncQqContext(binding.id,messages);
    localStorage.removeItem(dirtyKey);
   }catch(e){console.warn('QQ 离线消息回填或记忆同步待重试',e instanceof Error?e.message:'unknown');}
  }
 })().finally(()=>{pending=null;});
 return pending;
}
