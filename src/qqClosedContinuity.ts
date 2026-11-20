/** Opt-in QQ recovery, same foreground cadence as WeChat. No background
 * execution while iOS closes the PWA; no cloud identity creation without opt-in.
 */
import {db} from './store';
import {listQqCloudBindings,newestQqBinding} from './qqQrLogin';
import {syncQqDailyConversation} from './qqDailySync';
import {buildContext} from './chatContext';
import {syncQqContext,getQqAiStatus} from './qqAiAuthorization';
import {readWechatCloudConfig} from './wechatCloudConfig';

const prefix='claudia-qq-closed-continuity:';
export function setQqClosedContinuity(bindingId:string,enabled:boolean){
 localStorage.setItem(prefix+bindingId,enabled?'yes':'no');
}
export function getQqClosedContinuity(bindingId:string){
 return localStorage.getItem(prefix+bindingId)==='yes';
}
let pending:Promise<void>|null=null;
let bootstrap:Promise<void>|null=null;
let bootstrapDone=false;
/** Existing owner-authorized bindings need no second consent or settings visit. */
async function bootstrapExistingAuthorization(){
 if(bootstrapDone||!readWechatCloudConfig())return;
 if(bootstrap)return bootstrap;
 bootstrap=(async()=>{
  const bindings=await listQqCloudBindings();
  for(const b of bindings.filter(b=>b.status==='connected')){
   if(localStorage.getItem(prefix+b.id)==='no')continue;
   if(getQqClosedContinuity(b.id))continue;
   try {
    const status=await getQqAiStatus(b.id);
    if(status.enabled)setQqClosedContinuity(b.id,true);
   } catch(error) {
    // A stale QQ binding must not prevent healthy bindings from restoring.
    console.warn('QQ 绑定授权检查失败，继续恢复其他绑定',b.id,error instanceof Error?error.message:'unknown');
   }
  }
  bootstrapDone=true;
 })().finally(()=>{bootstrap=null;});
 return bootstrap;
}
export function reconcileQqAfterReopen():Promise<void>{
 if(pending)return pending;
 pending=(async()=>{
  if(document.visibilityState!=='visible'||!navigator.onLine)return;
  await bootstrapExistingAuthorization();
  const optedIn=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i))
   .some(key=>key?.startsWith(prefix)&&localStorage.getItem(key)==='yes');
  if(!optedIn)return;
  const bindings=await listQqCloudBindings();
  const stableId=localStorage.getItem('claudia-qq-stable-sync-id');
  const characterIds=new Set(bindings.filter(b=>b.status==='connected').map(b=>b.character_id));
  for(const characterId of characterIds){
   const candidates=bindings.filter(b=>b.status==='connected'&&b.character_id===characterId);
   // Only the most recently messaged binding is eligible, even if an older one is confirmed.
   const binding=newestQqBinding(candidates);
   if(!binding||localStorage.getItem(prefix+binding.id)==='no')continue;
   if(!getQqClosedContinuity(binding.id)){
    try{const status=await getQqAiStatus(binding.id);
     if(!status.enabled)continue;
     setQqClosedContinuity(binding.id,true);
    }catch{continue;}
   }
   const matched=!!stableId&&binding.stable_sync_id===stableId;
   const conversation=matched
    ?(await db.conversations.where('characterId').equals(binding.character_id).toArray()).find(c=>c.mode==='daily'&&!c.worldId)
    :await db.conversations.get(binding.conversation_id);
   if(!conversation||conversation.mode!=='daily'||conversation.worldId||
      conversation.characterId!==binding.character_id)continue;
   try{
    const added=await syncQqDailyConversation(conversation.id,binding.id);
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
