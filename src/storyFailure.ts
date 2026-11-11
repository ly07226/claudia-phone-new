import {ReplyRequestError,type ReplyFailureDetails} from './replyFailure';
export const storyFailureStages=['configuration','admission','request','response','parse','validation','commit'] as const;
export type StoryFailureStage=typeof storyFailureStages[number];
const codes=['config-missing','config-invalid','network','timeout','auth','quota','rate','server','http-error','unknown','cancelled','stale','budget','storage-failed','admission-failed','response-too-long','empty-response','json-invalid','json-incomplete','json-ambiguous','root-shape','body-invalid','choice-count','choice-shape','choice-label','choice-text','choice-duplicate','truncated','blocked','envelope-invalid','envelope-shape','validation-failed','output-limit','context-window'] as const;
export type StoryFailureCode=typeof codes[number];
const serviceCodes=['insufficient_quota','insufficient_balance','credit_balance_too_low','billing_hard_limit_reached','rate_limit_exceeded','resource_exhausted','invalid_api_key','permission_denied','content_policy_violation','content_filter','safety','prohibited_content'];
const finishReasons=['length','MAX_TOKENS','max_tokens','stop','STOP','SAFETY','RECITATION','PROHIBITED_CONTENT','BLOCKLIST','content_filter'];
export interface StoryFailure {
 version:1;code:StoryFailureCode;stage:StoryFailureStage;attempted:boolean;
 httpStatus?:number;serviceCode?:string;finishReason?:string;responseCharacters?:number;choiceCount?:number;outputTokenLimit?:number;modelOutputLimit?:number;
}
const fields=['version','code','stage','attempted','httpStatus','serviceCode','finishReason','responseCharacters','choiceCount','outputTokenLimit','modelOutputLimit'];
const count=(x:unknown,max=1_000_000_000)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0&&x<=max;
/** Strict optional-field schema, also used for old/new backup compatibility.
 * No free text, identifiers, response body, request headers or credentials. */
