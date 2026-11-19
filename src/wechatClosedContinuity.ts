/** Reconcile messages accumulated by the cloud while the iPhone PWA was closed.
 * This runs on app reopen/foreground only; iOS does not execute closed-page JS.
 * Only bindings explicitly opted in on this device are touched.
 */
import {db} from './store';
import {listWechatCloudBindings} from './wechatCloudIdentity';
import {syncWechatDailyConversation} from './wechatDailySync';
import {syncWechatEffectiveContext} from './wechatContextSync';
import {readWechatCloudConfig} from './wechatCloudConfig';

const prefix='claudia-wechat-closed-continuity:';
export function setWechatClosedContinuity(bindingId:string,enabled:boolean){
 localStorage.setItem(prefix+bindingId,enabled?'yes':'no');
}
export function getWechatClosedContinuity(bindingId:string){
 return localStorage.getItem(prefix+bindingId)==='yes';
}
let pending:Promise<void>|null=null;
export function reconcileWechatAfterReopen():Promise<void>{
 if(pending)return pending;
 pending=(async()=>{
  if(!readWechatCloudConfig()||document.visibilityState!=='visible')return;
  // Avoid cloud auth, identity creation, and network traffic until explicitly opted in.
  const optedIn=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i))
   .some(key=>key?.startsWith(prefix)&&localStorage.getItem(key)==='yes');
  if(!optedIn)return;
  const bindings=await listWechatCloudBindings();
  for(const binding of bindings){
   if(!getWechatClosedContinuity(binding.id)||binding.status!=='connected')continue;
   const conversation=await db.conversations.get(binding.conversation_id);
   if(!conversation||conversation.mode!=='daily'||conversation.worldId||
    conversation.characterId!==binding.character_id)continue;
   try{
    const result=await syncWechatDailyConversation(binding.id,conversation.id,
     conversation.characterId,20);
    // Never overwrite the approved cloud snapshot until all pages are merged.
    if(result.hasMore)continue;
    await syncWechatEffectiveContext(binding.id,conversation.id);
   }catch(error){
    // Preserve remote cursor and snapshot on conflicts, offline, or changed branch.
    console.warn('微信离线对话回填未完成；可稍后重试。',
     error instanceof Error?error.message:'unknown');
   }
  }
 })().finally(()=>{pending=null;});
 return pending;
}
