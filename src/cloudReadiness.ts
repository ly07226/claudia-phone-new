/** User-triggered diagnostics only. Does not deploy infrastructure or grant bridge access. */
import {readWechatCloudConfig} from './wechatCloudConfig';
import {wechatCloudAccessToken} from './wechatCloudIdentity';

export type CloudCheck={name:string;ok:boolean;detail:string};
export async function checkCloudReadiness():Promise<CloudCheck[]>{
 const config=readWechatCloudConfig();
 if(!config)return [{name:'配置',ok:false,detail:'请先保存 Supabase URL 和公开公钥'}];
 const results:CloudCheck[]=[];
 let token:string;
 try{
  token=await wechatCloudAccessToken();
  results.push({name:'Supabase 身份',ok:true,detail:'本设备已取得项目身份凭证'});
 }catch(e){
  results.push({name:'Supabase 身份',ok:false,detail:e instanceof Error?e.message:'身份认证失败；请检查 Anonymous Sign-Ins 是否启用'});
  return results;
 }
 for(const [name,action] of [['微信云端接口','claudia-wechat-sync'],['QQ 云端接口','claudia-qq-login']] as const){
  try{
   const response=await fetch(config.url+'/functions/v1/'+action,{
    method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey,Authorization:'Bearer '+token},
    body:JSON.stringify({action:'list-bindings'}),cache:'no-store'
   });
   if(!response.ok){results.push({name,ok:false,detail:'HTTP '+response.status+'；项目可能尚未部署接口或权限配置不完整'});continue;}
   const payload:unknown=await response.json();
   const valid=!!payload&&typeof payload==='object'&&!Array.isArray(payload)&&
    (payload as {ok?:unknown}).ok===true&&Array.isArray((payload as {bindings?:unknown}).bindings);
   results.push({name,ok:valid,detail:valid?'已验证绑定查询接口':'接口响应格式不符合预期'});
  }catch(e){results.push({name,ok:false,detail:e instanceof Error?e.message:'请求失败'});}
 }
 return results;
}
