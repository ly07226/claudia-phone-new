import {db} from './store';
import {buildContext} from './chatContext';
import {wechatCloudFunctionRequest} from './wechatCloudIdentity';

/** Reuse the REAL local context assembler, including active branch, lore, memory
 * and time settings. Explicit user action only; no background key upload.
 * Image contexts cannot yet be reproduced by the cloud text worker: fail closed.
 */
export async function syncWechatEffectiveContext(bindingId:string,conversationId:string){
 const conversation=await db.conversations.get(conversationId);
 if(!conversation||conversation.mode!=='daily'||conversation.worldId)
  throw Error('只允许同步已有的日常聊天。');
 const context=await buildContext(conversation);
 if(context.some(m=>m.images?.length))
  throw Error('当前聊天上下文包含图片，云端文字模型尚不支持完整还原，已停止同步。');
 const messages=context.map(m=>({role:m.role,content:m.content}));
 if(messages.length>64||JSON.stringify(messages).length>80000)
  throw Error('当前有效上下文超过微信云端安全容量，不能截断后冒充完整记忆。');
 const response=await wechatCloudFunctionRequest('claudia-wechat-ai-config',{
  action:'sync-context',bindingId,contextMessages:messages});
 const result=await response.json() as {ok?:boolean;synced?:boolean};
 if(result.ok!==true||result.synced!==true)throw Error('微信角色记忆同步失败。');
 return {messageCount:messages.length};
}
export async function deleteWechatEffectiveContext(bindingId:string){
 const response=await wechatCloudFunctionRequest('claudia-wechat-ai-config',{
  action:'delete-context',bindingId});
 const result=await response.json() as {ok?:boolean;deleted?:boolean};
 if(result.ok!==true||result.deleted!==true)throw Error('删除云端角色记忆失败。');
}
