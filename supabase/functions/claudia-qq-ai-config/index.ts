import {applyContextPatch,applyDocumentPatch,validContext,validContextData} from '../_shared/qqContext.mjs';
// Owner-authenticated cloud AI authorization. The API key is only accepted
// on an explicit user action and encrypted before service-role storage.
import {createClient} from "npm:@supabase/supabase-js@2";
const allowedOrigin=Deno.env.get("CLAUDIA_APP_ORIGIN")||"";
const trustedOrigins=new Set([allowedOrigin,"https://claudia-phone-new.vercel.app","https://claudia-phone-nxya5vllj-2982991953-4231.vercel.app"].filter(Boolean));
const headers={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin",
 "Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS"};
const rejectJson=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function encrypt(value:string,raw:string){
 const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
 if(bytes.length!==32)throw Error("encryption_not_configured");
 const key=await crypto.subtle.importKey("raw",bytes,"AES-GCM",false,["encrypt"]);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value)));
 const b64=(data:Uint8Array)=>btoa(String.fromCharCode(...data));
 return b64(iv)+"."+b64(ciphertext);
}
function validEndpoint(value:unknown):value is string{
 if(typeof value!=="string"||value.length>1024)return false;
 try{
  const u=new URL(value);
  if(u.protocol!=="https:"||u.username||u.password||u.hash||u.port)return false;
  // Allow user-selected public HTTPS OpenAI-compatible endpoints, not a domain whitelist.
  // Reject local/private hostnames and IP literals (including IPv6) before storing.
  const host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||
     host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.test')||
     host.endsWith('.invalid')||host.endsWith('.example')||
     /^\[/.test(host)||/^\d+(?:\.\d+){3}$/.test(host)||
     /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(host))return false;
  return u.pathname.endsWith("/chat/completions")&&!u.search;
 }catch{return false;}
}
Deno.serve(async req=>{
 const requestOrigin=req.headers.get("Origin")||"";
 const trustedNetlifyOrigin=(()=>{try{const u=new URL(requestOrigin);return u.protocol==="https:" && u.hostname.endsWith("-avenori.netlify.app") && !u.port;}catch{return false;}})();
 if(!trustedOrigins.has(requestOrigin)&&!trustedNetlifyOrigin)return rejectJson(403,{error:"origin_denied"});
 const responseHeaders={...headers,"Access-Control-Allow-Origin":requestOrigin};
 const json=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers:responseHeaders});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:responseHeaders});
 if(req.method!=="POST")return json(405,{error:"method_not_allowed"});
 const authorization=req.headers.get("Authorization")||"";
 if(!authorization.startsWith("Bearer "))return json(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 const encryption=Deno.env.get("WECHAT_ILINK_ENCRYPTION_KEY");
 if(!url||!secret||!encryption)return json(503,{error:"not_configured"});
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await admin.auth.getUser(authorization.slice(7));
 if(authError||!auth.user)return json(401,{error:"unauthorized"});
 let body:Record<string,unknown>;
 try{
  const raw=await req.text();if(raw.length>2200000)throw Error();
  body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw Error();
 }catch{return json(400,{error:"invalid_request"});}
 if(typeof body.bindingId!=="string"||!uuid.test(body.bindingId))
  return json(400,{error:"invalid_binding"});
 const {data:binding,error:bindingError}=await admin.from("claudia_qq_bindings")
  .select("id,status,character_id,conversation_id").eq("id",body.bindingId).eq("user_id",auth.user.id).maybeSingle();
 if(bindingError||!binding)return json(404,{error:"binding_not_found"});
 if(body.action==="context-version"){
  const {data,error}=await admin.from("claudia_qq_context_snapshots").select("revision").eq("binding_id",binding.id).eq("user_id",auth.user.id).maybeSingle();
  if(error)return json(503,{error:"context_read_failed"});
  return json(200,{ok:true,revision:data?.revision??null});
 }
 if(body.action==="sync-context-v2"){
  if(binding.status!=="connected")return json(409,{error:"qq_not_connected"});
  if(body.expectedRevision!==null&&(typeof body.expectedRevision!=="string"||!uuid.test(body.expectedRevision)))return json(400,{error:"invalid_revision"});
  const {data:old,error:readError}=await admin.from("claudia_qq_context_snapshots").select("revision,context_messages,context_data").eq("binding_id",binding.id).eq("user_id",auth.user.id).maybeSingle();
  if(readError)return json(503,{error:"context_read_failed"});
  if(typeof body.requestId!=="string"||!uuid.test(body.requestId))return json(400,{error:"invalid_request_id"});
  if(old?.revision===body.requestId)return json(200,{ok:true,revision:old.revision});
  if((old?.revision??null)!==body.expectedRevision)return json(409,{error:"context_conflict"});
  let messages;let data:Record<string,unknown>;
  try{
   messages=applyContextPatch(old?.context_messages??[],body.patch as any);
   data={...(body.metadata as object),documents:applyDocumentPatch(body.replaceDocuments===true?[]:old?.context_data?.documents??[],body.documents as any)};
  }catch{return json(400,{error:"invalid_context_patch"});}
  if(!validContext(messages)||!validContextData(data)||data.characterId!==binding.character_id)return json(400,{error:"invalid_context"});
  // conversation IDs can change after an owner-authenticated stable-ID restore.
  // The client still proves Daily + character ownership locally; never accept a World payload.
  const revision=body.requestId;
  const {data:accepted,error}=await admin.rpc("claudia_qq_commit_context",{p_binding_id:binding.id,p_user_id:auth.user.id,p_expected_revision:body.expectedRevision,p_revision:revision,p_messages:messages,p_data:data});
  if(error)return json(503,{error:"context_commit_failed"});
  if(!accepted)return json(409,{error:"context_conflict"});
  return json(200,{ok:true,revision});
 }
 if(body.action==="sync-context"){
  // Existing clients can still seed a legacy snapshot, but may never downgrade v2 memory data.
  if(!validContext(body.contextMessages))return json(400,{error:"invalid_context"});
  const {data:old,error:readError}=await admin.from("claudia_qq_context_snapshots").select("revision,context_data").eq("binding_id",binding.id).eq("user_id",auth.user.id).maybeSingle();
  if(readError)return json(503,{error:"context_read_failed"});
  if(old?.context_data)return json(409,{error:"context_protocol_upgrade_required"});
  const {data:accepted,error}=await admin.rpc("claudia_qq_commit_context",{p_binding_id:binding.id,p_user_id:auth.user.id,p_expected_revision:old?.revision??null,p_revision:crypto.randomUUID(),p_messages:body.contextMessages,p_data:null});
  if(error)return json(503,{error:"context_commit_failed"});
  return accepted?json(200,{ok:true}):json(409,{error:"context_conflict"});
 }

 if(body.action==="delete-context"){
  const {error}=await admin.from("claudia_qq_context_snapshots").delete()
   .eq("binding_id",binding.id).eq("user_id",auth.user.id);
  if(error)return json(500,{error:"context_delete_failed"});
  return json(200,{ok:true,deleted:true});
 }
 if(body.action==="status"){
  const {data:profile,error}=await admin.from("claudia_qq_ai_profiles")
   .select("enabled,model,endpoint,updated_at").eq("binding_id",binding.id).maybeSingle();
  if(error)return json(500,{error:"profile_lookup_failed"});
  return json(200,{ok:true,configured:!!profile,enabled:profile?.enabled===true,
   model:profile?.model??null,endpoint:profile?.endpoint??null});
 }
 if(body.action==="disable"){
  const {error}=await admin.from("claudia_qq_ai_profiles").update({enabled:false,
   updated_at:new Date().toISOString()}).eq("binding_id",binding.id).eq("user_id",auth.user.id);
  if(error)return json(500,{error:"disable_failed"});
  return json(200,{ok:true,enabled:false});
 }
 if(body.action==="delete"){
  const {error:contextError}=await admin.from("claudia_qq_context_snapshots").delete()
   .eq("binding_id",binding.id).eq("user_id",auth.user.id);
  if(contextError)return json(500,{error:"context_delete_failed"});
  const {error}=await admin.from("claudia_qq_ai_profiles").delete()
   .eq("binding_id",binding.id).eq("user_id",auth.user.id);
  if(error)return json(500,{error:"delete_failed"});
  return json(200,{ok:true,configured:false,enabled:false});
 }
 if(body.action!=="authorize")return json(400,{error:"invalid_action"});
 if(binding.status!=="connected")return json(409,{error:"qq_not_connected"});
 const {systemPrompt,model,endpoint,apiKey}=body;
 if(typeof systemPrompt!=="string"||systemPrompt.trim().length<1||systemPrompt.length>24000||
    typeof model!=="string"||!model.trim()||model.length>128||
    !validEndpoint(endpoint)||typeof apiKey!=="string"||apiKey.length<8||apiKey.length>4096)
  return json(400,{error:"invalid_ai_profile"});
 try{
  const cipher=await encrypt(apiKey,encryption);
  const {error}=await admin.from("claudia_qq_ai_profiles").upsert({
   binding_id:binding.id,user_id:auth.user.id,system_prompt:systemPrompt,
   model,endpoint,api_key_ciphertext:cipher,enabled:true,
   updated_at:new Date().toISOString()},{onConflict:"binding_id"});
  if(error)return json(500,{error:"profile_save_failed"});
  return json(200,{ok:true,configured:true,enabled:true});
 }catch{return json(503,{error:"encryption_unavailable"});}
});
