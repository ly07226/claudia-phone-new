import { createClient } from "npm:@supabase/supabase-js@2";
const origin=Deno.env.get("CLAUDIA_APP_ORIGIN")||"";
const headers={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin","Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const respond=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers});
const valid=/^[a-zA-Z0-9:_-]{1,128}$/;
Deno.serve(async request=>{
 if(!origin||request.headers.get("Origin")!==origin)return respond(403,{error:"origin_denied"});
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(request.method!=="POST")return respond(405,{error:"method_not_allowed"});
 const bearer=request.headers.get("Authorization");
 if(!bearer?.startsWith("Bearer "))return respond(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return respond(503,{error:"not_configured"});
 const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:identity,error:authError}=await admin.auth.getUser(bearer.slice(7));
 if(authError||!identity.user)return respond(401,{error:"unauthorized"});
 let body:Record<string,unknown>;
 try{
  const raw=await request.text();if(raw.length>512)return respond(413,{error:"payload_too_large"});
  body=JSON.parse(raw);
 }catch{return respond(400,{error:"invalid_json"});}
 if(typeof body.conversationId!=="string"||!valid.test(body.conversationId)||typeof body.visible!=="boolean")return respond(400,{error:"invalid_presence"});
 if(body.visible){
  const {error}=await admin.from("claudia_chat_presence").upsert({user_id:identity.user.id,conversation_id:body.conversationId,last_seen_at:new Date().toISOString()},{onConflict:"user_id,conversation_id"});
  if(error)return respond(500,{error:"storage_failed"});
 }else{
  const {error}=await admin.from("claudia_chat_presence").delete().eq("user_id",identity.user.id).eq("conversation_id",body.conversationId);
  if(error)return respond(500,{error:"storage_failed"});
 }
 return respond(200,{ok:true});
});
