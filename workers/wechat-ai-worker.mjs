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
const {webcrypto}=await import('node:crypto');
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
 const workerId=crypto.randomUUID();
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
  const url=new URL(profile.endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||
   !url.hostname||url.hostname==='localhost'||url.hostname.endsWith('.local')||
   /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname))
   throw Error('invalid_model_endpoint');
  // No browser memory is assumed to be present. Explicitly provisioned prompt only.
  const history=await request('claudia_wechat_messages?binding_id=eq.'+row.binding_id+
   '&status=in.(received,processing,generated,sent)&select=id,direction,body,status,in_reply_to,received_at'+
   '&order=received_at.desc&limit=24');
  const messages=(history||[]).reverse().filter(m=>
   (m.direction==='inbound'&&m.id!==row.id)||
   (m.direction==='outbound'&&m.status==='sent'))
   .map(m=>({role:m.direction==='inbound'?'user':'assistant',content:m.body.slice(0,8000)}));
  messages.push({role:'user',content:row.body});
  const apiKey=await decrypt(profile.api_key_ciphertext);
  const response=await fetch(url,{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},
   body:JSON.stringify({model:profile.model,messages:[
    {role:'system',content:profile.system_prompt},...messages],stream:false}),
   signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('model_http_'+response.status);
  const data=await response.json();
  const text=data?.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim()||text.length>8000||
   data?.choices?.[0]?.finish_reason==='length')
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
