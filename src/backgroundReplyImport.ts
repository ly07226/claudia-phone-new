import {publishSavedChatMessage} from './chatMessageEvents';
import {db} from './store';
import {activeMessages} from './messagePath';
import {commitTimelineProjection,ensureTimelineInTransaction,timelineTables} from './timelines';
import {fetchBackgroundSnapshot} from './backgroundReplySync';

/** Only imports a completed reply whose originating user message is still the
 * active path's unanswered tail. The transaction makes repeated polling safe. */
export async function importBackgroundReplies(conversationId:string,loadSnapshot=fetchBackgroundSnapshot):Promise<{imported:number;skipped:number}>{
 const snapshot=await loadSnapshot(conversationId);
 if(!snapshot)return {imported:0,skipped:0};
 const jobs=new Map(snapshot.jobs.map(job=>[job.id,job]));
 let imported=0,skipped=0;
 for(const reply of snapshot.replies){
  const job=jobs.get(reply.job_id);
  if(!job||job.kind!=='reply'||!['completed','notified'].includes(job.status)||
     job.conversation_id!==conversationId||reply.conversation_id!==conversationId||
     typeof reply.message_id!=='string'||!/^[a-zA-Z0-9:_-]{1,128}$/.test(reply.message_id)||
     typeof job.client_message_id!=='string'||typeof job.timeline_id!=='string'||
     !Number.isSafeInteger(job.timeline_epoch)||job.timeline_epoch<0||
     typeof reply.body!=='string'||!reply.body.trim()||reply.body.length>200000){
   skipped++;continue;
  }
  const inserted=await db.transaction('rw',timelineTables(),async()=>{
   const conversation=await db.conversations.get(conversationId);
   if(!conversation||conversation.activeTimelineId!==job.timeline_id||
      (conversation.timelineEpoch??0)!==job.timeline_epoch)return false;
   const timeline=await ensureTimelineInTransaction(conversationId);
   if(timeline.id!==job.timeline_id||timeline.epoch!==job.timeline_epoch)return false;
   const existing=await db.messages.get(reply.message_id);
   const existingVariant=await db.messageVariants.get(reply.message_id);
   if(existingVariant)return false;
   if(existing)return false; // Never overwrite an existing ID, including another conversation.
   const path=await activeMessages(conversationId);
   const tail=path.at(-1);
   if(!tail||tail.role!=='user'||tail.id!==job.client_message_id)return false;
   // Do not import while a local generation owns this conversation.
   if(conversation.sendingToken&&(!conversation.sendingUntil||conversation.sendingUntil>Date.now()))return false;
   const created=Date.parse(reply.created_at);
   if(!Number.isFinite(created))return false;
   // A completed job must never append a second assistant turn to an already
   // answered user message, including a regenerated response with another ID.
   const message={id:reply.message_id,conversationId,role:'assistant' as const,
    content:reply.body,createdAt:created,archived:false};
   const variantId=crypto.randomUUID();
   await db.messageVariants.add({id:variantId,conversationId,messageId:message.id,
    content:message.content,source:'generated',createdAt:created});
   await db.messages.add({...message,activeVariantId:variantId});
   await commitTimelineProjection(conversationId,'append');
   await db.conversations.update(conversationId,{updatedAt:Date.now()});
   return true;
  });
  if(inserted){imported++;const [c,m]=await Promise.all([db.conversations.get(conversationId),db.messages.get(reply.message_id)]);if(c&&m)publishSavedChatMessage(c,m);}else skipped++;
 }
 return {imported,skipped};
}
