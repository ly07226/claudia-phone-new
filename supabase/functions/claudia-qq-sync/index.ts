// Owner-only QQ message sync, equivalent to the WeChat cloud readback route.
import {createClient} from "npm:@supabase/supabase-js@2";
const allowed=new Set([Deno.env.get("CLAUDIA_APP_ORIGIN"),"https://claudia-phone-new.vercel.app"].filter(Boolean));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async req=>{
 const origin=req.headers.get("Origin")||"";
 const headers={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin","Access-Control-Allow-Origin":origin,
 "Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
 const json=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers});
 const netlify=(()=>{try{const u=new URL(origin);return u.protocol==="https:"&&u.hostname.endsWith("-avenori.netlify.app")&&!u.port;}catch{return false;}})();
 if(!allowed.has(origin)&&!netlify)return json(403,{error:"origin_denied"});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return json(405,{error:"method_not_allowed"});
 const bearer=req.headers.get("Authorization")||"";
 if(!bearer.startsWith("Bearer "))return json(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json(503,{error:"not_configured"});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await db.auth.getUser(bearer.slice(7));
 if(authError||!auth.user)return json(401,{error:"unauthorized"});
 let body:Record<string,unknown>;
 try{const raw=await req.text();if(raw.length>1024)throw Error();body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw Error();}
 catch{return json(400,{error:"invalid_json"});}
 if(typeof body.bindingId!=="string"||!uuid.test(body.bindingId))return json(400,{error:"invalid_binding"});
 const {data:binding,error:lookupError}=await db.from("claudia_qq_bindings").select("id,conversation_id,character_id,status")
  .eq("id",body.bindingId).eq("user_id",auth.user.id).maybeSingle();
 if(lookupError)return json(500,{error:"binding_lookup_failed"});
 if(!binding)return json(404,{error:"binding_not_found"});
 const cursor=body.cursor;
 if(cursor!==undefined&&(!cursor||typeof cursor!=="object"||Array.isArray(cursor)||typeof cursor.at!=="string"||!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$/.test(cursor.at)||Number.isNaN(Date.parse(cursor.at))||typeof cursor.id!=="string"||!uuid.test(cursor.id)))return json(400,{error:"invalid_cursor"});
 let query=db.from("claudia_qq_messages").select("id,external_message_id,direction,body,status,local_message_id,received_at")
  .eq("user_id",auth.user.id).eq("binding_id",binding.id).order("received_at",{ascending:false}).order("id",{ascending:false}).limit(101);
 if(cursor)query=query.or(`received_at.lt.${cursor.at},and(received_at.eq.${cursor.at},id.lt.${cursor.id})`);
 const {data,error}=await query;
 if(error)return json(500,{error:"sync_failed"});
 const rows=(data??[]).slice(0,100);
 const last=rows.at(-1);
 return json(200,{ok:true,binding:{id:binding.id,conversationId:binding.conversation_id,characterId:binding.character_id,status:binding.status},
  messages:rows.reverse(),nextCursor:last?{at:last.received_at,id:last.id}:null,hasMore:(data??[]).length>100});
});
