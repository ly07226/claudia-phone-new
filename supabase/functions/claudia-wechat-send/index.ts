import {assertOutboundOwnership} from "../_shared/outbound-ownership.mjs";
// Trusted server-only outbound sender. Invoked by an external scheduler/worker,
// NEVER by a browser. Each invocation claims at most one generated reply.
// Unknown outcomes are quarantined, never automatically retried.
import {createClient} from "npm:@supabase/supabase-js@2";
const json=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{
 status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const bytes=(text:string)=>new TextEncoder().encode(text);
async function authorize(got:string,expected:string){
 const [a,b]=await Promise.all([crypto.subtle.digest("SHA-256",bytes(got)),crypto.subtle.digest("SHA-256",bytes(expected))]);
 return new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i]);
}
async function decrypt(value:string,rawKey:string){
 const raw=Uint8Array.from(atob(rawKey),c=>c.charCodeAt(0));
 if(raw.length!==32)throw Error("invalid_key");
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
 const [nonce,cipher]=value.split(".");
 if(!nonce||!cipher)throw Error("invalid_cipher");
 const iv=Uint8Array.from(atob(nonce),c=>c.charCodeAt(0));
 const data=Uint8Array.from(atob(cipher),c=>c.charCodeAt(0));
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv},key,data));
}
Deno.serve(async request=>{
 if(request.method!=="POST")return json(405,{error:"method_not_allowed"});
 const secret=Deno.env.get("WECHAT_BRIDGE_WORKER_SECRET")||"";
 const auth=request.headers.get("Authorization")||"";
 if(secret.length<32||!auth.startsWith("Bearer ")||!(await authorize(auth.slice(7),secret)))
  return json(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 const encryptionKey=Deno.env.get("WECHAT_ILINK_ENCRYPTION_KEY");
 if(!url||!serviceKey||!encryptionKey)return json(503,{error:"not_configured"});
 const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 // Claim only after route and credentials exist, to avoid consuming work prematurely.
 const {data:ready,error:readyError}=await db.from("claudia_wechat_messages")
  .select("id,binding_id,in_reply_to,claudia_wechat_bindings!inner(status)")
  .eq("direction","outbound").eq("status","generated").not("in_reply_to","is",null)
  .order("received_at",{ascending:true}).limit(1);
 if(readyError)return json(500,{error:"outbox_lookup_failed"});
 if(!ready?.length)return json(200,{ok:true,status:"idle"});
 const first=ready[0];
 const {data:inbound}=await db.from("claudia_wechat_messages")
  .select("ilink_peer_ciphertext,ilink_context_ciphertext")
  .eq("id",first.in_reply_to).eq("direction","inbound").maybeSingle();
 const {data:credentials}=await db.from("claudia_wechat_credentials")
  .select("bot_token_ciphertext,api_base_url").eq("binding_id",first.binding_id).maybeSingle();
 if(!inbound?.ilink_peer_ciphertext||!inbound?.ilink_context_ciphertext||!credentials?.bot_token_ciphertext)
  return json(409,{error:"missing_verified_ilink_route",outboundId:first.id});
 const workerId=crypto.randomUUID();
 const {data:claimed,error:claimError}=await db.rpc("claudia_wechat_claim_outbound",{
  p_worker_id:workerId,p_lease_seconds:120});
 if(claimError)return json(500,{error:"outbox_claim_failed"});
 const row=claimed?.[0];
 if(!row)return json(200,{ok:true,status:"idle"});
 // Another worker may have claimed a different row: never send without its route.
 const {data:reply}=await db.from("claudia_wechat_messages")
  .select("in_reply_to").eq("id",row.id).single();
 const {data:source}=await db.from("claudia_wechat_messages")
  .select("ilink_peer_ciphertext,ilink_context_ciphertext")
  .eq("id",reply?.in_reply_to??"").maybeSingle();
 const {data:bot}=await db.from("claudia_wechat_credentials")
  .select("bot_token_ciphertext,api_base_url").eq("binding_id",row.binding_id).maybeSingle();
 let sent=false,errorCode="send_result_unknown";
 try{
  if(!source?.ilink_peer_ciphertext||!source?.ilink_context_ciphertext||!bot?.bot_token_ciphertext)
   throw Error("missing_verified_ilink_route");
  // Fail closed: the claimed reply, source message and binding must have the same owner.
  // The service-role client bypasses RLS, so checking binding_id alone is insufficient.
  const {data:outboundOwner,error:outboundOwnerError}=await db.from("claudia_wechat_messages")
   .select("id,user_id,binding_id,in_reply_to").eq("id",row.id).eq("binding_id",row.binding_id).maybeSingle();
  const {data:sourceOwner,error:sourceOwnerError}=await db.from("claudia_wechat_messages")
   .select("id,user_id,binding_id,direction").eq("id",outboundOwner?.in_reply_to??"").maybeSingle();
  const {data:bindingOwner,error:bindingOwnerError}=await db.from("claudia_wechat_bindings")
   .select("id,user_id").eq("id",row.binding_id).maybeSingle();
  if(outboundOwnerError||sourceOwnerError||bindingOwnerError)throw Error("cross_owner_route_denied");
  assertOutboundOwnership({outbound:outboundOwner,source:sourceOwner,binding:bindingOwner,expectedBindingId:row.binding_id});
  // Recheck consent after claiming and immediately before network delivery.
  // Disabling or deleting a profile must prevent any new send attempt.
  const {data:permission,error:permissionError}=await db.from("claudia_wechat_ai_profiles")
   .select("enabled").eq("binding_id",row.binding_id).maybeSingle();
  const {data:snapshot,error:snapshotError}=await db.from("claudia_wechat_context_snapshots")
   .select("revision").eq("binding_id",row.binding_id).maybeSingle();
  const {data:bound,error:boundError}=await db.from("claudia_wechat_bindings")
   .select("status").eq("id",row.binding_id).maybeSingle();
  if(permissionError||boundError||snapshotError||!snapshot||permission?.enabled!==true||bound?.status!=="connected")
   throw Error("cloud_ai_authorization_revoked");
  const [peer,context,token]=await Promise.all([
   decrypt(source.ilink_peer_ciphertext,encryptionKey),
   decrypt(source.ilink_context_ciphertext,encryptionKey),
   decrypt(bot.bot_token_ciphertext,encryptionKey)]);
  if(!peer||!context||!token)throw Error("invalid_verified_route");
  const base=bot.api_base_url;
  if(typeof base!=="string"||!/^https:\/\/[a-z0-9.-]+\.weixin\.qq\.com\/?$/i.test(base))
   throw Error("invalid_ilink_base");
  const response=await fetch(base.replace(/\/$/,"")+"/ilink/bot/sendmessage",{
   method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token,
    "AuthorizationType":"ilink_bot_token","X-WECHAT-UIN":btoa(String(Math.floor(Math.random()*4294967296)))},
   body:JSON.stringify({msg:{from_user_id:"",to_user_id:peer,client_id:"claudia-wechat:"+row.id,
    message_type:2,message_state:2,context_token:context,
    item_list:[{type:1,text_item:{text:row.body}}]},
    base_info:{channel_version:"1.0.0"}}),
   signal:AbortSignal.timeout(45000)
  });
  const payload=await response.json() as Record<string,unknown>;
  // A successful HTTP status alone is not a confirmed WeChat delivery.
  // Missing/unknown ret is quarantined rather than acknowledged as sent.
  const accepted=response.ok&&payload.ret===0&&(payload.errcode===undefined||payload.errcode===0);
  // iLink acceptance is NOT proof of delivery to the WeChat client.
  // Quarantine the outcome without retrying; only a real delivery receipt may set sent=true.
  sent=false;
  errorCode=accepted?"ilink_delivery_unverified":"ilink_not_confirmed";
  // Log only non-sensitive receipt metadata, never the message or credentials.
  console.info("wechat_send_receipt",JSON.stringify({outboundId:row.id,httpStatus:response.status,ret:typeof payload.ret==="number"?payload.ret:null,errcode:typeof payload.errcode==="number"?payload.errcode:null,accepted,deliveryConfirmed:false,hasMessageId:typeof payload.message_id==="string"&&payload.message_id.length>0||typeof payload.message_id==="number",hasErrmsg:typeof payload.errmsg==="string"&&payload.errmsg.length>0,routePresent:!!peer&&!!context,contextLength:context.length}));
 }catch(error){
  console.warn("wechat_send_unconfirmed",JSON.stringify({outboundId:row.id,kind:error instanceof Error&&error.name==="TimeoutError"?"timeout":"request_or_route_error"}));
  errorCode=error instanceof Error&&["missing_verified_ilink_route","cloud_ai_authorization_revoked"].includes(error.message)?
   error.message:"send_result_unknown";
 }
 const {data:ack,error:ackError}=await db.rpc("claudia_wechat_ack_outbound",{
  p_outbound_id:row.id,p_worker_id:workerId,p_expected_lease_until:row.lease_until,
  p_confirmed_sent:sent,p_error_code:sent?null:errorCode
 });
 if(ackError||ack!==true)return json(500,{error:"delivery_receipt_uncommitted"});
 return json(200,{ok:true,status:sent?"sent":"unknown",outboundId:row.id});
});
