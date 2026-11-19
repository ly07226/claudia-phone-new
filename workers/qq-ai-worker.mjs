// QQ-only AI generation worker. Requires explicit owner authorization and synced context.
import {webcrypto} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const raw=Buffer.from(process.env.WECHAT_ILINK_ENCRYPTION_KEY||'','base64');
if(!base||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!service||raw.length!==32)
 throw Error('QQ AI worker requires Supabase service credentials and encryption key');
const key=await webcrypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
async function decrypt(value){
 const [iv,data]=value.split('.');
 if(!iv||!data)throw Error('invalid_ciphertext');
 return Buffer.from(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},key,Buffer.from(data,'base64'))).toString('utf8');
}
async function db(path,body){
 const res=await fetch(base+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',
  headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw Error('database_http_'+res.status);
 return res.json();
}
async function next(){
 const ready=await db('claudia_qq_messages?direction=eq.inbound&status=eq.received&select=binding_id&order=received_at.asc&limit=20');
 if(!ready.length)return false;
 for(const {binding_id} of ready){
  const rows=await db('rpc/claudia_qq_claim_inbound',{p_binding_id:binding_id,p_lease_seconds:240});
  const row=rows?.[0];if(!row)continue;
  let reply=null,errorCode=null;
  try{
   const [profiles,snapshots,history]=await Promise.all([
    db('claudia_qq_ai_profiles?binding_id=eq.'+row.binding_id+'&enabled=eq.true&select=user_id,model,endpoint,api_key_ciphertext'),
    db('claudia_qq_context_snapshots?binding_id=eq.'+row.binding_id+'&select=user_id,context_messages'),
    db('claudia_qq_messages?binding_id=eq.'+row.binding_id+'&received_at=lt.'+encodeURIComponent(row.received_at)+'&status=in.(received,generated,sent)&select=direction,body,status&order=received_at.desc&limit=24')
   ]);
   const profile=profiles[0],snapshot=snapshots[0];
   if(!profile||!snapshot||profile.user_id!==row.user_id||snapshot.user_id!==row.user_id)throw Error('profile_or_context_missing');
   const context=snapshot.context_messages;
   if(!Array.isArray(context)||!context.some(m=>m?.role==='system'))throw Error('invalid_context');
   const url=new URL(profile.endpoint);
   const host=url.hostname.toLowerCase().replace(/\.$/,'');
   if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||
      !url.pathname.endsWith('/chat/completions')||url.search||
      !host.includes('.')||host.endsWith('.local')||host.endsWith('.internal')||
      /^\[/.test(host)||/^\d+(?:\.\d+){3}$/.test(host))throw Error('invalid_endpoint');
   const effective=context.filter(m=>m&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string');
   while(effective.length&&effective[effective.length-1].role==='user')effective.pop();
   const prior=history.reverse().filter(m=>m.direction==='inbound'||(m.direction==='outbound'&&m.status==='sent'))
    .map(m=>({role:m.direction==='inbound'?'user':'assistant',content:m.body.slice(0,8000)}));
   const apiKey=await decrypt(profile.api_key_ciphertext);
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},
    body:JSON.stringify({model:profile.model,messages:[...effective,...prior,{role:'user',content:row.body}],stream:false}),
    signal:AbortSignal.timeout(120000)});
   if(!response.ok)throw Error('model_http_'+response.status);
   const data=await response.json();
   const content=data?.choices?.[0]?.message?.content;
   if(typeof content!=='string'||!content.trim()||content.length>8000||data?.choices?.[0]?.finish_reason!=='stop')
    throw Error('invalid_model_reply');
   reply=content.trim();
  }catch(error){
   const reason=error instanceof Error?error.message:'generation_failed';
   errorCode=/^(model_http_\d+|invalid_model_reply|invalid_context|invalid_endpoint|profile_or_context_missing|invalid_ciphertext)$/.test(reason)?reason:'generation_failed';
   console.warn('qq_ai_generation_failed',row.id,errorCode);
  }
  const saved=await db('rpc/claudia_qq_finish_generation',{p_inbound_id:row.id,p_expected_lease_until:row.lease_until,p_reply_body:reply,p_error_code:errorCode});
  console.info('qq_ai_generation_finished',row.id,saved===true,reply!==null);
  return true;
 }
 return false;
}
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
while(!stopping){try{if(!await next())await sleep(2000);}catch(error){console.warn('qq_ai_worker_retry',error instanceof Error?error.message:'unknown');await sleep(5000);}}
