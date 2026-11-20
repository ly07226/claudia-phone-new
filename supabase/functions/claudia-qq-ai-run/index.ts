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
function splitQqReply(text:string):string[]{
 const parts:string[]=[];let start=0;let depth=0;let quote:string|null=null;
 const close:Record<string,string>={'“':'”','「':'」','『':'』','"':'"'};
 for(let i=0;i<text.length;i++){
  const c=text[i],next=text[i+1]||'';
  if(c==='\\'){i++;continue;}
  if(quote){if(c===quote)quote=null;continue;}
  if(close[c]){quote=close[c];continue;}
  if(c==='（'||c==='('){depth++;continue;}
  if(c==='）'||c===')'){depth=Math.max(0,depth-1);continue;}
  if(depth)continue;
  if(c==='\n'||/[。！？!?]/.test(c)||c==='.'&&(!next||/\s/.test(next))){
   let end=i+1;
   if(c==='\n'){while(end<text.length&&text[end]==='\n')end++;}
   else {while(end<text.length&&/[。！？!?]/.test(text[end]))end++;while(end<text.length&&/[ \t]/.test(text[end]))end++;}
   const part=text.slice(start,end);
   if(part.trim()){parts.push(part);start=end;}
   i=end-1;
  }
 }
 if(start<text.length){const tail=text.slice(start);if(tail.trim())parts.push(tail);else if(parts.length)parts[parts.length-1]+=tail;}
 if(!parts.length)return [text];
 const packed:string[]=[];
 for(const p of parts){
  if(p.length>1200){for(let at=0;at<p.length;at+=1000)packed.push(p.slice(at,at+1000).trim());continue;}
  if(packed.length>=31){packed[packed.length-1]+=' '+p.trim();continue;}
  packed.push(p.trim());
 }
 if(packed.some(p=>p.length>1200)||packed.length>32){
  const safe:string[]=[];
  for(const part of packed)for(let at=0;at<part.length;at+=1000)safe.push(part.slice(at,at+1000).trim());
  return safe.length<=32&&safe.join('').replace(/\s/g,'')===text.replace(/\s/g,'')?safe:[text.trim()];
 }
 return packed.join('').replace(/\s/g,'')===text.replace(/\s/g,'')?packed:[text.trim()];
}
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
    db.from("claudia_qq_context_snapshots").select("user_id,context_messages").eq("binding_id",row.binding_id).maybeSingle(),
    db.from("claudia_qq_messages").select("direction,body,status").eq("user_id",row.user_id).eq("binding_id",row.binding_id)
     .lt("received_at",row.received_at).in("status",["received","generated","sent"]).order("received_at",{ascending:false}).limit(24)
   ]);
   if(p.error||s.error||h.error||!p.data||!s.data||p.data.user_id!==row.user_id||s.data.user_id!==row.user_id)throw Error("profile_or_context_missing");
   // Service-role bypasses RLS: never combine a claimed message with a binding from another owner.
   const {data:ownerBinding,error:ownerError}=await db.from("claudia_qq_bindings")
    .select("id,user_id,conversation_id,character_id").eq("id",row.binding_id).eq("user_id",row.user_id).maybeSingle();
   if(ownerError||!ownerBinding)throw Error("binding_not_owned");
   const profile=p.data,snapshot=s.data;
   if(!endpointAllowed(profile.endpoint))throw Error("invalid_endpoint");
   if(!Array.isArray(snapshot.context_messages)||!snapshot.context_messages.some((m:any)=>m?.role==="system"))throw Error("invalid_context");
   const effective=(snapshot.context_messages as Array<{role:string;content:string}>)
    .filter(m=>m&&["system","user","assistant"].includes(m.role)&&typeof m.content==="string");
   while(effective.length&&effective[effective.length-1].role==="user")effective.pop();
   const prior=(h.data||[]).reverse().filter(m=>m.direction==="inbound"||(m.direction==="outbound"&&m.status==="sent"))
    .map(m=>({role:m.direction==="inbound"?"user":"assistant",content:m.body.slice(0,8000)}));
   const apiKey=await decrypt(profile.api_key_ciphertext,encryption);
   // Each binding uses its own saved endpoint/model/key; never substitute a shared provider.
   const payload=JSON.stringify({model:profile.model,messages:[...effective,...prior,{role:"user",content:row.body}],stream:false});
   let response:Response|null=null;
   for(let attempt=0;attempt<3;attempt++){
    try{
     response=await fetch(profile.endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},
      body:payload,signal:AbortSignal.timeout(45000)});
    }catch(error){
     if(attempt===2)throw error;
     await new Promise(resolve=>setTimeout(resolve,750*(attempt+1)));
     continue;
    }
    if(![429,502,503,504].includes(response.status)||attempt===2)break;
    await response.body?.cancel();
    await new Promise(resolve=>setTimeout(resolve,750*(attempt+1)));
   }
   if(!response)throw Error("generation_failed");
   if(!response.ok){
    // Store only a safe error code, never provider response bodies or credentials.
    throw Error("model_http_"+response.status);
   }
   const result=await response.json(),choice=result?.choices?.[0];
   const rawContent=choice?.message?.content;
   const value=typeof rawContent==="string"?rawContent:
    Array.isArray(rawContent)?rawContent.filter((part:any)=>part?.type==="text"&&typeof part.text==="string").map((part:any)=>part.text).join(""):"";
   // OpenAI-compatible providers do not all return finish_reason; reject explicit truncation only.
   if(!value.trim()||value.length>8000||["length","content_filter"].includes(choice?.finish_reason))throw Error("invalid_model_reply");
   generated=value.trim();
  }catch(error){
   const raw=error instanceof Error?error.message:"generation_failed";
   reason=/^(model_http_\d+|invalid_model_reply|invalid_context|invalid_endpoint|profile_or_context_missing|invalid_ciphertext)$/.test(raw)?raw:"generation_failed";
   console.warn("qq_ai_generation_failed",row.id,reason);
  }
  const {data:finished,error:finishError}=await db.rpc("claudia_qq_finish_generation",{p_inbound_id:row.id,p_expected_lease_until:row.lease_until,p_reply_body:generated,p_error_code:reason,p_parts:generated?splitQqReply(generated):null});
  if(finishError)return reply(500,{error:"finish_failed"});
  return reply(200,{ok:true,status:finished?"processed":"stale",generated:!!generated});
 }
 return reply(200,{ok:true,status:"idle"});
});
