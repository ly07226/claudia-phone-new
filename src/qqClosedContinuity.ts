/** Opt-in QQ recovery, same foreground cadence as WeChat. No background
 * execution while iOS closes the PWA; no cloud identity creation without opt-in.
 */
import {db} from './store';
import {listQqCloudBindings,newestQqBinding} from './qqQrLogin';
import {syncQqDailyConversation,resolveQqLocalConversation} from './qqDailySync';
import {syncQqSnapshot} from './qqContextSync';
import {getQqAiStatus} from './qqAiAuthorization';
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
  let failed=false;
  for(const b of bindings.filter(b=>b.status==='connected')){
   if(localStorage.getItem(prefix+b.id)==='no')continue;
   if(getQqClosedContinuity(b.id))continue;
   try {
    const status=await getQqAiStatus(b.id);
    if(status.enabled)setQqClosedContinuity(b.id,true);
   } catch(error) {
    failed=true;
    // A stale QQ binding must not prevent healthy bindings from restoring.
    console.warn('QQ 绑定授权检查失败，继续恢复其他绑定',b.id,error instanceof Error?error.message:'unknown');
   }
  }
  bootstrapDone=!failed;
 })().finally(()=>{bootstrap=null;});
 return bootstrap;
}
export function reconcileQqAfterReopen():Promise<void>{
 if(pending)return pending;
 pending=(async()=>{
  if(!readWechatCloudConfig()||document.visibilityState!=='visible'||!navigator.onLine)return;
  await bootstrapExistingAuthorization();
  const bindings=await listQqCloudBindings();
  const stableId=localStorage.getItem('claudia-qq-stable-sync-id');
  const characterIds=new Set(bindings.filter(b=>b.status==='connected').map(b=>b.character_id));
  const errors:string[]=[];
  for(const characterId of characterIds){
   const candidates=bindings.filter(b=>b.status==='connected'&&b.character_id===characterId);
   // Only the most recently messaged binding is eligible, even if an older one is confirmed.
   const binding=newestQqBinding(candidates);
   if(!binding||localStorage.getItem(prefix+binding.id)==='no')continue;
   const matched=!!stableId&&binding.stable_sync_id===stableId;
   // Confirmed account identity is sufficient for cloud history recovery.
   // Cloud AI authorization controls reply generation, not readback.
   if(!matched&&!getQqClosedContinuity(binding.id))continue;
   const conversation=await resolveQqLocalConversation(binding);
   if(!conversation||conversation.mode!=='daily'||conversation.worldId||
      conversation.characterId!==binding.character_id)continue;
   try{
    const backfillKey='claudia-qq-auto-backfill:'+binding.id+':'+conversation.id;
    const needsBackfill=matched&&localStorage.getItem(backfillKey)!=='done';
    const added=await syncQqDailyConversation(conversation.id,binding.id,needsBackfill);
    if(needsBackfill)localStorage.setItem(backfillKey,'done');
    if(getQqClosedContinuity(binding.id))await syncQqSnapshot(binding.id,conversation.id);
    localStorage.removeItem('claudia-qq-auto-sync-error:'+binding.id);
    window.dispatchEvent(new CustomEvent('claudia-qq-auto-sync-status',{detail:{status:'ok',bindingId:binding.id,added}}));
   }catch(e){
    const reason=e instanceof Error?e.message:'unknown';
    errors.push(reason);
    localStorage.setItem('claudia-qq-auto-sync-error:'+binding.id,reason);
    window.dispatchEvent(new CustomEvent('claudia-qq-auto-sync-status',{detail:{status:'error',bindingId:binding.id,reason}}));
    console.warn('QQ 离线消息回填或记忆同步待重试',reason);
   }
  }
  if(errors.length)localStorage.setItem('claudia-qq-auto-sync-error',errors.join('；'));
  else localStorage.removeItem('claudia-qq-auto-sync-error');
  window.dispatchEvent(new CustomEvent('claudia-qq-auto-sync-status',{detail:{status:errors.length?'error':'ok',reason:errors.join('；')}}));
 })().catch(error=>{
  const reason=error instanceof Error?error.message:'QQ 自动同步失败';
  localStorage.setItem('claudia-qq-auto-sync-error',reason);
  window.dispatchEvent(new CustomEvent('claudia-qq-auto-sync-status',{detail:{status:'error',reason}}));
  throw error;
 }).finally(()=>{pending=null;});
 return pending;
}
