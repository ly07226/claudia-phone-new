/** WeChat-specific Supabase identity, isolated by project URL.
 * This identity is never reused by unrelated cloud features.
 * Anonymous identity is device-scoped; account recovery is not yet supported.
 * Do not silently create a replacement owner when a known identity becomes unreadable.
 */
import {readWechatCloudConfig} from './wechatCloudConfig';
type Session={access_token:string;refresh_token:string;expires_at:number};
const PREFIX='claudia-wechat-anon-v1:';
const IDENTITY_MARKER='claudia-wechat-identity-created-v1:';
function project(){
 const c=readWechatCloudConfig();
 if(!c)throw Error('请先配置自己的微信 Supabase 项目。');
 return c;
}
function slot(url:string){return PREFIX+url;}
function parse(raw:string|null):Session|null{
 if(!raw)return null;
 try{
  const s=JSON.parse(raw) as Session;
  return typeof s.access_token==='string'&&typeof s.refresh_token==='string'&&
   Number.isFinite(s.expires_at)?s:null;
 }catch{return null;}
}
async function tokenRequest(url:string,key:string,path:string,payload:unknown){
 const response=await fetch(url+'/auth/v1/'+path,{
  method:'POST',headers:{'Content-Type':'application/json',apikey:key},
  body:JSON.stringify(payload),cache:'no-store'
 });
 if(!response.ok)throw Error('微信专用 Supabase 身份认证失败（HTTP '+response.status+'）。');
 const data=await response.json() as Record<string,unknown>;
 if(typeof data.access_token!=='string'||typeof data.refresh_token!=='string'||
    typeof data.expires_in!=='number')throw Error('微信云端身份数据不完整。');
 return {access_token:data.access_token,refresh_token:data.refresh_token,
  expires_at:Math.floor(Date.now()/1000)+data.expires_in} as Session;
}
const inflight=new Map<string,Promise<string>>();
export async function wechatCloudAccessToken():Promise<string>{
 const c=project(),id=slot(c.url);
 const pending=inflight.get(id);if(pending)return pending;
 const task=(async()=>{
  const raw=localStorage.getItem(id);
  const old=parse(raw);
  // A damaged or missing session must never silently create a second owner.
  // This protects existing QQ/WeChat bindings from appearing to have vanished.
  if(!old&&(raw!==null||localStorage.getItem(IDENTITY_MARKER+c.url)==='1'))
   throw Error('云端身份凭证已丢失或损坏，原 QQ 绑定可能仍在云端。已停止创建新身份；请勿重新扫码或清除数据。');
  if(old&&old.expires_at>Date.now()/1000+90)return old.access_token;
  const session=old?
   await tokenRequest(c.url,c.publishableKey,'token?grant_type=refresh_token',{refresh_token:old.refresh_token}):
   await tokenRequest(c.url,c.publishableKey,'signup',{});
  localStorage.setItem(id,JSON.stringify(session));
  localStorage.setItem(IDENTITY_MARKER+c.url,'1');
  return session.access_token;
 })();
 inflight.set(id,task);
 try{return await task;}finally{inflight.delete(id);}
}
export async function listWechatCloudBindings():Promise<Array<{id:string;character_id:string;conversation_id:string;status:string}>>{
 const response=await wechatCloudFunctionRequest('claudia-wechat-sync',{action:'list-bindings'});
 const payload:unknown=await response.json();
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('微信绑定数据格式无效。');
 const data=payload as {ok?:boolean;bindings?:unknown};
 if(data.ok!==true||!Array.isArray(data.bindings)||data.bindings.length>100||
  !data.bindings.every(row=>row&&typeof row==='object'&&
   typeof row.id==='string'&&typeof row.character_id==='string'&&
   typeof row.conversation_id==='string'&&typeof row.status==='string'))
  throw Error('微信绑定数据不完整。');
 return data.bindings as Array<{id:string;character_id:string;conversation_id:string;status:string}>;
}
export async function wechatCloudFunctionRequest(name:'claudia-wechat-sync'|'claudia-wechat-login'|'claudia-wechat-ai-config'|'claudia-qq-login'|'claudia-qq-ai-config'|'claudia-qq-sync',body:unknown,allowErrorResponse=false){
 const c=project();
 const token=await wechatCloudAccessToken();
 const response=await fetch(c.url+'/functions/v1/'+name,{
  method:'POST',headers:{'Content-Type':'application/json',apikey:c.publishableKey,
   Authorization:'Bearer '+token},body:JSON.stringify(body),cache:'no-store'
 });
 if(!response.ok&&!allowErrorResponse)throw Error('微信专用云端请求失败（HTTP '+response.status+'）。');
 return response;
}
