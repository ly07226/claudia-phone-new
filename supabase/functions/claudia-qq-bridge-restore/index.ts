// Trusted Railway-only restoration of QQ bot connections after worker restart.
// Secrets are returned only to the authenticated bridge over HTTPS; never to browsers.
import {createClient} from "npm:@supabase/supabase-js@2";
const json=(status:number,value:Record<string,unknown>)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const bytes=(v:string)=>new TextEncoder().encode(v);
async function eq(a:string,b:string){const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",bytes(a)),crypto.subtle.digest("SHA-256",bytes(b))]);return new Uint8Array(x).every((v,i)=>v===new Uint8Array(y)[i]);}
async function unseal(value:string,secret:string){
 const raw=Uint8Array.from(atob(secret),c=>c.charCodeAt(0));
 if(raw.length!==32)throw Error("invalid_key");
 const [iv64,cipher64]=value.split(".");
 if(!iv64||!cipher64)throw Error("invalid_cipher");
 const iv=Uint8Array.from(atob(iv64),c=>c.charCodeAt(0));
 const cipher=Uint8Array.from(atob(cipher64),c=>c.charCodeAt(0));
 if(iv.length!==12)throw Error("invalid_iv");
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv},key,cipher));
}
Deno.serve(async req=>{
 if(req.method!=="POST")return json(405,{error:"method_not_allowed"});
 const token=Deno.env.get("QQ_QR_ACCESS_TOKEN")||"",auth=req.headers.get("Authorization")||"";
 if(token.length<32||!auth.startsWith("Bearer ")||!(await eq(auth.slice(7),token)))return json(401,{error:"unauthorized"});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),encryption=Deno.env.get("WECHAT_ILINK_ENCRYPTION_KEY");
 if(!url||!key||!encryption)return json(503,{error:"not_configured"});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:bindings,error}=await db.from("claudia_qq_bindings").select("id").eq("status","connected").limit(500);
 if(error)return json(500,{error:"binding_lookup_failed"});
 const accounts:Array<{bindingId:string;appId:string;appSecret:string}>=[];
 for(const binding of bindings??[]){
  const {data:credential,error:credentialError}=await db.from("claudia_qq_credentials")
   .select("app_id_ciphertext,app_secret_ciphertext").eq("binding_id",binding.id).maybeSingle();
  if(credentialError)return json(500,{error:"credential_lookup_failed"});
  if(!credential)continue;
  try{
   accounts.push({bindingId:binding.id,appId:await unseal(credential.app_id_ciphertext,encryption),
    appSecret:await unseal(credential.app_secret_ciphertext,encryption)});
  }catch{return json(503,{error:"credential_decryption_failed"});}
 }
 return json(200,{ok:true,accounts});
});
