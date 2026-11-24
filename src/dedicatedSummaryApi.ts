import {db,defaultTheme} from './store';
import {testConnection,validateConfig,type ApiConfig} from './api';
import {resolveApi} from './chatService';
import type {Conversation} from './chatTypes';
import type {MemoryScope} from './memoryTypes';
export interface DedicatedSummaryApi {provider:'openai-compatible'|'openai'|'gemini'|'openrouter'|'custom';protocol?:'openai-chat'|'gemini';baseUrl:string;model:string;apiKey:string;temperature:number;maxTokens:number;contextWindowTokens?:number;modelOutputTokens?:number;enabled:boolean}
export function summaryTransport(value:DedicatedSummaryApi):{config:ApiConfig;key:string}{
 return {config:{id:'summary-only',name:'自动任务专用接口',provider:value.provider,protocol:value.protocol,baseUrl:value.baseUrl.trim().replace(/\/+$/,''),model:value.model.trim(),temperature:value.temperature,maxTokens:value.maxTokens,...(value.contextWindowTokens?{contextWindowTokens:value.contextWindowTokens}:{}),...(value.modelOutputTokens?{modelOutputTokens:value.modelOutputTokens}:{}),enabled:value.enabled,isDefault:false,createdAt:0,updatedAt:0},key:value.apiKey};
}
export async function resolveAutomationApi(conversation:Conversation){
 const global=await db.themes.get('global');
 if(!global?.dedicatedSummaryApi?.enabled)return resolveApi(conversation);
 return getSummaryApi();
}
export async function getSummaryApi(scope?:MemoryScope){
 const global=await db.themes.get('global');
 if(!global?.dedicatedSummaryApi?.enabled){const c=scope&&await db.conversations.get(scope.conversationId);if(c)return resolveApi(c);throw Error('请配置自动任务 API 或提供会话');}
 const result=summaryTransport(global.dedicatedSummaryApi);
 const invalid=validateConfig(result.config,result.key);
 if(invalid)throw Error(invalid);
 if(!result.config.enabled)throw Error('总结专用 API 已关闭');
 return result;
}
export async function saveSummaryApi(value:DedicatedSummaryApi){
 const {config,key}=summaryTransport(value),invalid=validateConfig(config,key);
 if(invalid)throw Error(invalid);
 await db.transaction('rw',db.themes,async()=>{
  const global=await db.themes.get('global');
  await db.themes.put({...defaultTheme,...global,dedicatedSummaryApi:value,id:'global'});
 });
}
export async function testSummaryApi(value:DedicatedSummaryApi){
 const {config,key}=summaryTransport(value);
 return testConnection(config,key);
}
