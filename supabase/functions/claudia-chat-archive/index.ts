import {createClient} from "npm:@supabase/supabase-js@2";
const allowed=new Set([Deno.env.get("CLAUDIA_APP_ORIGIN"),"https://claudia-phone-new.vercel.app"].filter(Boolean));
const headers={"Content-Type":"application/json","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin","Cache-Control":"no-store"};
const respond=(status:number,body:unknown,origin:string)=>new Response(JSON.stringify(body),{status,headers:{...headers,"Access-Control-Allow-Origin":origin}});
Deno.serve(async(req)=>{
 const origin=req.headers.get("Origin")||"";
 const netlify=(()=>{try{const u=new URL(origin);return u.protocol==="https:"&&u.hostname.endsWith("-avenori.netlify.app")&&!u.port;}catch{return false;}})();
 if(!allowed.has(origin)&&!netlify)return new Response(JSON.stringify({error:"origin_denied"}),{status:403,headers});
 const json=(status:number,body:unknown)=>respond(status,body,origin);
 if(req.method==="OPTIONS")return new Response(null,{headers:{...headers,"Access-Control-Allow-Origin":origin}});
 if(req.method!=="POST")return json(405,{error:"method"});
 const url=Deno.env.get("SUPABASE_URL"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 const token=req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
 if(!url||!secret||!token)return json(401,{error:"unauthorized"});
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await admin.auth.getUser(token);
 if(authError||!auth.user)return json(401,{error:"unauthorized"});
 let p:any;try{const raw=await req.text();if(raw.length>600000)throw Error();p=JSON.parse(raw);}catch{return json(400,{error:"invalid_payload"});}
 if(typeof p?.bindingId!=="string"||typeof p?.conversationId!=="string"||typeof p?.timelineId!=="string"||p.bindingId.length>180||p.conversationId.length>180||p.timelineId.length>180)return json(400,{error:"invalid_scope"});
 const {data:binding,error:bindingError}=await admin.from("claudia_qq_bindings").select("character_id,conversation_id").eq("id",p.bindingId).eq("user_id",auth.user.id).maybeSingle();
 if(bindingError||!binding)return json(403,{error:"binding_not_owned"});
 if(binding.conversation_id!==p.conversationId)return json(409,{error:"conversation_mismatch"});
 if(p.action==="upsert"){
  if(!Array.isArray(p.messages)||p.messages.length>100)return json(400,{error:"batch_limit"});
  const rows=[];
  for(const m of p.messages){
   if(typeof m?.id!=="string"||m.id.length>180||!["user","assistant"].includes(m.role)||typeof m.content!=="string"||m.content.length>24000||!Number.isSafeInteger(m.createdAt))return json(400,{error:"invalid_message"});
   rows.push({owner_id:auth.user.id,conversation_id:p.conversationId,timeline_id:p.timelineId,message_id:m.id,character_id:binding.character_id,role:m.role,body:m.content,created_at_ms:m.createdAt,deleted_at:null});
  }
  if(!rows.length)return json(200,{ok:true,stored:0});
  const {error}=await admin.from("claudia_chat_archive").upsert(rows,{onConflict:"owner_id,conversation_id,timeline_id,message_id"});
  return error?json(503,{error:"write_failed"}):json(200,{ok:true,stored:rows.length});
 }
 if(p.action==="tombstone"){
  if(!Array.isArray(p.messageIds)||p.messageIds.length>100||!p.messageIds.every((id:unknown)=>typeof id==="string"&&id.length>0&&id.length<=180))
   return json(400,{error:"invalid_message_ids"});
  if(!p.messageIds.length)return json(200,{ok:true,deleted:0});
  const {data,error}=await admin.from("claudia_chat_archive")
   .update({deleted_at:new Date().toISOString()})
   .eq("owner_id",auth.user.id).eq("conversation_id",p.conversationId)
   .eq("timeline_id",p.timelineId).in("message_id",p.messageIds)
   .is("deleted_at",null).select("message_id");
  return error?json(503,{error:"delete_failed"}):json(200,{ok:true,deleted:data?.length??0});
 }
 if(p.action==="search"){
  const query=String(p.query??"").trim().slice(0,120);
  if(!query)return json(400,{error:"empty_query"});
  const {data,error}=await admin.from("claudia_chat_archive").select("message_id,role,body,created_at_ms").eq("owner_id",auth.user.id).eq("conversation_id",p.conversationId).eq("timeline_id",p.timelineId).is("deleted_at",null).ilike("body","%"+query.replace(/[\\%_]/g,"\\$&")+"%").order("created_at_ms",{ascending:false}).limit(30);
  return error?json(503,{error:"search_failed"}):json(200,{ok:true,messages:data});
 }
 return json(400,{error:"unknown_action"});
});