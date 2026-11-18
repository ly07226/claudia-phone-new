// WeChat iLink QR login: authenticated owner-only start and one-shot status check.
// Never return bot_token, QR polling token, or private credentials to the browser.
import {createClient} from "npm:@supabase/supabase-js@2";
const origin=Deno.env.get("CLAUDIA_APP_ORIGIN")||"";
// Accept only the official production origin and this isolated QA preview.
// A missing optional origin secret must not block authenticated QR login.
const trustedOrigins=new Set([origin,"https://claudia-phone-new.vercel.app","https://claudia-phone-nxya5vllj-2982991953-4231.vercel.app"].filter(Boolean));
function trustedOrigin(request:Request){const candidate=request.headers.get("Origin")||"";return trustedOrigins.has(candidate)?candidate:null;}
const headers={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin",
 "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS"};
const respond=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
const decoder=new TextDecoder();
function b64(data:Uint8Array){return btoa(String.fromCharCode(...data));}
function unb64(data:string){return Uint8Array.from(atob(data),c=>c.charCodeAt(0));}
async function key(){
 const raw=Deno.env.get("WECHAT_ILINK_ENCRYPTION_KEY")||"";
 const bytes=unb64(raw);
 if(bytes.length!==32)throw Error("encryption_key_invalid");
 return crypto.subtle.importKey("raw",bytes,"AES-GCM",false,["encrypt","decrypt"]);
}
async function seal(value:string){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await key(),encoder.encode(value)));
 return b64(iv)+"."+b64(bytes);
}
async function unseal(value:string){
 const [iv,bytes]=value.split(".");
 if(!iv||!bytes)throw Error("ciphertext_invalid");
 return decoder.decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(iv)},await key(),unb64(bytes)));
}
async function ilink(url:string){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),42000);
 try{
  const response=await fetch(url,{headers:{"iLink-App-ClientVersion":"1"},signal:controller.signal});
  if(!response.ok)throw Error("ilink_http_"+response.status);
  const body=await response.json() as Record<string,unknown>;
  if(typeof body.ret==="number"&&body.ret!==0)throw Error("ilink_rejected");
  return body;
 }finally{clearTimeout(timer);}
}
Deno.serve(async request=>{
 const requestOrigin=trustedOrigin(request);
 if(!requestOrigin)return respondWithCors(403,{error:"origin_denied"});
 // CORS is per-request; never send a wildcard with authenticated requests.
 const corsHeaders={...headers,"Access-Control-Allow-Origin":requestOrigin};
 const respondWithCors=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers:corsHeaders});
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});
 if(request.method!=="POST")return respondWithCors(405,{error:"method_not_allowed"});
 const bearer=request.headers.get("Authorization")||"";
 if(!bearer.startsWith("Bearer "))return respondWithCors(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!secret||!Deno.env.get("WECHAT_ILINK_ENCRYPTION_KEY"))
  return respondWithCors(503,{error:"not_configured"});
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await admin.auth.getUser(bearer.slice(7));
 if(authError||!auth.user)return respondWithCors(401,{error:"unauthorized"});
 let body:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(raw.length>2048)throw Error();
  body=JSON.parse(raw);
  if(!body||typeof body!=="object"||Array.isArray(body))throw Error();
 }catch{return respondWithCors(400,{error:"invalid_request"});}
 try{
  if(body.action==="start"){
   const conversationId=body.conversationId,characterId=body.characterId;
   if(typeof conversationId!=="string"||conversationId.length<1||conversationId.length>128||
      typeof characterId!=="string"||characterId.length<1||characterId.length>128)
    return respondWithCors(400,{error:"invalid_daily_target"});
   const {data:existing}=await admin.from("claudia_wechat_bindings").select("id,status")
    .eq("user_id",auth.user.id).eq("conversation_id",conversationId).maybeSingle();
   if(existing?.status==="connected")return respondWithCors(409,{error:"already_connected"});
   const qr=await ilink("https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3");
   if(typeof qr.qrcode!=="string"||!qr.qrcode||qr.qrcode.length>2048||
      typeof qr.qrcode_img_content!=="string"||qr.qrcode_img_content.length>4096)
    return respondWithCors(502,{error:"invalid_ilink_qr"});
   const {data:attempt,error}=await admin.from("claudia_wechat_login_attempts")
    .upsert({user_id:auth.user.id,conversation_id:conversationId,character_id:characterId,
     qr_token_ciphertext:await seal(qr.qrcode),status:"wait",
     expires_at:new Date(Date.now()+5*60000).toISOString()},
     {onConflict:"user_id,conversation_id"}).select("id").single();
   if(error||!attempt)return respondWithCors(500,{error:"login_attempt_failed"});
   return respondWithCors(200,{ok:true,attemptId:attempt.id,qrContent:qr.qrcode_img_content,
    expiresAt:new Date(Date.now()+5*60000).toISOString()});
  }
  if(body.action==="poll"){
   if(typeof body.attemptId!=="string"||!uuid.test(body.attemptId))
    return respondWithCors(400,{error:"invalid_attempt"});
   const {data:attempt}=await admin.from("claudia_wechat_login_attempts")
    .select("*").eq("id",body.attemptId).eq("user_id",auth.user.id).maybeSingle();
   if(!attempt)return respondWithCors(404,{error:"attempt_not_found"});
   if(attempt.status==="confirmed")return respondWithCors(200,{ok:true,status:"confirmed"});
   if(attempt.status==="expired"||Date.parse(attempt.expires_at)<Date.now())
    return respondWithCors(200,{ok:true,status:"expired"});
   const qr=await unseal(attempt.qr_token_ciphertext);
   const state=await ilink("https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode="+encodeURIComponent(qr));
   const status=state.status;
   if(!["wait","scaned","confirmed","expired","need_verifycode","verify_code_blocked",
         "scaned_but_redirect","binded_redirect"].includes(String(status)))
    return respondWithCors(502,{error:"unknown_ilink_status"});
   if(status==="confirmed"){
    if(typeof state.bot_token!=="string"||!state.bot_token||
       typeof state.ilink_bot_id!=="string"||!state.ilink_bot_id)
     return respondWithCors(502,{error:"invalid_ilink_credentials"});
    const api=typeof state.baseurl==="string"?state.baseurl:"https://ilinkai.weixin.qq.com";
    if(!/^https:\/\/[a-z0-9.-]+\.weixin\.qq\.com\/?$/i.test(api)&&
       api!=="https://ilinkai.weixin.qq.com")return respondWithCors(502,{error:"invalid_ilink_base"});
    const {data:binding,error:bindingError}=await admin.from("claudia_wechat_bindings")
     .upsert({user_id:auth.user.id,conversation_id:attempt.conversation_id,
      character_id:attempt.character_id,status:"connected",updated_at:new Date().toISOString()},
      {onConflict:"user_id,conversation_id"}).select("id").single();
    if(bindingError||!binding)return respondWithCors(500,{error:"binding_write_failed"});
    const {error:credentialError}=await admin.from("claudia_wechat_credentials")
     .upsert({binding_id:binding.id,bot_token_ciphertext:await seal(state.bot_token),
      bot_id:state.ilink_bot_id,
      user_identifier_ciphertext:typeof state.ilink_user_id==="string"?await seal(state.ilink_user_id):null,
      api_base_url:api},{onConflict:"binding_id"});
    if(credentialError){
     await admin.from("claudia_wechat_bindings").update({status:"error"}).eq("id",binding.id);
     return respondWithCors(500,{error:"credential_write_failed"});
    }
    await admin.from("claudia_wechat_login_attempts").update({status:"confirmed",qr_token_ciphertext:await seal("consumed")})
     .eq("id",attempt.id).eq("user_id",auth.user.id);
    return respondWithCors(200,{ok:true,status:"confirmed",bindingId:binding.id});
   }
   if(status==="expired"||status==="verify_code_blocked"){
    await admin.from("claudia_wechat_login_attempts").update({status:"expired"})
     .eq("id",attempt.id).eq("user_id",auth.user.id);
   }else if(status==="scaned"||status==="wait"){
    await admin.from("claudia_wechat_login_attempts").update({status})
     .eq("id",attempt.id).eq("user_id",auth.user.id);
   }
   return respondWithCors(200,{ok:true,status});
  }
  return respondWithCors(400,{error:"invalid_action"});
 }catch{return respondWithCors(502,{error:"ilink_or_storage_unavailable"});}
});
