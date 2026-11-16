// Trusted worker -> Supabase ingestion. NOT a public WeChat/iLink webhook.
// Configure verify_jwt=false ONLY for this function and require a strong
// WECHAT_BRIDGE_WORKER_SECRET; never expose it in VITE_* or browser code.
import {createClient} from "npm:@supabase/supabase-js@2";

const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{
 status,headers:{"content-type":"application/json","cache-control":"no-store"}
});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
async function equalSecret(received:string,expected:string):Promise<boolean>{
 const [a,b]=await Promise.all([crypto.subtle.digest("SHA-256",encoder.encode(received)),crypto.subtle.digest("SHA-256",encoder.encode(expected))]);
 return new Uint8Array(a).every((byte,i)=>byte===new Uint8Array(b)[i]);
}
Deno.serve(async request=>{
 if(request.method!=="POST")return json(405,{error:"method_not_allowed"});
 const secret=Deno.env.get("WECHAT_BRIDGE_WORKER_SECRET")||"";
 const url=Deno.env.get("SUPABASE_URL")||"";
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(secret.length<32||!url||!key)return json(503,{error:"not_configured"});
 const auth=request.headers.get("Authorization")||"";
 if(!auth.startsWith("Bearer ")||!(await equalSecret(auth.slice(7),secret)))
   return json(401,{error:"unauthorized"});
 if(Number(request.headers.get("content-length")||0)>12000)return json(413,{error:"payload_too_large"});
 let payload:Record<string,unknown>;
 try{
   const raw=await request.text();
   if(raw.length>12000)return json(413,{error:"payload_too_large"});
   const value:unknown=JSON.parse(raw);
   if(!value||typeof value!=="object"||Array.isArray(value))throw Error();
   payload=value as Record<string,unknown>;
 }catch{return json(400,{error:"invalid_json"});}
 const {bindingId,externalMessageId,text}=payload;
 if(typeof bindingId!=="string"||!uuid.test(bindingId)||
    typeof externalMessageId!=="string"||externalMessageId.length<1||externalMessageId.length>256||
    typeof text!=="string"||!text.trim()||text.length>8000)
   return json(400,{error:"invalid_event"});
 // The trusted worker MUST first verify the iLink event and resolve the
 // account-specific binding. A caller-provided owner ID is never trusted.
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:binding,error:bindingError}=await admin.from("claudia_wechat_bindings")
   .select("id,user_id,status").eq("id",bindingId).maybeSingle();
 if(bindingError)return json(500,{error:"binding_lookup_failed"});
 if(!binding||binding.status!=="connected")return json(404,{error:"binding_not_connected"});
 const {data:id,error}=await admin.rpc("claudia_wechat_receive_text",{
   p_user_id:binding.user_id,p_binding_id:binding.id,
   p_external_message_id:externalMessageId,p_body:text
 });
 if(error||typeof id!=="string")return json(500,{error:"message_ingest_failed"});
 return json(202,{ok:true,messageId:id});
});
