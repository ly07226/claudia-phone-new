import {db} from './store';
import {testConnection,validateConfig,type ApiConfig} from './api';
import type {MemoryScope} from './memoryTypes';
export interface DedicatedSummaryApi {provider:'openai-compatible'|'openai'|'gemini'|'openrouter'|'custom';protocol?:'openai-chat'|'gemini';baseUrl:string;model:string;apiKey:string;temperature:number;maxTokens:number;enabled:boolean}
export function summaryTransport(value:DedicatedSummaryApi):{config:ApiConfig;key:string}{
 return {config:{id:'summary-only',name:'总结专用接口',provider:value.provider,protocol:value.protocol,baseUrl:value.baseUrl.trim().replace(/\/+$/,''),model:value.model.trim(),temperature:value.temperature,maxTokens:value.maxTokens,enabled:value.enabled,isDefault:false,createdAt:0,updatedAt:0},key:value.apiKey};
}
export async function getSummaryApi(scope:MemoryScope){
 const c=await db.conversations.get(scope.conversationId);
 if(!c?.dedicatedSummaryApi)throw Error('请先在自动记忆总结中设置独立 API');
 const result=summaryTransport(c.dedicatedSummaryApi);
 const invalid=validateConfig(result.config,result.key);
 if(invalid)throw Error(invalid);
 if(!result.config.enabled)throw Error('总结专用 API 已关闭');
 return result;
}
export async function saveSummaryApi(scope:MemoryScope,value:DedicatedSummaryApi){
 const {config,key}=summaryTransport(value),invalid=validateConfig(config,key);
 if(invalid)throw Error(invalid);
 await db.transaction('rw',db.conversations,async()=>{
  const c=await db.conversations.get(scope.conversationId);
  if(!c||c.characterId!==scope.characterId||c.mode!==scope.mode||c.worldId!==scope.worldId)throw Error('记忆空间已变化');
  await db.conversations.update(c.id,{dedicatedSummaryApi:value,summaryApiConfigId:undefined});
 });
}
export async function testSummaryApi(value:DedicatedSummaryApi){
 const {config,key}=summaryTransport(value);
 return testConnection(config,key);
}
