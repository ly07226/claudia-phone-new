import type {Conversation,Message} from './chatTypes';
import type {BackgroundJobSnapshot,BackgroundReplySnapshot,BackgroundSyncSnapshot} from './backgroundReplySync';

export interface SafeBackgroundReply {
 jobId:string;messageId:string;conversationId:string;body:string;createdAt:number;
}
/**
 * Never put a cloud reply directly into the local message table.
 * Validate the exact active timeline, epoch, originating user message,
 * message identity and content before any caller attempts an import.
 * This is a pure filter; committing to the timeline needs a separate
 * atomic transaction using the existing timeline projection functions.
 */
export function eligibleBackgroundReplies(
 conversation:Conversation,
 active:readonly Message[],
 snapshot:BackgroundSyncSnapshot,
):SafeBackgroundReply[]{
 const validId=/^[a-zA-Z0-9:_-]{1,128}$/;
 const currentTimeline=conversation.activeTimelineId;
 if(!currentTimeline)return [];
 const userIds=new Set(active.filter(m=>m.role==='user').map(m=>m.id));
 const existingIds=new Set(active.map(m=>m.id));
 // A remote reply may only attach to the latest unanswered user turn.
 // Older cloud completions cannot overwrite a newer local reply.
 const last=active.at(-1);
 if(!last||last.role!=='user')return [];
 const jobs=new Map<string,BackgroundJobSnapshot>();
 for(const job of snapshot.jobs){
  if(job.conversation_id!==conversation.id||job.timeline_id!==currentTimeline||
     job.timeline_epoch!==(conversation.timelineEpoch??0)||
     job.kind!=='reply'||!['completed','notified'].includes(job.status)||
     !validId.test(job.id)||!userIds.has(job.client_message_id)||
     job.client_message_id!==last.id)continue;
  jobs.set(job.id,job);
 }
 const result:SafeBackgroundReply[]=[];
 const seen=new Set<string>();
 for(const reply of snapshot.replies){
  const job=jobs.get(reply.job_id);
  if(!job||reply.conversation_id!==conversation.id||
     typeof reply.message_id!=='string'||!validId.test(reply.message_id)||
     existingIds.has(reply.message_id)||seen.has(reply.message_id)||
     typeof reply.body!=='string'||!reply.body.trim()||
     reply.body.length>200_000)continue;
  const timestamp=Date.parse(reply.created_at);
  if(!Number.isFinite(timestamp))continue;
  seen.add(reply.message_id);
  result.push({jobId:job.id,messageId:reply.message_id,
   conversationId:conversation.id,body:reply.body,createdAt:timestamp});
 }
 return result;
}
