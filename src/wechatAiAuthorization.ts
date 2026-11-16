import {wechatCloudFunctionRequest} from './wechatCloudIdentity';
export type WechatAiStatus={configured:boolean;enabled:boolean;model:string|null;endpoint:string|null};
async function call(payload:unknown){
 const response=await wechatCloudFunctionRequest('claudia-wechat-ai-config',payload);
 const data=await response.json() as Record<string,unknown>;
 if(data.ok!==true)throw Error('微信云端 AI 配置失败。');
 return data;
}
export async function getWechatAiStatus(bindingId:string):Promise<WechatAiStatus>{
 const data=await call({action:'status',bindingId});
 return {configured:data.configured===true,enabled:data.enabled===true,
  model:typeof data.model==='string'?data.model:null,
  endpoint:typeof data.endpoint==='string'?data.endpoint:null};
}
export async function authorizeWechatAi(input:{bindingId:string;systemPrompt:string;
 model:string;endpoint:string;apiKey:string}){
 await call({...input,action:'authorize'});
}
export async function disableWechatAi(bindingId:string){
 await call({action:'disable',bindingId});
}
export async function deleteWechatAi(bindingId:string){
 await call({action:'delete',bindingId});
}
