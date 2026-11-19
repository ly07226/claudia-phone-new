// QQ owner-scoped QR gateway, patterned after claudia-wechat-login.
// The Railway bridge is never called directly from the browser.
import {createClient} from "npm:@supabase/supabase-js@2";
const trusted=new Set([Deno.env.get("CLAUDIA_APP_ORIGIN"),"https://claudia-phone-new.vercel.app"].filter(Boolean));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async request=>{
 const origin=request.headers.get("Origin")||"";
 const headers={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin","Access-Control-Allow-Origin":origin,
 "Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
 const send=(code:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status:code,headers});
 if(!trusted.has(origin))return send(403,{error:"origin_denied"});
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(request.method!=="POST")return send(405,{error:"method_not_allowed"});
 const bearer=request.headers.get("Authorization")||"";
 if(!bearer.startsWith("Bearer "))return send(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!secret)return send(503,{error:"not_configured"});
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await admin.auth.getUser(bearer.slice(7));
 if(authError||!auth.user)return send(401,{error:"unauthorized"});
 let body:Record<string,unknown>;
 try{const raw=await request.text();if(raw.length>2048)throw Error();body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw Error();}
 catch{return send(400,{error:"invalid_request"});}
 const action=body.action;
 if(action==="list-bindings"){
  const {data,error}=await admin.from("claudia_qq_bindings").select("id,character_id,conversation_id,status,created_at,updated_at")
   .eq("user_id",auth.user.id).order("created_at",{ascending:false}).limit(100);
  return error?send(500,{error:"binding_list_failed"}):send(200,{ok:true,bindings:data??[]});
 }
 if(action==="disconnect"){
  if(typeof body.bindingId!=="string"||!uuid.test(body.bindingId))return send(400,{error:"invalid_binding"});
  const {data:binding}=await admin.from("claudia_qq_bindings").select("id").eq("id",body.bindingId).eq("user_id",auth.user.id).maybeSingle();
  if(!binding)return send(404,{error:"binding_not_found"});
  // Revoke credentials and disable AI before marking disconnected.
  const {error:e1}=await admin.from("claudia_qq_credentials").delete().eq("binding_id",binding.id);
  const {error:e2}=await admin.from("claudia_qq_ai_profiles").update({enabled:false,api_key_ciphertext:null}).eq("binding_id",binding.id).eq("user_id",auth.user.id);
  if(e1||e2)return send(500,{error:"disconnect_failed"});
  const {error:e3}=await admin.from("claudia_qq_bindings").update({status:"disconnected",updated_at:new Date().toISOString()}).eq("id",binding.id).eq("user_id",auth.user.id);
  return e3?send(500,{error:"disconnect_failed"}):send(200,{ok:true});
 }
 if(action!=="start"&&action!=="poll")return send(400,{error:"invalid_action"});
 const bridge=Deno.env.get("QQ_QR_BRIDGE_URL"),token=Deno.env.get("QQ_QR_ACCESS_TOKEN");
 if(!bridge||!/^https:\/\/[a-z0-9.-]+\.up\.railway\.app$/i.test(bridge)||!token)return send(503,{error:"bridge_not_configured"});
 const call=async(path:string,method:"GET"|"POST")=>{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetch(bridge+path,{method,headers:{Origin:"https://claudia-phone-new.vercel.app",Authorization:"Bearer "+token},signal:controller.signal});
   if(!response.ok)throw Error("bridge_http_"+response.status);
   return await response.json() as Record<string,unknown>;
  }finally{clearTimeout(timeout);}
 };
 try{
  if(action==="start"){
   const conversationId=body.conversationId,characterId=body.characterId;
   if(typeof conversationId!=="string"||!conversationId||conversationId.length>128||
      typeof characterId!=="string"||!characterId||characterId.length>128)return send(400,{error:"invalid_daily_target"});
   const {data:existing}=await admin.from("claudia_qq_bindings").select("status").eq("user_id",auth.user.id).eq("conversation_id",conversationId).maybeSingle();
   // Reauthorization is allowed for an existing owner-scoped binding. Keep the\n   // original binding and AI profile active until a fresh QR is confirmed.\n   // A failed or expired attempt must not revoke the previous credentials.
   const qr=await call("/qq/qr/start","POST");
   if(typeof qr.attemptId!=="string"||!uuid.test(qr.attemptId))return send(502,{error:"invalid_bridge_response"});
   const expiry=typeof qr.expiresAt==="string"?Date.parse(qr.expiresAt):NaN;
   if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+15*60000)return send(502,{error:"invalid_expiry"});
   const {data:attempt,error}=await admin.from("claudia_qq_login_attempts").upsert({
    user_id:auth.user.id,conversation_id:conversationId,character_id:characterId,bridge_attempt_id:qr.attemptId,
    status:"waiting",expires_at:new Date(expiry).toISOString()
   },{onConflict:"user_id,conversation_id"}).select("id").single();
   if(error||!attempt)return send(500,{error:"attempt_write_failed"});
   return send(200,{ok:true,attemptId:attempt.id,status:"waiting",qrContent:typeof qr.qrContent==="string"?qr.qrContent:null,expiresAt:new Date(expiry).toISOString()});
  }
  if(typeof body.attemptId!=="string"||!uuid.test(body.attemptId))return send(400,{error:"invalid_attempt"});
  const {data:attempt}=await admin.from("claudia_qq_login_attempts").select("*").eq("id",body.attemptId).eq("user_id",auth.user.id).maybeSingle();
  if(!attempt)return send(404,{error:"attempt_not_found"});
  if(Date.parse(attempt.expires_at)<=Date.now())return send(200,{ok:true,status:"expired",attemptId:attempt.id,qrContent:null,expiresAt:attempt.expires_at});
  if(!attempt.bridge_attempt_id)return send(502,{error:"bridge_attempt_missing"});
  const qr=await call("/qq/qr/"+attempt.bridge_attempt_id,"GET");
  const status=typeof qr.status==="string"?qr.status:"failed";
  if(!["waiting","refreshing","failed","expired","storage_not_configured","confirming","connected"].includes(status))return send(502,{error:"invalid_bridge_status"});
  if(status==="connected"){
   // Never mark connected on a bridge status alone: credential storage and owner association must complete first.
   const {data:binding}=await admin.from("claudia_qq_bindings").select("id,status").eq("user_id",auth.user.id).eq("conversation_id",attempt.conversation_id).maybeSingle();
   if(binding?.status!=="connected")return send(409,{error:"credential_confirmation_pending"});
  }
  await admin.from("claudia_qq_login_attempts").update({status}).eq("id",attempt.id).eq("user_id",auth.user.id);
  return send(200,{ok:true,attemptId:attempt.id,status,qrContent:typeof qr.qrContent==="string"?qr.qrContent:null,expiresAt:attempt.expires_at});
 }catch{return send(502,{error:"qq_bridge_unavailable"});}
});
