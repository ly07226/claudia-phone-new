import {cloudFunctionRequest,cloudConfigured} from './cloudIdentity';
import {byokEncryptionConfigured,prepareEncryptedBackgroundJob} from './backgroundByokEnvelope';
import {db} from './store';
import {activeMessages} from './messagePath';
/** Enqueue only an already-saved, unanswered user turn. Never re-route local
 * generation automatically: the caller must explicitly choose cloud mode. */
export async function enqueueCurrentBackgroundReply(conversationId:string):Promise<string>{
 if(!cloudConfigured()||!byokEncryptionConfigured())throw Error('云端后台 API 加密服务尚未配置。');
 const payload=await prepareEncryptedBackgroundJob(conversationId);
 const conversation=await db.conversations.get(conversationId);
 const tail=(await activeMessages(conversationId)).at(-1);
 if(!conversation||conversation.activeTimelineId!==payload.timelineId||
   (conversation.timelineEpoch??0)!==payload.timelineEpoch||
   tail?.id!==payload.clientMessageId||tail.role!=='user')throw Error('当前剧情已发生变化，后台请求未提交。');
 const response=await cloudFunctionRequest('claudia-enqueue-reply','POST',payload);
 const value:unknown=await response.json();
 if(!value||typeof value!=='object'||(value as {ok?:unknown}).ok!==true||
    typeof (value as {jobId?:unknown}).jobId!=='string')throw Error('后台任务未确认入队。');
 return (value as {jobId:string}).jobId;
}
