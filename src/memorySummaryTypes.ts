import type {MemoryScope} from './memoryTypes';
export const summaryLimits={inputTokens:12000,outputTokens:1600,outputChars:12000,facts:8,factChars:800,receipts:500,leaseMs:90000};
export type SummaryCategory='fact'|'belief'|'speculation'|'pending';
export interface SummaryFact {type:SummaryCategory;content:string}
export interface SummaryTurn {userIds:string[];assistantId:string}
export interface SummaryReceipt {id:string;revision:number;scope:MemoryScope;epoch:number;timelineId:string;throughNodeId:string;turns:SummaryTurn[];createdAt:number;added:number;duplicates:number}
export type SummaryFailure='provider'|'format'|'empty'|'stale-path'|'capacity'|'input-too-large'|'interrupted'|'state';
export interface MemorySummaryJob {id:string;scope:MemoryScope;epoch:number;timelineId:string;snapshotHeadId:string;throughNodeId:string;status:'running'|'succeeded'|'failed';startedAt:number;leaseUntil:number;finishedAt?:number;error?:SummaryFailure;added?:number;duplicates?:number}
export interface MemorySummaryState {version:1;enabled:boolean;interval:number;revision:number;receipts:SummaryReceipt[];job?:MemorySummaryJob}
export const emptySummaryState=():MemorySummaryState=>({version:1,enabled:false,interval:40,revision:0,receipts:[]});
export const summaryFailureText:Record<SummaryFailure,string>={provider:'总结请求失败或已超时。聊天不受影响；可手动重试，重试可能再次计费。',format:'总结格式无效，未写入记忆。',empty:'没有提取到有效记忆，未记为成功；可稍后手动重试。','stale-path':'总结期间会话路径发生变化，结果未写入。',capacity:'记忆或总结进度达到安全容量上限，未清理旧记录。','input-too-large':'待总结片段超过输入预算，未调用模型。可手动分次总结安全范围；单轮过长时需先缩短该段。',interrupted:'上次总结未完成，不会自动重试；确认后可重新请求，可能再次消耗 Token。',state:'总结状态失效或无法保存，未确认写入成功。'};
