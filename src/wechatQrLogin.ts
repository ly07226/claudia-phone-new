import {wechatCloudFunctionRequest} from './wechatCloudIdentity';
export type WechatLoginStatus='wait'|'scaned'|'confirmed'|'expired'|'need_verifycode'|'verify_code_blocked'|'scaned_but_redirect'|'binded_redirect';
export async function startWechatLogin(conversationId:string,characterId:string){
 const response=await wechatCloudFunctionRequest('claudia-wechat-login',{action:'start',conversationId,characterId});
 const value=await response.json() as Record<string,unknown>;
 if(value.ok!==true||typeof value.attemptId!=='string'||typeof value.qrContent!=='string'||
    typeof value.expiresAt!=='string')throw Error('微信二维码创建失败。');
 return {attemptId:value.attemptId,qrContent:value.qrContent,expiresAt:value.expiresAt};
}
export async function pollWechatLogin(attemptId:string){
 const response=await wechatCloudFunctionRequest('claudia-wechat-login',{action:'poll',attemptId});
 const value=await response.json() as Record<string,unknown>;
 const valid=['wait','scaned','confirmed','expired','need_verifycode','verify_code_blocked','scaned_but_redirect','binded_redirect'];
 if(value.ok!==true||!valid.includes(String(value.status)))throw Error('微信扫码状态异常。');
 return {status:value.status as WechatLoginStatus,bindingId:typeof value.bindingId==='string'?value.bindingId:null};
}
