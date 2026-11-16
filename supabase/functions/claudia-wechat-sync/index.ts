// Read-only incremental sync for a single WeChat-bound DAILY conversation.
// Browser access requires Supabase user JWT; never returns iLink credentials.
import {createClient} from "npm:@supabase/supabase-js@2";
const origin=Deno.env.get("CLAUDIA_APP_ORIGIN")||"";
const headers={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin",
 "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(status:number,value:Record<string,unknown>)=>new Response(JSON.stringify(value),{status,headers});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async request=>{
 if(!origin||request.headers.get("Origin")!==origin)return reply(403,{error:"origin_denied"});
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(request.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const bearer=request.headers.get("Authorization")||"";
 if(!bearer.startsWith("Bearer "))return reply(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return reply(503,{error:"not_configured"});
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:identity,error:authError}=await admin.auth.getUser(bearer.slice(7));
 if(authError||!identity.user)return reply(401,{error:"unauthorized"});
 let body:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(raw.length>1024)return reply(413,{error:"payload_too_large"});
  const parsed:unknown=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error();
  body=parsed as Record<string,unknown>;
 }catch{return reply(400,{error:"invalid_json"});}
 if(typeof body.bindingId!=="string"||!uuid.test(body.bindingId)||
    (body.afterId!==undefined&&(typeof body.afterId!=="string"||!uuid.test(body.afterId))))
   return reply(400,{error:"invalid_cursor"});
 const {data:binding,error:bindingError}=await admin.from("claudia_wechat_bindings")
  .select("id,conversation_id,character_id,status")
  .eq("id",body.bindingId).eq("user_id",identity.user.id).maybeSingle();
 if(bindingError)return reply(500,{error:"binding_lookup_failed"});
 if(!binding)return reply(404,{error:"binding_not_found"});
 // A server-generated monotonic sequence is needed for robust cursoring.
 // Until then, use bounded newest-first fetch with stable id dedupe client-side.
 // This endpoint is explicitly a provisional snapshot, NOT lossless sync.
 const {data:messages,error}=await admin.from("claudia_wechat_messages")
  .select("id,external_message_id,direction,body,status,local_message_id,received_at,in_reply_to")
  .eq("user_id",identity.user.id).eq("binding_id",binding.id)
  .order("received_at",{ascending:false}).order("id",{ascending:false}).limit(100);
 if(error)return reply(500,{error:"sync_failed"});
 return reply(200,{ok:true,mode:"snapshot",lossless:false,
  binding:{id:binding.id,conversationId:binding.conversation_id,characterId:binding.character_id,status:binding.status},
  messages:(messages??[]).reverse()});
});
