import {describeReplyFailure} from './replyFailure';
import {SummaryResponseError} from './memorySummaryRequest';
export type SummaryErrorClass='offline'|'transient'|'quota'|'auth'|'safety'|'configuration'|'format'|'state';
export interface SummaryErrorDecision {kind:SummaryErrorClass;retry:boolean;reason:string}
/** Only network/server/rate failures are eligible for a second automatic attempt.
 * Do not persist raw provider errors, credentials, or response text.
 */
export function classifySummaryError(error:unknown,online=true):SummaryErrorDecision{
 if(!online)return {kind:'offline',retry:false,reason:'offline'};
 if(error instanceof SummaryResponseError){
  const code=error.diagnostic.code;
  return {kind:code==='blocked'?'safety':'format',retry:false,reason:code};
 }
 if(error instanceof Error&&/summary request timeout|timed out|超时/i.test(error.message))return {kind:'transient',retry:true,reason:'timeout'};
 const detail=describeReplyFailure(error);
 if(detail.kind==='network'||detail.kind==='server'||detail.kind==='rate')return {kind:'transient',retry:true,reason:detail.kind};
 if(detail.kind==='quota')return {kind:'quota',retry:false,reason:'quota'};
 if(detail.kind==='auth')return {kind:'auth',retry:false,reason:'auth'};
 if(detail.kind==='safety')return {kind:'safety',retry:false,reason:'safety'};
 const msg=error instanceof Error?error.message:'';
 if(/API 配置|Provider|Base URL|模型或接口不存在|不支持聊天|response.?format|response.?schema/i.test(msg))return {kind:'configuration',retry:false,reason:'configuration'};
 if(/stale-path|capacity|input-too-large|state/i.test(msg))return {kind:'state',retry:false,reason:'state'};
 return {kind:'state',retry:false,reason:'unknown'};
}
