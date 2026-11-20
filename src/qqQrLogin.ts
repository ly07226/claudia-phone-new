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
 return Array.isArray(body.bindings)?body.bindings as Array<{id:string;character_id:string;conversation_id:string;status:string;stable_sync_id?:string|null;created_at?:string}>:[];
}
export async function disconnectQqCloudBinding(bindingId:string){
 await request({action:'disconnect',bindingId});
}

/** Bind a stable display ID to an existing owner-authenticated QQ binding. */
export async function setQqBindingSyncId(bindingId:string,syncId:string){
 await request({action:'set-sync-id',bindingId,syncId});
}

/** Latest created connected binding wins; preserve older bindings and their history. */
export function newestQqBinding<T extends {id:string;created_at?:string}>(bindings:T[]):T|undefined{
 return [...bindings].sort((a,b)=>(b.created_at??'').localeCompare(a.created_at??'')||b.id.localeCompare(a.id))[0];
}
