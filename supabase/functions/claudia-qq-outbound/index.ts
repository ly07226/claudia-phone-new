import {assertOutboundOwnership} from "../_shared/outbound-ownership.mjs";
// Server-to-server QQ outbound queue API; bot credentials remain on Railway.
import {createClient} from "npm:@supabase/supabase-js@2";
const json=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
Deno.serve(async req=>{
 if(req.method!=="POST")return json(405,{error:"method_not_allowed"});
 const secret=Deno.env.get("QQ_QR_ACCESS_TOKEN")||"",given=(req.headers.get("Authorization")||"").replace(/^Bearer /,"");
 if(secret.length<32||given.length!==secret.length)return json(401,{error:"unauthorized"});
 const [a,b]=await Promise.all([secret,given].map(x=>crypto.subtle.digest("SHA-256",new TextEncoder().encode(x))));
 if(!new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i]))return json(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json(503,{error:"not_configured"});
 let body;try{body=await req.json();}catch{return json(400,{error:"invalid_request"});}
 if(!body||typeof body.bindingId!=="string"||!/^[0-9a-f-]{36}$/i.test(body.bindingId))return json(400,{error:"invalid_binding"});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 if(body.action==="claim"){
  const {data,error}=await db.rpc("claudia_qq_claim_outbound",{p_binding_id:body.bindingId,p_lease_seconds:90});
  if(error)return json(500,{error:"claim_failed"});
  const row=data?.[0];if(!row)return json(200,{ok:true,status:"idle"});
  // Reject any outbound whose source, binding, and owner do not agree.
  const {data:outbound,error:outboundError}=await db.from("claudia_qq_messages")
   .select("id,user_id,binding_id,in_reply_to").eq("id",row.id).eq("binding_id",row.binding_id).maybeSingle();
  const {data:binding,error:bindingError}=await db.from("claudia_qq_bindings")
   .select("id,user_id").eq("id",row.binding_id).maybeSingle();
  const {data:source,error:sourceError}=await db.from("claudia_qq_messages").select("id,external_message_id,user_id,binding_id,direction")
   .eq("id",row.in_reply_to).eq("binding_id",row.binding_id).eq("direction","inbound").maybeSingle();
  if(outboundError||bindingError||sourceError)return json(409,{error:"cross_owner_route_denied"});
  try{assertOutboundOwnership({outbound,source,binding,expectedBindingId:row.binding_id});}
  catch{return json(409,{error:"cross_owner_route_denied"});}
  if(sourceError||!source?.external_message_id)return json(409,{error:"source_message_missing"});
  return json(200,{ok:true,status:"claimed",message:{id:row.id,body:row.body,routeType:row.route_type,
   routeTarget:row.route_target,replyTo:source.external_message_id,leaseUntil:row.lease_until,msgSeq:row.part_index||1}});
 }
 if(body.action==="finish"){
  if(typeof body.messageId!=="string"||typeof body.leaseUntil!=="string"||typeof body.success!=="boolean")return json(400,{error:"invalid_finish"});
  const {data,error}=await db.rpc("claudia_qq_finish_outbound",{p_outbound_id:body.messageId,
   p_expected_lease_until:body.leaseUntil,p_success:body.success,p_error:typeof body.error==="string"?body.error:"send_failed"});
  return error?json(500,{error:"finish_failed"}):json(200,{ok:true,committed:data===true});
 }
 return json(400,{error:"invalid_action"});
});
