// Owner-only QQ message sync, equivalent to the WeChat cloud readback route.
import {createClient} from "npm:@supabase/supabase-js@2";
const allowed=new Set([Deno.env.get("CLAUDIA_APP_ORIGIN"),"https://claudia-phone-new.vercel.app"].filter(Boolean));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isCursor(value:unknown,strict=false):value is {at:string;id:string}{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const c=value as Record<string,unknown>;
 return typeof c.at==='string'&&Number.isFinite(Date.parse(c.at))&&typeof c.id==='string'&&uuid.test(c.id)&&(!strict||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(c.at));
}
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
 if(body.after!==undefined&&!isCursor(body.after))return json(400,{error:"invalid_after"});
 if(body.cursor!==undefined&&!isCursor(body.cursor,true))return json(400,{error:"invalid_cursor"});
 const after=isCursor(body.after)?body.after:undefined;
 const cursor=isCursor(body.cursor,true)?body.cursor:undefined;
 const ascending=body.order==='asc';
 if(body.syncVersion===2){
  if(!Array.isArray(body.pendingIds)||body.pendingIds.length>1000||!body.pendingIds.every(id=>typeof id==='string'&&uuid.test(id)))return json(400,{error:'invalid_pending_ids'});
  const {data,error}=await db.rpc('claudia_qq_sync_state',{p_user_id:auth.user.id,p_binding_id:binding.id,p_after:after??null,p_pending_ids:body.pendingIds});
  if(error)return json(error.message?.includes('sync_cursor_missing')?409:503,{error:error.message?.includes('sync_cursor_missing')?'sync_cursor_missing':'sync_failed'});
  const messages=(data?.scanned??[]).slice(0,100),last=messages.at(-1);
  return json(200,{ok:true,order:'asc',pendingAware:true,binding:{id:binding.id,conversationId:binding.conversation_id,characterId:binding.character_id,status:binding.status},messages,pendingMessages:data?.pending??[],hasMore:(data?.scanned??[]).length>100,nextCursor:last?{at:last.received_at,id:last.id,part:last.part_index??0}:null});
 }

 if(ascending){
  const {data,error}=await db.rpc("claudia_qq_sync_page",{p_user_id:auth.user.id,p_binding_id:binding.id,p_after:after??cursor??null});
  if(error)return json(error.message?.includes('sync_cursor_missing')?409:503,{error:error.message?.includes('sync_cursor_missing')?'sync_cursor_missing':'sync_failed'});
  const rows=(data??[]).slice(0,100),last=rows.at(-1);
  return json(200,{ok:true,order:'asc',binding:{id:binding.id,conversationId:binding.conversation_id,characterId:binding.character_id,status:binding.status},messages:rows,nextCursor:last?{at:last.received_at,id:last.id}:null,hasMore:(data??[]).length>100});
 }
 let query=db.from("claudia_qq_messages").select("id,external_message_id,direction,body,status,local_message_id,received_at")
  .eq("user_id",auth.user.id).eq("binding_id",binding.id).order("received_at",{ascending}).order("id",{ascending}).limit(101);
 // Combine both bounds with AND; chaining .or() would broaden the result set.
 const bounds=[];
 if(after)bounds.push(`or(received_at.gt.${after.at},and(received_at.eq.${after.at},id.gt.${after.id}))`);
 if(cursor)bounds.push(`or(received_at.${ascending?'gt':'lt'}.${cursor.at},and(received_at.eq.${cursor.at},id.${ascending?'gt':'lt'}.${cursor.id}))`);
 if(bounds.length===1)query=query.or(bounds[0].slice(3,-1));
 else if(bounds.length>1)query=query.or(`and(${bounds.join(",")})`);
 const {data,error}=await query;
 if(error)return json(500,{error:"sync_failed"});
 const rows=(data??[]).slice(0,100);
 const last=rows.at(-1);
 return json(200,{ok:true,order:ascending?'asc':'desc',binding:{id:binding.id,conversationId:binding.conversation_id,characterId:binding.character_id,status:binding.status},
  messages:ascending?rows:rows.reverse(),nextCursor:last?{at:last.received_at,id:last.id}:null,hasMore:(data??[]).length>100});
});
