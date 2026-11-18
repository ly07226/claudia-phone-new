// QQ-specific cloud AI controls. Reuses the same Supabase owner identity as WeChat.
import {wechatCloudFunctionRequest} from './wechatCloudIdentity';
export type QqAiStatus={configured:boolean;enabled:boolean;model:string|null;endpoint:string|null};
async function call(payload:Record<string,unknown>){
 const response=await wechatCloudFunctionRequest('claudia-qq-ai-config',payload);
 const data=await response.json() as Record<string,unknown>;
 if(data.ok!==true)throw Error(typeof data.error==='string'?data.error:'QQ 云端 AI 配置失败');
 return data;
}
export async function getQqAiStatus(bindingId:string):Promise<QqAiStatus>{
 const d=await call({action:'status',bindingId});
 return {configured:d.configured===true,enabled:d.enabled===true,model:typeof d.model==='string'?d.model:null,endpoint:typeof d.endpoint==='string'?d.endpoint:null};
}
export async function authorizeQqAi(input:{bindingId:string;systemPrompt:string;model:string;endpoint:string;apiKey:string}){
 await call({...input,action:'authorize'});
}
export async function disableQqAi(bindingId:string){await call({action:'disable',bindingId});}
export async function deleteQqAi(bindingId:string){await call({action:'delete',bindingId});}
export async function syncQqContext(bindingId:string,contextMessages:Array<{role:'system'|'user'|'assistant';content:string}>){
 await call({action:'sync-context',bindingId,contextMessages});
}
export async function deleteQqContext(bindingId:string){await call({action:'delete-context',bindingId});}
