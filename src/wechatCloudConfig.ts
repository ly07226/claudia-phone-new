/** Per-device, WeChat-only Supabase public project configuration.
 * Never accept or store service_role, database passwords, or model API keys.
 * This does not change the Supabase project used by other cloud features.
 */
export type WechatCloudConfig={url:string;publishableKey:string};
const STORAGE='claudia-wechat-cloud-config-v1';
export function validateWechatCloudConfig(value:WechatCloudConfig):WechatCloudConfig{
 const url=value.url.trim().replace(/\/$/,'');
 const publishableKey=value.publishableKey.trim();
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))
  throw Error('请输入自己的 Supabase 项目 URL（https://…supabase.co）。');
 if(!publishableKey||publishableKey.length>2048||/\s/.test(publishableKey)||
  publishableKey.startsWith('sb_secret_'))
  throw Error('只能填写 Supabase publishable / anon 公钥，不能填写 secret 或 service_role 密钥。');
 return {url,publishableKey};
}
export function readWechatCloudConfig():WechatCloudConfig|null{
 try{
  const raw=localStorage.getItem(STORAGE);
  if(!raw)return null;
  const parsed=JSON.parse(raw) as Partial<WechatCloudConfig>;
  if(typeof parsed.url!=='string'||typeof parsed.publishableKey!=='string')return null;
  return validateWechatCloudConfig(parsed as WechatCloudConfig);
 }catch{return null;}
}
export function saveWechatCloudConfig(value:WechatCloudConfig){
 const config=validateWechatCloudConfig(value);
 localStorage.setItem(STORAGE,JSON.stringify(config));
}
export function clearWechatCloudConfig(){localStorage.removeItem(STORAGE);}