export function validStoryFailure(value:unknown):value is StoryFailure {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const x=value as StoryFailure;
 return Object.keys(x).every(k=>fields.includes(k))&&x.version===1&&codes.includes(x.code)&&storyFailureStages.includes(x.stage)&&typeof x.attempted==='boolean'&&
  (x.httpStatus===undefined||count(x.httpStatus,599)&&x.httpStatus>=100)&&
  (x.serviceCode===undefined||serviceCodes.includes(x.serviceCode))&&(x.finishReason===undefined||finishReasons.includes(x.finishReason))&&
  (x.responseCharacters===undefined||count(x.responseCharacters))&&(x.choiceCount===undefined||count(x.choiceCount))&&
  (x.outputTokenLimit===undefined||count(x.outputTokenLimit,1_000_000)&&x.outputTokenLimit>0)&&(x.modelOutputLimit===undefined||count(x.modelOutputLimit,1_000_000)&&x.modelOutputLimit>0);
}
/** Copy only known, bounded scalar metadata, never spread the provider error. */
export function makeStoryFailure(code:StoryFailureCode,stage:StoryFailureStage,attempted:boolean,meta:Partial<StoryFailure>={}):StoryFailure {
 return {version:1,code,stage,attempted,
  ...(count(meta.httpStatus,599)&&meta.httpStatus!>=100?{httpStatus:meta.httpStatus}:{}),
  ...(serviceCodes.includes(meta.serviceCode??'')?{serviceCode:meta.serviceCode}:{}),
  ...(finishReasons.includes(meta.finishReason??'')?{finishReason:meta.finishReason}:{}),
  ...(count(meta.responseCharacters)?{responseCharacters:meta.responseCharacters}:{}),...(count(meta.choiceCount)?{choiceCount:meta.choiceCount}:{}),
  ...(count(meta.modelOutputLimit,1_000_000)&&meta.modelOutputLimit!>0?{modelOutputLimit:meta.modelOutputLimit}:{}),
  ...(count(meta.outputTokenLimit,1_000_000)&&meta.outputTokenLimit!>0?{outputTokenLimit:meta.outputTokenLimit}:{})};
}
export const storyStageLabels:Record<StoryFailureStage,string>={configuration:'API 配置检查',admission:'请求前校验',request:'API 请求',response:'HTTP / 模型响应',parse:'JSON 解析',validation:'正文及选项校验',commit:'本地保存'};
export function storyFailureReason(f:StoryFailure):string {
 switch(f.code){
 case 'config-missing':return '未配置可用的全局默认 API，未发送模型请求。';
 case 'config-invalid':return 'API 配置缺失或无效，请检查启用状态、密钥、地址、模型及协议；未发送模型请求。';
 case 'network':return f.stage==='response'&&f.httpStatus?'回复传输中断，未确认收到完整剧情。':'网络连接失败，未收到可确认的 HTTP 响应。';
 case 'timeout':return '请求超时，无法确认服务端是否已完成或计费。';
 case 'auth':return 'API 认证失败或访问权限不足。';
 case 'quota':return `服务商明确返回余额或配额不足${f.httpStatus?`（HTTP ${f.httpStatus}）`:''}。`;
 case 'rate':return `服务商明确返回请求频率限制${f.httpStatus?`（HTTP ${f.httpStatus}）`:''}。`;
 case 'server':return `服务商接口返回服务器错误${f.httpStatus?`（HTTP ${f.httpStatus}）`:''}。目前只能确认请求在服务端失败，不能据此判断是内容拦截、余额不足还是服务商临时故障。${f.serviceCode?` 服务商错误代码：${f.serviceCode}。`:''}`;
 case 'http-error':return `API 请求失败${f.httpStatus?`（HTTP ${f.httpStatus}）`:''}，暂时无法确定具体失败原因。`;
 case 'output-limit':return `服务商拒绝本次输出 Token 上限${f.modelOutputLimit?`，明确允许的上限为 ${f.modelOutputLimit}`:''}。未自动重试；确认后可主动重试，已知上限仅在本次应用运行期间生效。`;
 case 'context-window':return '服务商明确表示输入与输出合计超过模型上下文窗口；这与单独的输出上限不同。未自动重试，请选择具有足够上下文容量的模型。';
 case 'empty-response':return '模型未返回可用文本内容，未生成有效剧情。';
 case 'truncated':return '服务商标记模型输出被截断，未接受不完整剧情。';
 case 'envelope-invalid':return 'API 响应不是有效 JSON，无法读取模型返回内容。';
 case 'envelope-shape':return 'API 响应中的模型文本字段结构无法识别。';
 case 'blocked':return `服务商明确返回内容安全拦截${f.httpStatus?`（HTTP ${f.httpStatus}）`:''}。`;
 case 'json-incomplete':return '已收到模型内容，但返回的 JSON 不完整。';
 case 'json-invalid':return '已收到模型内容，但无法解析为有效的剧情 JSON。';
 case 'json-ambiguous':return '模型返回多个 JSON 对象，无法确定唯一剧情结果。';
 case 'root-shape':return '模型返回的剧情 JSON 结构不符合正文和选项协议。';
 case 'body-invalid':return '模型正文为空、类型不正确或超过安全长度，未保存。';
 case 'choice-count':case 'choice-shape':case 'choice-label':case 'choice-text':case 'choice-duplicate':return '已收到正文，但未能识别四个有效且互不重复的 ABCD 选项。';
 case 'response-too-long':return '模型返回内容超过安全长度，未保存。';
 case 'validation-failed':return '剧情结果未通过保存前校验，未推进主线。';
 case 'storage-failed':return '已收到有效剧情，但本地保存失败，原进度未被覆盖。';
 case 'stale':return '世界设定或主线进度已变化，过期结果未保存。';
 case 'cancelled':return '生成已取消或中断，不能确认服务端是否计费。';
 case 'budget':return '必要设定或当前剧情超过安全输入预算，未请求模型。';
 case 'admission-failed':return '请求前校验未完成，未确认发出新的模型请求。';
 default:return '暂时无法确定失败原因。';
 }
}
export function storyFailureMessage(f:StoryFailure){return `${storyFailureReason(f)} 原进度未改变，不会自动重试。`;}
export class StoryGenerationError extends ReplyRequestError {
 constructor(public readonly failure:StoryFailure){
  const kind:ReplyFailureDetails['kind']=failure.code==='timeout'?'network':(['network','auth','quota','rate','server'].includes(failure.code)?failure.code:failure.code==='blocked'?'safety':'unknown') as ReplyFailureDetails['kind'];
  super(storyFailureMessage(failure),{kind,reason:storyFailureReason(failure),suggestion:failure.stage==='configuration'?'请在 AI / API 设置中检查全局默认配置。':'请核对错误详情及服务商记录；手动重试可能再次产生费用。',...(failure.httpStatus?{httpStatus:failure.httpStatus}:{}),...(failure.serviceCode?{serviceCode:failure.serviceCode}:{})});
 }
}
export const storyFailureFromError=(error:unknown)=>error instanceof StoryGenerationError?error.failure:undefined;
