import {cloudConfigured,cloudFunctionRequest,hasCloudIdentity} from './cloudIdentity';
export type BackgroundJobStatus='queued'|'running'|'completed'|'notified'|'failed'|'cancelled'|'expired';
export interface BackgroundJobSnapshot {
 id:string;conversation_id:string;client_message_id:string;timeline_id:string;
 timeline_epoch:number;kind:'reply'|'proactive';status:BackgroundJobStatus;
 error_code:string|null;updated_at:string;
}
export interface BackgroundReplySnapshot {
 job_id:string;message_id:string;conversation_id:string;body:string;created_at:string;
}
export interface BackgroundSyncSnapshot {
 ok:true;jobs:BackgroundJobSnapshot[];replies:BackgroundReplySnapshot[];
}
/** Read-only: caller must validate timeline/epoch and deduplicate message_id
 * before importing replies into local Dexie. Never import blindly. */
export async function fetchBackgroundSnapshot(conversationId:string):Promise<BackgroundSyncSnapshot|null>{
 if(!cloudConfigured()||!hasCloudIdentity())return null;
 const response=await cloudFunctionRequest('claudia-sync-replies','POST',{conversationId});
 const value:unknown=await response.json();
 if(!value||typeof value!=='object'||!(value as {ok?:unknown}).ok)throw Error('后台回复同步失败。');
 const parsed=value as Partial<BackgroundSyncSnapshot>;
 if(!Array.isArray(parsed.jobs)||!Array.isArray(parsed.replies))throw Error('后台回复同步格式错误。');
 return {ok:true,jobs:parsed.jobs,replies:parsed.replies};
}
