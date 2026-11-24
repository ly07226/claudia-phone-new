import {splitQqReply} from '../_shared/qqReply.mjs';
import {prepareQqRequestContext,recallTerms} from '../_shared/qqContext.mjs';
// Trusted QQ AI processor. Invoked by the existing Railway QQ bridge, never the browser.
import {createClient} from "npm:@supabase/supabase-js@2";
const reply=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
async function decrypt(value:string,raw:string){
 const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
 if(bytes.length!==32)throw Error("encryption_not_configured");
 const key=await crypto.subtle.importKey("raw",bytes,"AES-GCM",false,["decrypt"]);
 const [nonce,cipher]=value.split(".");
 if(!nonce||!cipher)throw Error("invalid_ciphertext");
 const iv=Uint8Array.from(atob(nonce),c=>c.charCodeAt(0));
 const data=Uint8Array.from(atob(cipher),c=>c.charCodeAt(0));
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv},key,data));
}
function endpointAllowed(value:string){
 try{
  const u=new URL(value),host=u.hostname.toLowerCase().replace(/\.$/,"");
  return u.protocol==="https:"&&!u.username&&!u.password&&!u.hash&&!u.search&&!u.port&&
   u.pathname.endsWith("/chat/completions")&&host.includes(".")&&
   !host.endsWith(".local")&&!host.endsWith(".internal")&&!/^\[/.test(host)&&
   !/^\d+(?:\.\d+){3}$/.test(host);
 }catch{return false;}
}
/** Lossless chat-bubble boundaries; punctuation-only lines remain separate.
 * Keep original text for memory while outbound rows carry ordered fragments.
 */

Deno.serve(async req=>{
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const secret=Deno.env.get("QQ_QR_ACCESS_TOKEN")||"";
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer /,"");
 if(secret.length<32||token.length!==secret.length||!crypto.subtle)return reply(401,{error:"unauthorized"});
 const a=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
 if(!new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i]))return reply(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),encryption=Deno.env.get("WECHAT_ILINK_ENCRYPTION_KEY");
 if(!url||!service||!encryption)return reply(503,{error:"not_configured"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:ready,error:lookupError}=await db.from("claudia_qq_messages").select("binding_id")
  .eq("direction","inbound").eq("status","received").order("received_at",{ascending:true}).limit(20);
 if(lookupError)return reply(500,{error:"lookup_failed"});
 for(const candidate of ready||[]){
  const {data:rows,error:claimError}=await db.rpc("claudia_qq_claim_inbound",{p_binding_id:candidate.binding_id,p_lease_seconds:240});
  if(claimError)return reply(500,{error:"claim_failed"});
  const row=rows?.[0];if(!row)continue;
  let generated:string|null=null,reason:string|null=null;
  try{
   const [p,s,h]=await Promise.all([
    db.from("claudia_qq_ai_profiles").select("user_id,model,endpoint,api_key_ciphertext").eq("binding_id",row.binding_id).eq("enabled",true).maybeSingle(),
    db.from("claudia_qq_context_snapshots").select("user_id,context_messages,context_data").eq("binding_id",row.binding_id).maybeSingle(),
    db.rpc("claudia_qq_history_context",{p_user_id:row.user_id,p_binding_id:row.binding_id,p_before:row.received_at,p_before_id:row.id,p_terms:recallTerms(row.body)})
   ]);
   if(p.error)throw Error("profile_read_failed");
   if(s.error)throw Error("snapshot_read_failed");
   if(h.error)throw Error("history_read_failed");
   if(!p.data||!s.data||p.data.user_id!==row.user_id||s.data.user_id!==row.user_id)throw Error("profile_or_context_missing");
   // Service-role bypasses RLS: never combine a claimed message with a binding from another owner.
   const {data:ownerBinding,error:ownerError}=await db.from("claudia_qq_bindings")
    .select("id,user_id,conversation_id,character_id").eq("id",row.binding_id).eq("user_id",row.user_id).maybeSingle();
   if(ownerError||!ownerBinding)throw Error("binding_not_owned");
   const profile=p.data,snapshot=s.data;
   if(snapshot.context_data&&snapshot.context_data.characterId!==ownerBinding.character_id)throw Error("context_binding_mismatch");
   if(!endpointAllowed(profile.endpoint))throw Error("invalid_endpoint");
   if(!Array.isArray(snapshot.context_messages)||!snapshot.context_messages.some((m:any)=>m?.role==="system"))throw Error("invalid_context");
   const effective=await prepareQqRequestContext(snapshot.context_messages,snapshot.context_data??null,h.data?.recent??[],h.data?.recalled??[],row.body);
   const apiKey=await decrypt(profile.api_key_ciphertext,encryption);
   const response=await fetch(profile.endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},
    body:JSON.stringify({model:profile.model,messages:effective,stream:false}),
    signal:AbortSignal.timeout(120000)});
   if(!response.ok)throw Error("model_http_"+response.status);
   const result=await response.json(),value=result?.choices?.[0]?.message?.content;
   if(typeof value!=="string"||!value.trim()||value.length>8000||result?.choices?.[0]?.finish_reason!=="stop")throw Error("invalid_model_reply");
   generated=value.trim();
  }catch(error){
   const raw=error instanceof Error?error.message:"generation_failed";
   reason=/^(model_http_\d+|invalid_model_reply|invalid_context|invalid_endpoint|profile_or_context_missing|profile_read_failed|snapshot_read_failed|history_read_failed|binding_not_owned|context_binding_mismatch|invalid_ciphertext)$/.test(raw)?raw:"generation_failed";
   console.warn("qq_ai_generation_failed",row.id,reason);
  }
  const {data:finished,error:finishError}=await db.rpc("claudia_qq_finish_generation",{p_inbound_id:row.id,p_expected_lease_until:row.lease_until,p_reply_body:generated,p_error_code:reason,p_parts:generated?splitQqReply(generated):null});
  if(finishError)return reply(500,{error:"finish_failed"});
  return reply(200,{ok:true,status:finished?"processed":"stale",generated:!!generated});
 }
 return reply(200,{ok:true,status:"idle"});
});
