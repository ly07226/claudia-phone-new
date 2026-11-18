// Read-only incremental sync for a single WeChat-bound DAILY conversation.
// Browser access requires Supabase user JWT; never returns iLink credentials.
import {createClient} from "npm:@supabase/supabase-js@2";
const origin=Deno.env.get("CLAUDIA_APP_ORIGIN")||"";
const trustedOrigins=new Set([origin,"https://claudia-phone-new.vercel.app","https://claudia-phone-nxya5vllj-2982991953-4231.vercel.app"].filter(Boolean));
const headers={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin",
 "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(status:number,value:Record<string,unknown>)=>new Response(JSON.stringify(value),{status,headers});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async request=>{
 const requestOrigin=request.headers.get("Origin")||"";
 if(!trustedOrigins.has(requestOrigin))return reply(403,{error:"origin_denied"});
 const responseHeaders={...headers,"Access-Control-Allow-Origin":requestOrigin};
 const reply=(status:number,value:Record<string,unknown>)=>new Response(JSON.stringify(value),{status,headers:responseHeaders});
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:responseHeaders});
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
 if(body.action==='list-bindings'){
  const {data:bindings,error:listError}=await admin.from("claudia_wechat_bindings")
   .select("id,character_id,conversation_id,status,created_at,updated_at")
   .eq("user_id",identity.user.id).order("created_at",{ascending:false}).limit(100);
  if(listError)return reply(500,{error:"binding_list_failed"});
  return reply(200,{ok:true,bindings:bindings??[]});
 }
 const afterSeq=body.afterSeq===undefined?0:body.afterSeq;
 const mode=body.mode===undefined?'messages':body.mode;
 if(typeof body.bindingId!=="string"||!uuid.test(body.bindingId)||
    !Number.isSafeInteger(afterSeq)||(afterSeq as number)<0||
    !['messages','changes'].includes(String(mode)))
   return reply(400,{error:"invalid_binding_or_cursor"});
 const {data:binding,error:bindingError}=await admin.from("claudia_wechat_bindings")
  .select("id,conversation_id,character_id,status")
  .eq("id",body.bindingId).eq("user_id",identity.user.id).maybeSingle();
 if(bindingError)return reply(500,{error:"binding_lookup_failed"});
 if(!binding)return reply(404,{error:"binding_not_found"});
 const column=mode==='changes'?'change_seq':'sync_seq';
 const {data:rows,error}=await admin.from("claudia_wechat_messages")
  .select("id,sync_seq,change_seq,external_message_id,direction,body,status,local_message_id,received_at,in_reply_to")
  .eq("user_id",identity.user.id).eq("binding_id",binding.id)
  .gt(column,afterSeq).order(column,{ascending:true}).limit(101);
 if(error)return reply(500,{error:"sync_failed"});
 const messages=(rows??[]).slice(0,100);
 const nextSeq=messages.length?messages[messages.length-1][column]:afterSeq;
 return reply(200,{ok:true,mode:mode==='changes'?'changes':'incremental',
  cursorType:"commit_ordered",
  binding:{id:binding.id,conversationId:binding.conversation_id,characterId:binding.character_id,status:binding.status},
  messages,nextSeq,hasMore:(rows??[]).length>100});
});
