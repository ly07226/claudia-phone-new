import type {SummaryQualityRejection} from './memorySummaryQuality';
import type {MemoryScope} from './memoryTypes';
export const summaryLimits={inputTokens:12000,outputTokens:1600,outputChars:12000,facts:8,factChars:800,receipts:500,leaseMs:90000};
export type SummaryCategory='fact'|'belief'|'speculation'|'pending';
/** Request-only quality/evidence metadata; never added to stored MemoryEntry. */
export const summaryQualityCategories=['identity','relationship','major-event','preference','boundary','habit','commitment','ongoing-conflict','continuity','routine','short-plan','resolved'] as const;
export interface SummaryQuality {category:typeof summaryQualityCategories[number];importance:'high'|'medium'|'low';durability:'lasting'|'temporary';impact:string;evidence:{turn:number;role:'user'|'assistant';quote:string}[]}
export interface SummaryFact {type:SummaryCategory;content:string;quality?:SummaryQuality}
export interface SummaryTurn {userIds:string[];assistantId:string}
export interface SummarySelectionStats {candidates:number;accepted:number;rejected:number;reasons:Partial<Record<SummaryQualityRejection,number>>}
export interface SummaryReceipt {shortSummary?:string;selection?:SummarySelectionStats;id:string;revision:number;scope:MemoryScope;epoch:number;timelineId:string;throughNodeId:string;turns:SummaryTurn[];createdAt:number;added:number;duplicates:number}
export type SummaryFailure='provider'|'format'|'empty'|'stale-path'|'capacity'|'input-too-large'|'interrupted'|'state';
export const summaryDiagnosticCodes=['input-budget','truncated','json-syntax','ambiguous-json','root-shape','missing-field','unexpected-field','invalid-array','too-many-facts','empty','invalid-item','invalid-enum','invalid-content','empty-content','fact-too-long','output-limit','structured-unsupported','response-shape','invalid-quality'] as const;
export interface SummaryDiagnostic {version:1;stage:'input'|'response'|'parse'|'validate';code:typeof summaryDiagnosticCodes[number];suspectedTruncated?:boolean;missingFields?:('memories'|'type'|'content')[];itemIndex?:number;inputRounds?:number;pendingRounds?:number;inputTokenEstimate?:number;outputTokenLimit?:number;receivedChars?:number}
export const summaryDiagnosticText:Record<SummaryDiagnostic['code'],string>={'input-budget':'输入片段超过安全预算，未请求模型。',truncated:'模型输出疑似被截断，未写入；请减少总结区间或更换支持JSON且输出额度充足的模型，再手动重试。','json-syntax':'返回内容不是完整、有效的JSON。','ambiguous-json':'返回多个JSON对象，无法确定唯一结果。','root-shape':'根结构必须是包含memories的对象。','missing-field':'缺少必要字段。','unexpected-field':'包含协议之外的字段，结果已拒绝。','invalid-array':'memories必须是数组。','too-many-facts':'返回条数超过8条上限。',empty:'未提取到有效记忆。','invalid-item':'记忆条目不是对象。','invalid-enum':'type必须单选fact、belief、speculation或pending。','invalid-content':'content必须是字符串。','empty-content':'记忆内容为空或无有效文字。','fact-too-long':'单条记忆超过800字符。','output-limit':'返回内容超过安全长度。','structured-unsupported':'当前模型或接口拒绝JSON输出参数，请检查其结构化输出支持后手动重试。','response-shape':'接口未返回受支持的文本内容结构。','invalid-quality':'候选缺少有效的质量分级或来源证据，未写入记忆。'};
export interface MemorySummaryJob {retryable?:boolean;failureKind?:'offline'|'transient'|'quota'|'auth'|'safety'|'configuration'|'format'|'state';selection?:SummarySelectionStats;id:string;scope:MemoryScope;epoch:number;timelineId:string;snapshotHeadId:string;throughNodeId:string;status:'running'|'succeeded'|'failed';startedAt:number;leaseUntil:number;finishedAt?:number;error?:SummaryFailure;diagnostic?:SummaryDiagnostic;added?:number;duplicates?:number}
export interface SummaryCheckpoint {scope:MemoryScope;timelineId:string;throughNodeId:string;turns:SummaryTurn[];inputs:string[];completed:{facts:SummaryFact[];eventSummary?:string;candidates:number;accepted:number;rejected:number;reasons:Record<string,number>}[]}
export interface MemorySummaryState {autoAttempt?:{throughNodeId:string;count:number;pendingAtStart:number};deferUntilPending?:number;checkpoint?:SummaryCheckpoint;version:1;enabled:boolean;interval:number;revision:number;receipts:SummaryReceipt[];job?:MemorySummaryJob}
export const emptySummaryState=():MemorySummaryState=>({version:1,enabled:false,interval:50,revision:0,receipts:[]});
export const summaryFailureText:Record<SummaryFailure,string>={provider:'总结请求失败或已超时。聊天不受影响；可手动重试，重试可能再次计费。',format:'总结格式无效，未写入记忆。',empty:'没有提取到有效记忆，未记为成功；可稍后手动重试。','stale-path':'总结期间会话路径发生变化，结果未写入。',capacity:'记忆或总结进度达到安全容量上限，未清理旧记录。','input-too-large':'待总结片段超过输入预算，未调用模型。可手动分次总结安全范围；单轮过长时需先缩短该段。',interrupted:'上次总结未完成，不会自动重试；确认后可重新请求，可能再次消耗 Token。',state:'总结状态失效或无法保存，未确认写入成功。'};

export const summaryRejectionText:Record<SummaryQualityRejection,string>={'unsupported-evidence':'原文证据不匹配',temporary:'缺少持续价值','low-importance':'重要性不足','weak-impact':'持续影响依据不足','unsupported-inference':'推断依据不足','uncertain-as-fact':'计划或不确定内容被当作事实','lost-condition':'遗漏否定或条件','unsupported-detail':'细节或主体不一致','unattributed-view':'观点归属不明确'};
export function summaryResultText(job:MemorySummaryJob){
 const s=job.selection;
 if(!s)return `新增 ${job.added??0} 条长期记忆，跳过 ${job.duplicates??0} 条重复内容。旧记录未保存候选筛选统计。`;
 const outcome=job.added?'成功新增记忆。':!s.candidates?'模型未提取到符合条件的长期记忆。':!s.accepted?'提取到候选，但全部被质量筛选过滤。':'候选与已有记忆重复。';
 const reasons=Object.entries(s.reasons).sort((a,b)=>b[1]!-a[1]!).map(([key,n])=>`${summaryRejectionText[key as SummaryQualityRejection]} ${n}`).join('、');
 return `${outcome}候选 ${s.candidates}，接受 ${s.accepted}，质量过滤 ${s.rejected}，重复 ${job.duplicates??0}，新增 ${job.added??0}。${reasons?`过滤原因：${reasons}。`:''}`;
}
