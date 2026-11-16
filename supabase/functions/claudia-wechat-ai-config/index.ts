// Owner-authenticated cloud AI authorization. The API key is only accepted
// on an explicit user action and encrypted before service-role storage.
import {createClient} from "npm:@supabase/supabase-js@2";
const allowedOrigin=Deno.env.get("CLAUDIA_APP_ORIGIN")||"";
const headers={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin",
 "Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers});
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
  // Initial release deliberately restricts providers to avoid SSRF.
  return ["api.openai.com","generativelanguage.googleapis.com","openrouter.ai"].includes(u.hostname)
   &&u.pathname.endsWith("/chat/completions");
 }catch{return false;}
}
Deno.serve(async req=>{
 if(!allowedOrigin||req.headers.get("Origin")!==allowedOrigin)return json(403,{error:"origin_denied"});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
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
  const raw=await req.text();if(raw.length>35000)throw Error();
  body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw Error();
 }catch{return json(400,{error:"invalid_request"});}
 if(typeof body.bindingId!=="string"||!uuid.test(body.bindingId))
  return json(400,{error:"invalid_binding"});
 const {data:binding,error:bindingError}=await admin.from("claudia_wechat_bindings")
  .select("id,status").eq("id",body.bindingId).eq("user_id",auth.user.id).maybeSingle();
 if(bindingError||!binding)return json(404,{error:"binding_not_found"});
 if(body.action==="status"){
  const {data:profile,error}=await admin.from("claudia_wechat_ai_profiles")
   .select("enabled,model,endpoint,updated_at").eq("binding_id",binding.id).maybeSingle();
  if(error)return json(500,{error:"profile_lookup_failed"});
  return json(200,{ok:true,configured:!!profile,enabled:profile?.enabled===true,
   model:profile?.model??null,endpoint:profile?.endpoint??null});
 }
 if(body.action==="disable"){
  const {error}=await admin.from("claudia_wechat_ai_profiles").update({enabled:false,
   updated_at:new Date().toISOString()}).eq("binding_id",binding.id).eq("user_id",auth.user.id);
  if(error)return json(500,{error:"disable_failed"});
  return json(200,{ok:true,enabled:false});
 }
 if(body.action==="delete"){
  const {error}=await admin.from("claudia_wechat_ai_profiles").delete()
   .eq("binding_id",binding.id).eq("user_id",auth.user.id);
  if(error)return json(500,{error:"delete_failed"});
  return json(200,{ok:true,configured:false,enabled:false});
 }
 if(body.action!=="authorize")return json(400,{error:"invalid_action"});
 if(binding.status!=="connected")return json(409,{error:"wechat_not_connected"});
 const {systemPrompt,model,endpoint,apiKey}=body;
 if(typeof systemPrompt!=="string"||systemPrompt.trim().length<1||systemPrompt.length>24000||
    typeof model!=="string"||!model.trim()||model.length>128||
    !validEndpoint(endpoint)||typeof apiKey!=="string"||apiKey.length<8||apiKey.length>4096)
  return json(400,{error:"invalid_ai_profile"});
 try{
  const cipher=await encrypt(apiKey,encryption);
  const {error}=await admin.from("claudia_wechat_ai_profiles").upsert({
   binding_id:binding.id,user_id:auth.user.id,system_prompt:systemPrompt,
   model,endpoint,api_key_ciphertext:cipher,enabled:true,
   updated_at:new Date().toISOString()},{onConflict:"binding_id"});
  if(error)return json(500,{error:"profile_save_failed"});
  return json(200,{ok:true,configured:true,enabled:true});
 }catch{return json(503,{error:"encryption_unavailable"});}
});
