import {browserTransport,type ApiConfig,type ApiTransport} from './api';
import {requestReply} from './chatProvider';
import {summaryLimits,type SummaryDiagnostic} from './memorySummaryTypes';
import {summaryPrompt,summaryResponseSchema} from './memorySummaryFormat';
export class SummaryResponseError extends Error {constructor(public diagnostic:SummaryDiagnostic){super('summary-response');}}
/** Summary-only protocol options/metadata. Normal chat requests are unchanged.
 * No fallback request is issued if an endpoint rejects structured output.
 */
export async function requestSummary(config:ApiConfig,key:string,input:string,signal:AbortSignal){
 const gemini=config.provider==='gemini'||(config.provider==='custom'&&config.protocol==='gemini');
 let diagnostic:SummaryDiagnostic|undefined;
 const transport:ApiTransport={send:async(url,init)=>{
  const body=JSON.parse(String(init.body));
  if(gemini)body.generationConfig={...body.generationConfig,responseMimeType:'application/json',responseSchema:summaryResponseSchema};
  else body.response_format={type:'json_object'};
  const response=await browserTransport.send(url,{...init,body:JSON.stringify(body)});
  let data:any;try{data=await response.clone().json();}catch{if(response.ok)diagnostic={version:1,stage:'response',code:'response-shape'};return response;}
  if(!response.ok){
   if([400,422].includes(response.status)&&/response[_ ]?format|response.?schema|responseMimeType|json[_ ]?object|json[_ ]?schema/i.test(String(data?.error?.param??'')+' '+String(data?.error?.message??'')))diagnostic={version:1,stage:'response',code:'structured-unsupported'};
   return response;
  }
  const finish=gemini?data?.candidates?.[0]?.finishReason:data?.choices?.[0]?.finish_reason;
  if(['length','max_tokens','MAX_TOKENS','FINISH_REASON_MAX_TOKENS'].includes(finish))diagnostic={version:1,stage:'response',code:'truncated',suspectedTruncated:true};
  // Some compatible Chat Completions endpoints return typed text blocks.
  const message=data?.choices?.[0]?.message;
  if(!gemini&&Array.isArray(message?.content)&&message.content.length&&message.content.every((p:any)=>p&&['text','output_text'].includes(p.type)&&typeof p.text==='string')){
   message.content=message.content.map((p:any)=>p.text).join('');
   return new Response(JSON.stringify(data),{status:response.status,headers:{'Content-Type':'application/json'}});
  }
  const content=gemini?data?.candidates?.[0]?.content?.parts?.filter((p:any)=>!p.thought).map((p:any)=>p.text??'').join(''):message?.content;
  if(!diagnostic&&(typeof content!=='string'||!content.trim()))diagnostic={version:1,stage:'response',code:'response-shape'};
  return response;
 }};
 try{
  const text=await requestReply({...config,maxTokens:Math.min(config.maxTokens,summaryLimits.outputTokens)},key,[{role:'system',content:summaryPrompt},{role:'user',content:input}],signal,transport,false);
  if(diagnostic)throw new SummaryResponseError({...diagnostic,outputTokenLimit:Math.min(config.maxTokens,summaryLimits.outputTokens)});
  return text;
 }catch(error){if(diagnostic)throw new SummaryResponseError({...diagnostic,outputTokenLimit:Math.min(config.maxTokens,summaryLimits.outputTokens)});throw error;}
}
