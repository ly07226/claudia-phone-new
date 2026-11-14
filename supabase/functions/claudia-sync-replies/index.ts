// Authenticated, read-only job/reply sync. No secrets or other users' rows.
import {createClient} from "npm:@supabase/supabase-js@2";
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
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:identity,error:authError}=await admin.auth.getUser(bearer.slice(7));
 if(authError||!identity.user)return respond(401,{error:"unauthorized"});
 let body:Record<string,unknown>;
 try{const raw=await request.text();if(raw.length>512)return respond(413,{error:"payload_too_large"});body=JSON.parse(raw);}
 catch{return respond(400,{error:"invalid_json"});}
 if(!body||typeof body.conversationId!=="string"||!valid.test(body.conversationId))return respond(400,{error:"invalid_conversation"});
 const {data:jobs,error:jobError}=await admin.from("claudia_background_jobs")
  .select("id,conversation_id,client_message_id,timeline_id,timeline_epoch,kind,status,error_code,updated_at")
  .eq("user_id",identity.user.id).eq("conversation_id",body.conversationId)
  .order("created_at",{ascending:false}).limit(50);
 if(jobError)return respond(500,{error:"job_lookup_failed"});
 const ids=(jobs??[]).filter(j=>j.status==="completed"||j.status==="notified").map(j=>j.id);
 let replies:unknown[]=[];
 if(ids.length){
  const {data,error}=await admin.from("claudia_background_replies")
   .select("job_id,message_id,conversation_id,body,created_at")
   .eq("user_id",identity.user.id).eq("conversation_id",body.conversationId).in("job_id",ids);
  if(error)return respond(500,{error:"reply_lookup_failed"});
  replies=data??[];
 }
 return respond(200,{ok:true,jobs:jobs??[],replies});
});
