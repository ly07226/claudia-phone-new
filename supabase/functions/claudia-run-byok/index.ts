// Internal BYOK worker: the key is decrypted only in memory for this one job.
import {createClient} from 'npm:@supabase/supabase-js@2';
const respond=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
type Msg={role:'system'|'user'|'assistant';content:string};
type Binding={key_id:string;encrypted_key:string;provider:string;protocol:string;base_url:string;model:string;temperature:number;max_tokens:number};
const hosts:Record<string,string>={gemini:'generativelanguage.googleapis.com',openai:'api.openai.com',openrouter:'openrouter.ai'};
function providerUrl(binding:Binding):string{
 const base=new URL(binding.base_url);
 const host=hosts[binding.provider];
 if(!host||base.protocol!=='https:'||base.hostname!==host||base.port||base.username||base.password||base.search||base.hash||!['/v1','/v1beta','/api/v1'].includes(base.pathname))throw Error('unsupported_provider');
 if(binding.provider==='gemini'&&base.pathname!=='/v1beta')throw Error('unsupported_provider');
 if(binding.provider==='openai'&&base.pathname!=='/v1')throw Error('unsupported_provider');
 if(binding.provider==='openrouter'&&base.pathname!=='/api/v1')throw Error('unsupported_provider');
 return binding.protocol==='gemini'
  ?base.origin+base.pathname+'/models/'+encodeURIComponent(binding.model.replace(/^models\//,''))+':generateContent'
  :base.origin+base.pathname+'/chat/completions';
}
function decodeB64(value:string):Uint8Array{return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
async function decryptKey(encrypted:string,pem:string):Promise<string>{
 const raw=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
 const privateKey=await crypto.subtle.importKey('pkcs8',decodeB64(raw),{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,decodeB64(encrypted));
 const result=new TextDecoder('utf-8',{fatal:true}).decode(plain);
 if(!result||result.length>512)throw Error('invalid_credential');
 return result;
}
function geminiContents(messages:Msg[]){
 const contents:{role:'user'|'model';parts:{text:string}[]}[]=[];
 for(const m of messages.slice(1)){
  const role=m.role==='assistant'?'model':'user';
  const text=m.role==='system'?'[系统设定资料]\n'+m.content:m.content;
  const last=contents.at(-1);
  if(last?.role===role)last.parts.push({text});else contents.push({role,parts:[{text}]});
 }
 if(contents[0]?.role==='model')contents[0]={role:'user',parts:[{text:'[角色参考资料]'},...contents[0].parts]};
 if(contents.at(-1)?.role==='model'){
  const last=contents.pop()!;
  const text='[角色参考资料]\n'+last.parts.map(p=>p.text).join('\n');
  if(contents.at(-1)?.role==='user')contents.at(-1)!.parts.push({text});
  else contents.push({role:'user',parts:[{text}]});
 }
 return contents;
}
Deno.serve(async request=>{
 if(request.method!=='POST')return respond(405,{error:'method_not_allowed'});
 const secret=Deno.env.get('CLAUDIA_INTERNAL_WORKER_SECRET');
 if(!secret||secret.length<32||request.headers.get('Authorization')!=='Bearer '+secret)return respond(401,{error:'unauthorized'});
 const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const pem=Deno.env.get('CLAUDIA_BYOK_PRIVATE_KEY_PEM'),keyId=Deno.env.get('CLAUDIA_BYOK_KEY_ID');
 if(Deno.env.get('CLAUDIA_BYOK_EXECUTOR_READY')!=='true'||!url||!serviceKey||!pem||!keyId)return respond(503,{error:'not_configured'});
 const admin=createClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:claimed,error:claimError}=await admin.rpc('claudia_claim_background_job',{p_lease_seconds:180});
 if(claimError)return respond(500,{error:'claim_failed'});
 const job=claimed?.[0];
 if(!job)return respond(200,{ok:true,claimed:0});
 let answer:string|null=null,errorCode='generation_failed';
 try{
  const [{data:context,error:contextError},{data:binding,error:bindingError}]=await Promise.all([
   admin.from('claudia_job_contexts').select('messages').eq('job_id',job.id).eq('user_id',job.user_id).maybeSingle(),
   admin.from('claudia_job_credentials').select('*').eq('job_id',job.id).eq('user_id',job.user_id).maybeSingle()
  ]);
  if(contextError||bindingError||!context||!binding)throw Error('missing_job_data');
  const b=binding as Binding;
  if(b.key_id!==keyId)throw Error('key_rotation_required');
  const messages=context.messages as Msg[];
  if(!Array.isArray(messages)||messages.length<2||messages.length>80||messages[0]?.role!=='system'||!messages.every(m=>m&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.length>0&&m.content.length<=30000))throw Error('invalid_context');
  if(messages.at(-1)?.role!=='user')throw Error('invalid_context');
  if(!Number.isInteger(b.max_tokens)||b.max_tokens<1||b.max_tokens>32768||typeof b.temperature!=='number'||b.temperature<0||b.temperature>2)throw Error('invalid_provider');
  if((b.provider==='gemini')!==(b.protocol==='gemini'))throw Error('invalid_provider');
  const endpoint=providerUrl(b);
  const apiKey=await decryptKey(b.encrypted_key,pem);
  const gemini=b.protocol==='gemini';
  const body=gemini?{
   systemInstruction:{parts:[{text:messages[0].content}]},
   contents:geminiContents(messages),
   generationConfig:{temperature:b.temperature,maxOutputTokens:b.max_tokens}
  }:{
   model:b.model,messages,temperature:b.temperature,
   ...(b.provider==='openai'?{max_completion_tokens:b.max_tokens}:{max_tokens:b.max_tokens}),stream:false
  };
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),120000);
  try{
   const response=await fetch(endpoint,{method:'POST',headers:gemini?{'Content-Type':'application/json','x-goog-api-key':apiKey}:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
   if(!response.ok){
    errorCode=[401,403].includes(response.status)?'provider_auth':response.status===402?'provider_balance':response.status===429?'provider_rate_limit':response.status>=500?'provider_unavailable':'provider_error';
   }else{
    const result=await response.json();
    const text=gemini?result?.candidates?.[0]?.content?.parts?.filter((p:{text?:unknown})=>typeof p.text==='string').map((p:{text:string})=>p.text).join(''):result?.choices?.[0]?.message?.content;
    if(typeof text==='string'&&text.trim()&&text.length<=200000)answer=text;
    else errorCode='invalid_provider_reply';
   }
  }finally{clearTimeout(timer);}
 }catch(e){
  const code=e instanceof Error?e.message:'generation_failed';
  errorCode=['missing_job_data','key_rotation_required','invalid_context','invalid_provider','unsupported_provider','invalid_credential'].includes(code)?code:
   e instanceof DOMException&&e.name==='AbortError'?'provider_timeout':'network_error';
 }
 const {data:finished,error:finishError}=await admin.rpc('claudia_finish_background_job',{
  p_job_id:job.id,p_attempt:job.attempt_count,p_error_code:answer?null:errorCode,
  p_message_id:answer?crypto.randomUUID():null,p_body:answer
 });
 if(finishError)return respond(500,{error:'finish_failed'});
 if(!finished)return respond(409,{error:'stale_worker'});
 if(answer){
  const pushSecret=Deno.env.get('CLAUDIA_INTERNAL_PUSH_SECRET');
  if(pushSecret&&pushSecret.length>=32){
   try{await fetch(url+'/functions/v1/claudia-send-push',{method:'POST',headers:{Authorization:'Bearer '+pushSecret,'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id}),signal:AbortSignal.timeout(10000)});}catch{/* foreground sync remains authoritative */}
  }
 }
 return respond(200,{ok:true,jobId:job.id,status:answer?'completed':'failed',errorCode:answer?null:errorCode});
});
