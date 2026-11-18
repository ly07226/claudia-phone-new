// Trusted QQ Railway connector -> owner-scoped Supabase credential confirmation.
// This endpoint never accepts an owner ID from the bridge; it resolves owner from a stored attempt.
import {createClient} from "npm:@supabase/supabase-js@2";
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bytes=(v:string)=>new TextEncoder().encode(v);
async function eq(a:string,b:string){const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",bytes(a)),crypto.subtle.digest("SHA-256",bytes(b))]);return new Uint8Array(x).every((v,i)=>v===new Uint8Array(y)[i]);}
async function seal(value:string,secret:string){
 const raw=Uint8Array.from(atob(secret),c=>c.charCodeAt(0));if(raw.length!==32)throw Error("invalid_encryption_key");
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,bytes(value)));
 const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v));
 return b64(iv)+"."+b64(cipher);
}
Deno.serve(async req=>{
 if(req.method!=="POST")return json(405,{error:"method_not_allowed"});
 const token=Deno.env.get("QQ_QR_ACCESS_TOKEN")||"";
 const authorization=req.headers.get("Authorization")||"";
 if(token.length<32||!authorization.startsWith("Bearer ")||!(await eq(authorization.slice(7),token)))return json(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),encryption=Deno.env.get("WECHAT_ILINK_ENCRYPTION_KEY");
 if(!url||!key||!encryption)return json(503,{error:"not_configured"});
 let body:Record<string,unknown>;
 try{const raw=await req.text();if(raw.length>16000)throw Error();body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw Error();}
 catch{return json(400,{error:"invalid_json"});}
 const {bridgeAttemptId,credentials}=body;
 if(typeof bridgeAttemptId!=="string"||!uuid.test(bridgeAttemptId)||!Array.isArray(credentials)||credentials.length!==1||
    typeof credentials[0]?.appId!=="string"||!credentials[0].appId||credentials[0].appId.length>256||
    typeof credentials[0]?.appSecret!=="string"||!credentials[0].appSecret||credentials[0].appSecret.length>4096)
   return json(400,{error:"invalid_credentials"});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:attempt,error:lookupError}=await db.from("claudia_qq_login_attempts").select("*").eq("bridge_attempt_id",bridgeAttemptId).maybeSingle();
 if(lookupError)return json(500,{error:"attempt_lookup_failed"});
 if(!attempt||Date.parse(attempt.expires_at)<Date.now()||attempt.status==="connected")return json(409,{error:"attempt_unavailable"});
 try{
  const {data:binding,error:bindingError}=await db.from("claudia_qq_bindings").upsert({
   user_id:attempt.user_id,conversation_id:attempt.conversation_id,character_id:attempt.character_id,
   status:"pending",updated_at:new Date().toISOString()
  },{onConflict:"user_id,conversation_id"}).select("id").single();
  if(bindingError||!binding)return json(500,{error:"binding_write_failed"});
  const {error:credentialError}=await db.from("claudia_qq_credentials").upsert({
   binding_id:binding.id,app_id_ciphertext:await seal(credentials[0].appId,encryption),
   app_secret_ciphertext:await seal(credentials[0].appSecret,encryption)
  },{onConflict:"binding_id"});
  if(credentialError)return json(500,{error:"credential_write_failed"});
  const {error:statusError}=await db.from("claudia_qq_bindings").update({status:"connected",updated_at:new Date().toISOString()}).eq("id",binding.id);
  if(statusError)return json(500,{error:"binding_confirm_failed"});
  await db.from("claudia_qq_login_attempts").update({status:"connected"}).eq("id",attempt.id);
  return json(200,{ok:true,bindingId:binding.id});
 }catch{return json(503,{error:"encryption_or_storage_unavailable"});}
});
