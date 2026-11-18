// Trusted QQ message ingestion. The caller must resolve a real QQ Bot event to a binding.
// Never trust a client-supplied owner id or accept browser calls.
import {createClient} from "npm:@supabase/supabase-js@2";
const json=(status:number,value:Record<string,unknown>)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bytes=(value:string)=>new TextEncoder().encode(value);
async function equal(a:string,b:string){const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",bytes(a)),crypto.subtle.digest("SHA-256",bytes(b))]);return new Uint8Array(x).every((v,i)=>v===new Uint8Array(y)[i]);}
Deno.serve(async req=>{
 if(req.method!=="POST")return json(405,{error:"method_not_allowed"});
 const secret=Deno.env.get("QQ_QR_ACCESS_TOKEN")||"",authorization=req.headers.get("Authorization")||"";
 if(secret.length<32||!authorization.startsWith("Bearer ")||!(await equal(authorization.slice(7),secret)))return json(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json(503,{error:"not_configured"});
 let body:Record<string,unknown>;
 try{const raw=await req.text();if(raw.length>12000)throw Error();body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw Error();}
 catch{return json(400,{error:"invalid_json"});}
 const {bindingId,externalMessageId,text}=body;
 if(typeof bindingId!=="string"||!uuid.test(bindingId)||typeof externalMessageId!=="string"||!externalMessageId||externalMessageId.length>256||typeof text!=="string"||!text.trim()||text.length>8000)return json(400,{error:"invalid_event"});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:binding,error}=await db.from("claudia_qq_bindings").select("id,user_id,status").eq("id",bindingId).maybeSingle();
 if(error)return json(500,{error:"binding_lookup_failed"});
 if(!binding||binding.status!=="connected")return json(404,{error:"binding_not_connected"});
 const {data:credential}=await db.from("claudia_qq_credentials").select("binding_id").eq("binding_id",binding.id).maybeSingle();
 if(!credential)return json(409,{error:"binding_credentials_missing"});
 // Insert-only: retries must never overwrite a previously processed message.
 const {data:row,error:writeError}=await db.from("claudia_qq_messages").insert({
  user_id:binding.user_id,binding_id:binding.id,external_message_id:externalMessageId,
  direction:"inbound",body:text,status:"received"
 }).select("id").single();
 if(writeError?.code==="23505")return json(202,{ok:true,duplicate:true});
 if(writeError||!row)return json(500,{error:"ingest_failed"});
 return json(202,{ok:true,duplicate:false,messageId:row.id});
});
