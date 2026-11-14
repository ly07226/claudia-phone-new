import type {Conversation,Message} from './chatTypes';
import type {BackgroundJobSnapshot,BackgroundReplySnapshot,BackgroundSyncSnapshot} from './backgroundReplySync';

const id=/^[a-zA-Z0-9:_-]{1,128}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ImportCandidate={job:BackgroundJobSnapshot;reply:BackgroundReplySnapshot};

/** Pure admission gate: never let a stale cloud result overwrite a different
 * timeline or an already visible response. No writes are performed here. */
export function selectBackgroundImports(
 conversation:Conversation,
 visibleMessages:readonly Message[],
 snapshot:BackgroundSyncSnapshot,
):ImportCandidate[]{
 const seen=new Set(visibleMessages.map(m=>m.id));
 const jobs=new Map<string,BackgroundJobSnapshot>();
 for(const job of snapshot.jobs){
  if(!job||!uuid.test(job.id)||job.conversation_id!==conversation.id||
     job.timeline_id!==conversation.activeTimelineId||
     job.timeline_epoch!==(conversation.timelineEpoch??0)||
     !['completed','notified'].includes(job.status))continue;
  if(job.kind==='reply'&&!visibleMessages.some(m=>m.id===job.client_message_id&&m.role==='user'))continue;
  jobs.set(job.id,job);
 }
 const selected:ImportCandidate[]=[];
 for(const reply of snapshot.replies){
  if(!reply||!uuid.test(reply.job_id)||!id.test(reply.message_id)||
     reply.conversation_id!==conversation.id||
     typeof reply.body!=='string'||!reply.body.trim()||
     reply.body.length>100_000||seen.has(reply.message_id))continue;
  const job=jobs.get(reply.job_id);
  if(!job)continue;
  seen.add(reply.message_id);
  selected.push({job,reply});
 }
 return selected;
}
