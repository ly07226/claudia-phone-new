import {tokens,selectSourceMemories,formatSourceMemories} from './wechat-memory-retrieval.mjs';
// Server-only cloud AI generation worker (Node 20+).
// Fail closed: only explicitly provisioned, enabled per-binding profiles can run.
// First iteration supports OpenAI-compatible chat completions only.
// Does not pretend to reproduce browser lorebook/memory/branch semantics.
const env=process.env;
const base=env.SUPABASE_URL?.replace(/\/$/,'');
const service=env.SUPABASE_SERVICE_ROLE_KEY;
const raw=Buffer.from(env.WECHAT_ILINK_ENCRYPTION_KEY||'','base64');
if(!base||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)||!service||raw.length!==32)
 throw Error('Missing personal Supabase service credentials or encryption key');
const {webcrypto,randomUUID}=await import('node:crypto');
const {setTimeout:sleep}=await import('node:timers/promises');
const cryptoKey=await webcrypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
async function decrypt(value){
 const [nonce,data]=value.split('.');
 if(!nonce||!data)throw Error('invalid_ciphertext');
 const plain=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(nonce,'base64')},
  cryptoKey,Buffer.from(data,'base64'));
 return Buffer.from(plain).toString('utf8');
}
async function request(path,{method='GET',body,prefer}={}){
 const response=await fetch(base+'/rest/v1/'+path,{
  method,headers:{apikey:service,Authorization:'Bearer '+service,
   'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('database HTTP '+response.status);
 return response.status===204?null:response.json();
}
const rpc=(name,body)=>request('rpc/'+name,{method:'POST',body});
async function next(){
 // Don't claim a message if its AI profile isn't enabled.
 const ready=await request('claudia_wechat_messages?direction=eq.inbound&status=eq.received&select=id,binding_id&order=received_at.asc&limit=30');
 if(!ready?.length)return false;
 const ids=[...new Set(ready.map(r=>r.binding_id))];
 const profiles=await request('claudia_wechat_ai_profiles?enabled=eq.true&binding_id=in.('+
  ids.map(encodeURIComponent).join(',')+')&select=binding_id');
 if(!profiles?.length)return false;
 // The claim RPC is global: do not claim work from another, unconfigured binding.
 // This requires the scoped claim migration before this worker may run.
 const allowed=new Set(profiles.map(p=>p.binding_id));
 const candidate=ready.find(r=>allowed.has(r.binding_id));
 if(!candidate)return false;
 const workerId=randomUUID();
 const rows=await rpc('claudia_wechat_claim_inbound_for_binding',{
  p_binding_id:candidate.binding_id,p_worker_id:workerId,p_lease_seconds:240});
 const row=rows?.[0];
 if(!row)return false;
 let reply=null,errorCode=null;
 try{
  const profiles=await request('claudia_wechat_ai_profiles?binding_id=eq.'+row.binding_id+
   '&enabled=eq.true&select=user_id,system_prompt,model,endpoint,api_key_ciphertext');
  const profile=profiles?.[0];
  if(!profile||profile.user_id!==row.user_id)throw Error('profile_not_authorized');
  const snapshots=await request('claudia_wechat_context_snapshots?binding_id=eq.'+row.binding_id+
   '&select=context_messages,revision,history_cutoff');
  const snapshot=snapshots?.[0];
  if(!snapshot||!Array.isArray(snapshot.context_messages)||
   !snapshot.context_messages.some(m=>m?.role==='system'))
   throw Error('context_not_authorized');
  const url=new URL(profile.endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||
   !url.hostname||url.hostname==='localhost'||url.hostname.endsWith('.local')||
   /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname))
   throw Error('invalid_model_endpoint');
  // The approved local snapshot is a fixed context boundary; do not replay older cloud turns.
  const history=await request('claudia_wechat_messages?binding_id=eq.'+row.binding_id+
   '&status=in.(received,processing,generated,sent)&select=id,direction,body,status,in_reply_to,received_at'+
   '&received_at=gt.'+encodeURIComponent(snapshot.history_cutoff)+
   '&received_at=lt.'+encodeURIComponent(row.received_at)+
   '&order=received_at.desc&limit=24');
  // Search a bounded older window, not just the most recent 24 messages.
  // Every recalled snippet retains its original message ID and timestamp.
  const recentIds=new Set((history||[]).map(m=>m.id));
  const terms=[...tokens(row.body)].filter(t=>t.length>=2&&t.length<=40).slice(0,16);
  // Search the durable database, not an arbitrary last-500-message window.
  // This RPC is service-role only and enforces the binding's consent boundary.
  const archive=terms.length?await rpc('claudia_wechat_search_history',{
   p_binding_id:row.binding_id,p_before:row.received_at,p_terms:terms,p_limit:12}):[];
  const memories=selectSourceMemories((archive||[]).filter(m=>!recentIds.has(m.id)),row.body);
  const memoryContext=formatSourceMemories(memories);
  const messages=(history||[]).reverse().filter(m=>
   (m.direction==='inbound'&&m.id!==row.id)||
   (m.direction==='outbound'&&m.status==='sent'))
   .map(m=>({role:m.direction==='inbound'?'user':'assistant',content:m.body.slice(0,8000)}));
  // Local effective context is authoritative for character/lore/memory.
  // Cloud WeChat messages follow it as new turns; never silently claim parity
  // with unsynced local messages or changed local memory.
  const effective=snapshot.context_messages.filter(m=>
   m&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string');
  // The local snapshot can end with several unanswered user turns. Those turns
  // are context, not pending requests for this WeChat generation. Remove only
  // the trailing user run, keeping all earlier dialogue and system memories.
  // The claimed inbound row below is the sole current turn.
  while(effective.length&&effective[effective.length-1].role==='user')effective.pop();
  if(memoryContext)messages.unshift({role:'system',content:
   'The following is retrieved background memory, not a new user request.\\n'+memoryContext});
  messages.push({role:'user',content:row.body});
  const apiKey=await decrypt(profile.api_key_ciphertext);
  const response=await fetch(url,{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},
   body:JSON.stringify({model:profile.model,messages:[
    ...effective,...messages],stream:false}),
   signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('model_http_'+response.status);
  const data=await response.json();
  const text=data?.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim()||text.length>8000||
   !['stop'].includes(data?.choices?.[0]?.finish_reason))
   throw Error('invalid_model_reply');
  reply=text.trim();
 }catch(error){
  errorCode=error instanceof Error&&/^[a-z_]+$/.test(error.message)?
   error.message.slice(0,80):'generation_failed';
 }
 try{
  await rpc('claudia_wechat_finish_generation',{
   p_inbound_id:row.id,p_worker_id:workerId,p_expected_lease_until:row.lease_until,
   p_reply_body:reply,p_error_code:errorCode});
 }catch(error){console.error('wechat generation commit failed',row.id,String(error));}
 return true;
}
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});
process.on('SIGINT',()=>{stopping=true;});
while(!stopping){
 try{if(!await next())await sleep(2000);}
 catch(error){console.error('wechat AI worker error',String(error));await sleep(5000);}
}
