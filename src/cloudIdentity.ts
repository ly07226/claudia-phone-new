/**
 * Optional, silent Supabase anonymous identity for cloud-only features.
 * Ordinary Claudia Phone chat never calls this module.
 * Anonymous identities are device/browser scoped and cannot be recovered
 * after storage is cleared without an explicit account upgrade.
 */
const base=(import.meta.env.VITE_SUPABASE_URL as string|undefined)?.trim().replace(/\/$/,'')??'';
const key=(import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined)?.trim()??'';
const STORAGE='claudia-cloud-anon-session-v1';
type Session={access_token:string;refresh_token:string;expires_at:number};
let inflight:Promise<string>|null=null;
export function cloudConfigured(){return /^https:\/\/[^/]+\.supabase\.co$/.test(base)&&!!key;}
export function cloudFunctionUrl(name:'claudia-push-subscriptions'|'claudia-enqueue-reply'){
 if(!cloudConfigured())throw Error('云端后台服务尚未配置。');
 return base+'/functions/v1/'+name;
}
function read():Session|null{
 try{
  const raw=localStorage.getItem(STORAGE);
  if(!raw)return null;
  const value=JSON.parse(raw) as Partial<Session>;
  if(typeof value.access_token!=='string'||typeof value.refresh_token!=='string'||typeof value.expires_at!=='number')return null;
  return value as Session;
 }catch{return null;}
}
function save(data:Record<string,unknown>):string{
 const access=data.access_token,refresh=data.refresh_token,expires=data.expires_in;
 if(typeof access!=='string'||typeof refresh!=='string'||typeof expires!=='number')throw Error('云端身份服务返回的数据不完整。');
 localStorage.setItem(STORAGE,JSON.stringify({access_token:access,refresh_token:refresh,expires_at:Math.floor(Date.now()/1000)+expires}));
 return access;
}
async function authRequest(path:string,body:Record<string,unknown>){
 const response=await fetch(base+'/auth/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json','apikey':key},body:JSON.stringify(body),cache:'no-store'});
 if(!response.ok)throw Error(response.status===422?'请先在 Supabase 开启匿名身份验证。':'云端身份验证失败（HTTP '+response.status+'）。');
 return await response.json() as Record<string,unknown>;
}
export async function cloudAccessToken():Promise<string>{
 if(!cloudConfigured())throw Error('云端后台服务尚未配置。');
 if(inflight)return inflight;
 inflight=(async()=>{
  const current=read();
  if(current&&current.expires_at>Date.now()/1000+90)return current.access_token;
  if(current){
   try{return save(await authRequest('token?grant_type=refresh_token',{refresh_token:current.refresh_token}));}
   catch{throw Error('云端匿名身份已过期，请重新绑定设备；为防止丢失原有任务，系统不会自动更换身份。');}
  }
  return save(await authRequest('signup',{}));
 })();
 try{return await inflight;}finally{inflight=null;}
}
export async function cloudFunctionRequest(name:'claudia-push-subscriptions'|'claudia-enqueue-reply',method:'POST'|'DELETE',body:unknown){
 const token=await cloudAccessToken();
 const response=await fetch(cloudFunctionUrl(name),{method,headers:{'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+token},body:JSON.stringify(body),cache:'no-store'});
 if(!response.ok)throw Error('云端接口请求失败（HTTP '+response.status+'）。');
 return response;
}
