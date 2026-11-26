import {sourceHash} from './summarySourceFingerprint';
import Dexie from 'dexie';
import {buildQqSnapshot} from './qqContextSnapshot';
import {wechatCloudFunctionRequest} from './wechatCloudIdentity';
import {readWechatCloudConfig} from './wechatCloudConfig';
import {contextPatch,documentPatch,type QqContextMessage,type QqContextData} from '../supabase/functions/_shared/qqContext.mjs';
let generation=1;
const listeners=new Set<()=>void>();
export function observeQqContextChanges(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
// Dexie broadcasts committed mutations across tabs. No per-message polling/scanning.
Dexie.on('storagemutated',()=>{generation++;for(const listener of listeners)listener();});
const cache=new Map<string,{generation:number;revision:string|null;messages:QqContextMessage[];data:QqContextData|null}>();
const running=new Map<string,Promise<void>>();
// Keep lightweight acknowledged signatures even if a large snapshot body is evicted.
const acknowledged=new Map<string,{generation:number;hash:string}>();
/** Retry the same version after a lost acknowledgement; a conflict never overwrites the winner. */
export function syncQqSnapshot(bindingId:string,conversationId:string,manual=false):Promise<void>{\n return syncQqSnapshotPass(bindingId,conversationId,manual,1);\n}\nasync function syncQqSnapshotPass(bindingId:string,conversationId:string,manual:boolean,retries:number):Promise<void>{
 const key=readWechatCloudConfig()?.url+':'+bindingId+':'+conversationId;
 const pending=running.get(key);if(pending)return pending;
 const task=(async()=>{
  let old=cache.get(key);if(!manual&&(old?.generation===generation||acknowledged.get(key)?.generation===generation))return;
  const seen=generation;
  let next;
  try{next=await buildQqSnapshot(conversationId);}catch(error){
   if(!(error instanceof Error)||error.message!=='QQ 上下文读取期间资料已变化，将自动重试')throw error;
   // Local re-read only: no model request and no upload of the mixed snapshot.
   next=await buildQqSnapshot(conversationId);
  }
  const snapshotHash=await sourceHash(JSON.stringify(next));
  if(!manual&&acknowledged.get(key)?.hash===snapshotHash){acknowledged.set(key,{generation:seen,hash:snapshotHash});if(old)old.generation=seen;return;}
  if(!old||manual){
   const response=await wechatCloudFunctionRequest('claudia-qq-ai-config',{action:'context-version',bindingId},true);
   const result=await response.json();
   if(!response.ok||result.ok!==true||!('revision' in result))throw Error('QQ 上下文版本读取失败，需确认云端同步服务已更新');
   old={generation:0,revision:result.revision,messages:[],data:null};cache.set(key,old);
  }
  const payload={action:'sync-context-v2',bindingId,expectedRevision:old.revision,replaceDocuments:old.data===null,
   patch:contextPatch(old.messages,next.messages),documents:documentPatch(old.data?.documents??[],next.data.documents),
   metadata:{...next.data,documents:undefined}};
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))));
  hash[6]=(hash[6]&15)|80;hash[8]=(hash[8]&63)|128;
  const hex=[...hash.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const requestId=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  const response=await wechatCloudFunctionRequest('claudia-qq-ai-config',{...payload,requestId},true);
  const result=await response.json();
  if(!response.ok||result.ok!==true||typeof result.revision!=='string')throw Error(response.status===409?'QQ 上下文版本冲突，旧版本未覆盖云端；请在 QQ 设置中手动同步确认':`QQ 上下文同步失败（HTTP ${response.status}，${typeof result.error==='string'?result.error:'invalid_response'}）`);
  cache.set(key,{generation:seen,revision:result.revision,messages:next.messages,data:next.data});
  acknowledged.set(key,{generation:seen,hash:snapshotHash});
  while(cache.size>20)cache.delete(cache.keys().next().value!);
 })().finally(()=>running.delete(key));
 running.set(key,task);
 // Mutations committed while an upload was in flight must not leave QQ on
 // the old snapshot until another UI event happens. One bounded second pass
 // catches that race without polling or touching the local memory system.
 return task.then(async()=>{
  if(generation!==acknowledged.get(key)?.generation){
   await syncQqSnapshot(bindingId,conversationId,manual);
  }
 });
}
