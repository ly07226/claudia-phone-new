/** QQ uses the same private Supabase project and anonymous owner identity as WeChat,
 * but keeps its own tables, credentials, bindings and messages.
 * No QQ secrets are ever sent to the browser.
 */
import {wechatCloudFunctionRequest} from './wechatCloudIdentity';
export type QqQrSession={attemptId:string;qrContent:string|null;expiresAt:string;status:string};
async function request(body:Record<string,unknown>){
 const response=await wechatCloudFunctionRequest('claudia-qq-login',body);
 const payload=await response.json() as Record<string,unknown>;
 if(payload.ok!==true)throw Error(typeof payload.error==='string'?payload.error:'QQ 云端请求失败');
 return payload;
}
function parse(body:Record<string,unknown>):QqQrSession{
 if(typeof body.attemptId!=='string'||typeof body.status!=='string'||typeof body.expiresAt!=='string')throw Error('QQ 扫码状态无效');
 return {attemptId:body.attemptId,status:body.status,expiresAt:body.expiresAt,qrContent:typeof body.qrContent==='string'?body.qrContent:null};
}
export async function startQqQr(conversationId:string,characterId:string):Promise<QqQrSession>{
 return parse(await request({action:'start',conversationId,characterId}));
}
export async function pollQqQr(attemptId:string):Promise<QqQrSession>{
 return parse(await request({action:'poll',attemptId}));
}
export async function listQqCloudBindings(){
 const body=await request({action:'list-bindings'});
 return Array.isArray(body.bindings)?body.bindings as Array<{id:string;character_id:string;conversation_id:string;status:string}>:[];
}
export async function disconnectQqCloudBinding(bindingId:string){
 await request({action:'disconnect',bindingId});
}
