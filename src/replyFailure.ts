/** Presentation metadata only: no raw response body, request, identifiers or credentials. */
export type ReplyFailureKind='quota'|'rate'|'network'|'auth'|'safety'|'server'|'unknown';
export interface ReplyFailureDetails{kind:ReplyFailureKind;reason:string;suggestion:string;httpStatus?:number;serviceCode?:string;serviceMessage?:string}
const messages:Record<ReplyFailureKind,[string,string]>={quota:['服务商明确返回余额或配额不足。','请检查服务商的余额、配额或计费设置后手动重试。'],rate:['服务商明确返回请求频率限制。','请稍候再手动重试，并检查服务商的速率限制。'],network:['网络连接失败或请求超时。','请检查网络及接口的浏览器访问权限后手动重试。'],auth:['API 认证失败或访问权限不足。','请检查 API Key、模型权限及服务商访问设置。'],safety:['服务商明确返回内容安全拦截。','请查看服务商的安全政策；系统不会自动重试。'],server:['服务端暂时无法完成请求。','请稍候检查服务状态，再决定是否手动重试。'],unknown:['暂时无法确定失败原因。','请检查接口配置及服务状态；确认后再手动重试。']};
export function safeReplyErrorText(value:unknown,secrets:readonly string[]=[]){
 if(typeof value!=='string')return undefined;
 let text=value;for(const secret of secrets)if(secret)text=text.split(secret).join('[凭据已隐藏]');
 if(/"(?:messages|contents|prompt|choices)"\s*:/i.test(text))return '服务错误包含请求或响应正文，已隐藏。';
 text=text.replace(/Bearer\s+[^\s"',;}]+/gi,'Bearer [凭据已隐藏]').replace(/\bsk-[^\s"',;]+/gi,'[凭据已隐藏]').replace(/([?&](?:key|api[_-]?key|token)=)[^\s&#"']+/gi,'$1[凭据已隐藏]').replace(/(["']?(?:authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|secret)["']?\s*(?:[:=]|\bis\b|为|是)\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1[凭据已隐藏]').replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi,'https://[凭据已隐藏]@').replace(/[\u0000-\u0008\u000b-\u001f]/g,'').trim();
 return text?text.slice(0,1800)+(text.length>1800?'…（服务信息已截短）':''):undefined;
}
const knownCodes=new Set(['insufficient_quota','insufficient_balance','credit_balance_too_low','billing_hard_limit_reached','rate_limit_exceeded','resource_exhausted','invalid_api_key','permission_denied','content_policy_violation','content_filter','safety','prohibited_content']);
export function replyFailureDetails(input:{httpStatus?:number;code?:unknown;message?:unknown;network?:boolean;blocked?:boolean},secrets:readonly string[]=[]):ReplyFailureDetails{
 const status=Number.isInteger(input.httpStatus)&&input.httpStatus!>=100&&input.httpStatus!<=599?input.httpStatus:undefined;
 const code=typeof input.code==='string'?input.code.toLowerCase():'';
 // Only the provider's error.message is inspected, never user messages or generated text.
 const evidence=code+' '+(typeof input.message==='string'?input.message.slice(0,8000):'');
 let kind:ReplyFailureKind='unknown';
 if(input.network)kind='network';
 else if(/insufficient[_ ](?:quota|balance|credit)|billing[_ ]hard[_ ]limit|quota[_ ](?:exceeded|exhausted)|credit.balance.{0,20}(low|insufficient)|余额不足|余额已用尽|exceeded.{0,20}(current quota|billing)/i.test(evidence))kind='quota';
 else if(input.blocked||/content_policy_violation|content_filter|\bsafety\b|prohibited_content|blocked.{0,15}(safety|content policy)|内容安全.{0,12}(拦截|阻止)/i.test(evidence))kind='safety';
 else if(/rate[_ -]?limit|too many requests|请求.{0,8}频率.{0,8}(限制|过高)/i.test(evidence))kind='rate';
 else if(status===401||status===403||/invalid_api_key|permission_denied/i.test(code))kind='auth';
 else if(status&&status>=500)kind='server';
 const [reason,suggestion]=messages[kind];return {kind,reason,suggestion,...(status?{httpStatus:status}:{}),...(knownCodes.has(code)?{serviceCode:code}:{}),...(safeReplyErrorText(input.message,secrets)?{serviceMessage:safeReplyErrorText(input.message,secrets)}:{})};
}
export class ReplyRequestError extends Error{constructor(message:string,public readonly replyFailure:ReplyFailureDetails){super(message);}}
export function describeReplyFailure(error:unknown):ReplyFailureDetails{
 if(error instanceof ReplyRequestError)return error.replyFailure;
 const message=error instanceof Error?error.message:'';
 const note=safeReplyErrorText(message),extra=note&&!['invalid','budget','request','stale'].includes(message)?{serviceMessage:note}:{};
 if(/网络请求失败|网络连接失败|请求已取消或超时/.test(message))return {...replyFailureDetails({network:true}),...extra};
 if(/API 认证失败|API 缺少凭据/.test(message))return {kind:'auth',reason:messages.auth[0],suggestion:messages.auth[1],...extra};
 return {...replyFailureDetails({}),...extra};
}
