import type {ApiConfig} from './api';
import {storyLengths,storyLimits,type StoryLength} from './storyTypes';
// Session-local provider evidence only. No model-name guesses, credentials,
// requests, user settings or database writes; refresh discards this cache.
const ceilings=new Map<string,number>();
const identity=(c:ApiConfig)=>JSON.stringify([c.id,c.provider,c.protocol,c.baseUrl,c.model,c.updatedAt]);
export function storyOutputBudget(c:ApiConfig,length:StoryLength){
 const known=ceilings.get(identity(c));
 return {limit:Math.min(storyLengths[length].tokens,storyLimits.outputTokens,known??Infinity),...(known?{modelLimit:known}:{})};
}
export function rememberStoryOutputLimit(c:ApiConfig,limit:number){
 if(!Number.isSafeInteger(limit)||limit<1||limit>1_000_000)return;
 const key=identity(c);ceilings.set(key,Math.min(limit,ceilings.get(key)??Infinity));
 if(ceilings.size>24)ceilings.delete(ceilings.keys().next().value!);
}
/** Inspect only a failed provider envelope; never infer a limit from prose,
 * a context-window size or the requested max_tokens value. Retain scalars only. */
export function storyProviderBudgetError(data:unknown):{contextWindow?:true;modelLimit?:number;outputRejected?:true}{
 const error=(data as {error?:{code?:unknown;message?:unknown}})?.error;
 const code=typeof error?.code==='string'?error.code.toLowerCase():'';
 if(/invalid_api_key|permission_denied|insufficient_quota|insufficient_balance|rate_limit|content_policy|safety/.test(code))return {};
 const message=typeof error?.message==='string'?error.message.slice(0,4000):'';
 if(code==='context_length_exceeded'||/maximum context length|context (?:window|length).{0,35}(?:exceed|limit|maximum)|exceed.{0,30}context (?:window|length)/i.test(message))return {contextWindow:true};
 const field='(?:max_tokens|max_completion_tokens|maxOutputTokens|maximum output tokens|output token limit)';
 const rejected=new RegExp(field+'[^.\\n]{0,100}(?:too (?:large|high)|exceed|must be|maximum|at most|less than|<=|≤|range)','i').test(message)||new RegExp('(?:maximum|at most|limit)[^.\\n]{0,80}'+field,'i').test(message);
 if(!rejected)return {};
 const patterns=[
  new RegExp(field+'[^.\\n]{0,80}?(?:less than or equal to|at most|maximum(?: is| of|:)?|<=|≤)\\s*([\\d,]+)','i'),
  new RegExp(field+'[^.\\n]{0,80}?less than\\s+([\\d,]+)','i'),
  new RegExp(field+'[^\\n]{0,180}?supports? (?:at most|up to)\\s*([\\d,]+)\\s*(?:output|completion) tokens','i'),
  /(?:maximum|at most|limit of)\s*([\d,]+)\s*(?:output|completion) tokens/i,
  new RegExp(field+'[^.\\n]{0,80}?(?:range|between)\\s*\\[?\\s*\\d+\\s*(?:,|and|to)\\s*([\\d,]+)','i'),
 ];
 for(let i=0;i<patterns.length;i++){const match=message.match(patterns[i]);if(!match)continue;const limit=Number(match[1].replace(/,/g,''))-(i===1?1:0);if(Number.isSafeInteger(limit)&&limit>=1&&limit<=1_000_000)return {outputRejected:true,modelLimit:limit};}
 return {outputRejected:true};
}
