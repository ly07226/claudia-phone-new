// Internal-only server-managed OpenAI-compatible executor.
// BYOK/custom provider credentials are NOT supported by this endpoint.
import {createClient} from 'npm:@supabase/supabase-js@2';
const json=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
type Job={id:string;user_id:string;conversation_id:string;attempt_count:number};
type ChatMessage={role:'system'|'user'|'assistant';content:string};
const validMessages=(v:unknown):v is ChatMessage[]=>Array.isArray(v)&&v.length>0&&v.length<=80&&v.every(m=>m&&typeof m==='object'&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.length>0&&m.content.length<=30000);
Deno.serve(async request=>{
 if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
 const secret=Deno.env.get('CLAUDIA_INTERNAL_WORKER_SECRET');
 if(!secret||secret.length<32)return json(503,{error:'not_configured'});
 if(request.headers.get('Authorization')!=='Bearer '+secret)return json(401,{error:'unauthorized'});
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const aiKey=Deno.env.get('CLAUDIA_MANAGED_AI_KEY'),model=Deno.env.get('CLAUDIA_MANAGED_AI_MODEL');
 const aiUrl=Deno.env.get('CLAUDIA_MANAGED_AI_URL');
 // Never run this managed-model worker against user-owned BYOK tasks.
 // The real BYOK worker must be a separate endpoint with encrypted credentials.
 // Managed worker must never claim a BYOK queue. No compatible job discriminator exists yet.
 if(Deno.env.get('CLAUDIA_MANAGED_WORKER_EXPLICIT_OPT_IN')!=='true'||Deno.env.get('CLAUDIA_BACKGROUND_EXECUTOR_READY')!=='true'||!url||!key||!aiKey||!model||!aiUrl)return json(503,{error:'executor_not_configured'});
 // Prevent SSRF: only a fixed operator-approved HTTPS endpoint, never a client-provided URL.
 let endpoint:URL;
 try{endpoint=new URL(aiUrl);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/v1/chat/completions'||!['api.openai.com'].includes(endpoint.hostname))throw Error();}
 catch{return json(503,{error:'invalid_managed_ai_endpoint'});}
 const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
 // This legacy endpoint cannot distinguish BYOK jobs: refuse before any claim.
 return json(503,{error:'managed_worker_retired_use_byok_worker'});
 /* const {data:claimed,error:claimError}=await admin.rpc('claudia_claim_background_job',{p_lease_seconds:180});
 if(claimError)return json(500,{error:'claim_failed'});
 const job=(claimed as Job[]|null)?.[0];
 if(!job)return json(200,{ok:true,claimed:0});
 let errorCode:string|null=null,answer:string|null=null;
 try{
  const {data:ctx,error}=await admin.from('claudia_job_contexts').select('messages').eq('job_id',job.id).eq('user_id',job.user_id).maybeSingle();
  if(error||!ctx||!validMessages(ctx.messages))throw Error('invalid_context');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),120000);
  try{
   const response=await fetch(endpoint.toString(),{method:'POST',headers:{Authorization:'Bearer '+aiKey,'Content-Type':'application/json'},body:JSON.stringify({model,messages:ctx.messages,stream:false,max_completion_tokens:2048}),signal:controller.signal});
   if(!response.ok){errorCode=response.status===401||response.status===403?'provider_auth':response.status===402?'provider_balance':response.status===429?'provider_rate_limit':response.status>=500?'provider_unavailable':'provider_error';}
   else{
    const data:unknown=await response.json();
    const choice=(data as {choices?:{message?:{content?:unknown}}[]})?.choices?.[0]?.message?.content;
    if(typeof choice!=='string'||!choice.trim()||choice.length>200000)errorCode='invalid_provider_reply';
    else answer=choice;
   }
  }finally{clearTimeout(timeout);}
 }catch(e){errorCode=e instanceof Error&&e.message==='invalid_context'?'invalid_context':e instanceof DOMException&&e.name==='AbortError'?'provider_timeout':'network_error';}
 const {data:finished,error:finishError}=await admin.rpc('claudia_finish_background_job',{
  p_job_id:job.id,p_attempt:job.attempt_count,p_error_code:answer?null:errorCode??'generation_failed',
  p_message_id:answer?crypto.randomUUID():null,p_body:answer
 });
 if(finishError)return json(500,{error:'finish_failed',jobId:job.id});
 if(!finished)return json(409,{error:'lease_lost',jobId:job.id});
 // Push is best effort and only after the answer is committed. Do not leak secrets to clients.
 if(answer){
  const pushSecret=Deno.env.get('CLAUDIA_INTERNAL_PUSH_SECRET');
  if(pushSecret&&pushSecret.length>=32){
   try{await fetch(url+'/functions/v1/claudia-send-push',{method:'POST',headers:{Authorization:'Bearer '+pushSecret,'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id}),signal:AbortSignal.timeout(10000)});}catch{/* persisted answer remains available for foreground sync */}
  }
 }
 return json(200,{ok:true,jobId:job.id,status:answer?'completed':'failed',errorCode:answer?null:errorCode}); */
});
