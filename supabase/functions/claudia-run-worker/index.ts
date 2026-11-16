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
 
});
