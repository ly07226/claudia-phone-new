import {db} from './store';
import {activeMessages} from './messagePath';
import {buildContext} from './chatContext';
import {resolveApi} from './chatService';
import type {ApiConfig} from './api';
import type {ContextMessage} from './chatTypes';

/** Exact, immutable snapshot of the current character's existing provider and
 * prompt assembly. This module does NOT transmit or persist the API key. */
export interface BackgroundProviderSnapshot {
 conversationId:string;
 clientMessageId:string;
 timelineId:string;
 timelineEpoch:number;
 configId:string;
 provider:ApiConfig['provider'];
 protocol:ApiConfig['protocol'];
 baseUrl:string;
 model:string;
 temperature:number;
 maxTokens:number;
 messages:ContextMessage[];
}
export async function prepareBackgroundProviderSnapshot(conversationId:string):Promise<BackgroundProviderSnapshot>{
 const conversation=await db.conversations.get(conversationId);
 if(!conversation||!conversation.activeTimelineId)throw Error('后台任务需要已建立的有效聊天时间线。');
 if(conversation.sendingToken&&(!conversation.sendingUntil||conversation.sendingUntil>Date.now()))throw Error('当前聊天已有生成任务。');
 const path=await activeMessages(conversationId);
 const last=path.at(-1);
 if(!last||last.role!=='user')throw Error('后台任务只能回复当前时间线末尾的用户消息。');
 const {config}=await resolveApi(conversation);
 const supported=config.provider==='gemini'||config.provider==='openai'||config.provider==='openrouter'||
  config.provider==='openai-compatible'||(config.provider==='custom'&&['gemini','openai-chat'].includes(config.protocol??''));
 if(!supported)throw Error('当前 API 协议暂不支持云端后台执行，普通聊天不受影响。');
 const messages=await buildContext(conversation);
 // Images need their own encrypted attachment transfer; never silently discard.
 if(messages.some(m=>m.images?.length))throw Error('当前上下文包含图片，暂不能安全转交后台；请继续使用普通聊天。');
 const latest=await db.conversations.get(conversationId);
 const current=await activeMessages(conversationId);
 if(!latest||latest.activeTimelineId!==conversation.activeTimelineId||
    (latest.timelineEpoch??0)!==(conversation.timelineEpoch??0)||
    current.at(-1)?.id!==last.id)throw Error('准备后台任务期间剧情已变化，请重新发送。');
 return {
  conversationId,clientMessageId:last.id,timelineId:conversation.activeTimelineId,
  timelineEpoch:conversation.timelineEpoch??0,configId:config.id,
  provider:config.provider,protocol:config.protocol,baseUrl:config.baseUrl,
  model:config.model,temperature:config.temperature,maxTokens:config.maxTokens,messages
 };
}
