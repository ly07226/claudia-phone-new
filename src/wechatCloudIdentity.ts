/** WeChat-specific Supabase identity, isolated by project URL.
 * This identity is never reused by unrelated cloud features.
 * Anonymous identity is device-scoped; account recovery is not yet supported.
 */
import {readWechatCloudConfig} from './wechatCloudConfig';
type Session={access_token:string;refresh_token:string;expires_at:number};
const PREFIX='claudia-wechat-anon-v1:';
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
  const old=parse(localStorage.getItem(id));
  if(old&&old.expires_at>Date.now()/1000+90)return old.access_token;
  const session=old?
   await tokenRequest(c.url,c.publishableKey,'token?grant_type=refresh_token',{refresh_token:old.refresh_token}):
   await tokenRequest(c.url,c.publishableKey,'signup',{});
  localStorage.setItem(id,JSON.stringify(session));
  return session.access_token;
 })();
 inflight.set(id,task);
 try{return await task;}finally{inflight.delete(id);}
}
export async function wechatCloudFunctionRequest(name:'claudia-wechat-sync',body:unknown){
 const c=project();
 const token=await wechatCloudAccessToken();
 const response=await fetch(c.url+'/functions/v1/'+name,{
  method:'POST',headers:{'Content-Type':'application/json',apikey:c.publishableKey,
   Authorization:'Bearer '+token},body:JSON.stringify(body),cache:'no-store'
 });
 if(!response.ok)throw Error('微信专用云端请求失败（HTTP '+response.status+'）。');
 return response;
}
