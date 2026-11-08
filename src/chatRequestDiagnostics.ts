import type {ContextMessage} from './chatTypes';

export type RequestMode='daily'|'world'|'story';
export type ContextSource='persona'|'mode'|'world'|'lore'|'memory'|'history'|'time'|'reference'|'story-instruction'|'story-input';
type Role=ContextMessage['role'];
export interface SourceInput {source:ContextSource;text:string;role?:Role;position?:string;depth?:number;scope?:'global'|'world'}
export interface FormatSignals {abcdLabels:number;choiceProtocolHint:boolean}
export interface SourceDiagnostic extends FormatSignals {source:ContextSource;chars:number;role?:Role;position?:string;depth?:number;scope?:'global'|'world';duplicateOf?:number}
export interface LoreDecision {trigger:'constant'|'instant'|'history';outcome:'injected'|'skipped';reason:string;scanned:number;matchedUser:number;matchedAssistant:number;crossMessage:boolean}
export interface RequestDiagnostics {
 sequence:number;ms:number;mode:RequestMode;status:'built'|'request'|'response'|'network-error'|'http-error'|'invalid-response';
 sources:SourceDiagnostic[];sourcesOmitted:number;lore:LoreDecision[];loreOmitted:number;
 skippedBooks:{disabled:number;outOfScope:number};history:{available:number;included:number};
 budget?:{systemLimit:number;historyLimit:number;loreAllowance:number;systemUsed:number;historyUsed:number};
 memory?:{selected:number;skippedIrrelevant:number;skippedBudget:number};
 attempts:{protocol:'gemini'|'openai';fallback:boolean;roles:Role[];characters:number;signals:FormatSignals}[];
 response?:FormatSignals&{chars:number};httpStatus?:number;
}
/** Explicit opt-in; volatile metadata only. No contents, hashes, IDs, URLs or keys. */
export const requestDebugEnabled=()=>typeof location!=='undefined'&&new URLSearchParams(location.search).get('requestDebug')==='1';
let records:readonly RequestDiagnostics[]=[],sequence=0;
const associations=new WeakMap<ContextMessage[],number>();
const listeners=new Set<()=>void>();
export const subscribeRequestDiagnostics=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f);};};
export const getRequestDiagnostics=()=>requestDebugEnabled()?records:empty;
const empty:readonly RequestDiagnostics[]=[];
export const exportRequestDiagnostics=()=>JSON.stringify({notice:'仅为来源元数据；格式特征不等于指令或污染证据；最多保留20次请求。无正文，无持久ID。',requests:getRequestDiagnostics()},null,2);
export function formatSignals(text:string):FormatSignals {
 const labels=new Set<string>();
 // Memory facts are JSON data: their newlines are escaped. Decode only line
 // separators for this metadata heuristic, never the request or response text.
 const lines=text.replace(/\\r\\n|\\n|\\r/g,'\n');
 for(const m of lines.matchAll(/(?:^|[\n"])\s*([ABCD])[.．、:：)）]\s*/g))labels.add(m[1]);
 for(const m of text.matchAll(/"(?:id|label)"\s*:\s*"([ABCD])"/g))labels.add(m[1]);
 return {abcdLabels:labels.size,choiceProtocolHint:/恰好四|四个.{0,8}选项|A\/B\/C\/D|\bchoices\b/u.test(text)};
}
function update(messages:ContextMessage[],change:(r:RequestDiagnostics)=>RequestDiagnostics){
 if(!requestDebugEnabled())return;
 try{const id=associations.get(messages);if(id===undefined)return;records=records.map(r=>r.sequence===id?change(r):r);for(const f of listeners)f();}catch{/* Diagnostics never affect generation. */}
}
export function registerRequestDiagnostics(mode:RequestMode,messages:ContextMessage[],sources:SourceInput[],details:{lore?:LoreDecision[];skippedBooks?:RequestDiagnostics['skippedBooks'];history?:RequestDiagnostics['history'];memory?:RequestDiagnostics['memory'];budget?:RequestDiagnostics['budget']}={}){
 if(!requestDebugEnabled())return;
 try{
  const safeSources=sources.slice(0,200).map((s,i):SourceDiagnostic=>{
   const duplicate=sources.findIndex((other,j)=>j<i&&other.text===s.text&&s.text.length>0);
   return {source:s.source,chars:s.text.length,...formatSignals(s.text),...(s.role?{role:s.role}:{}),...(['before-profile','after-profile','before-conversation','after-conversation','at-depth'].includes(s.position??'')?{position:s.position}:{}),...(Number.isFinite(s.depth)?{depth:s.depth}:{}),...(s.scope?{scope:s.scope}:{}),...(duplicate>=0?{duplicateOf:duplicate}:{})};
  });
  // Copy known scalar fields only; never copy diagnostic caller objects wholesale.
  const decisions=(details.lore??[]).slice(0,1000).map(d=>({trigger:d.trigger,outcome:d.outcome,reason:reasons.has(d.reason)?d.reason:'unknown',scanned:d.scanned,matchedUser:d.matchedUser,matchedAssistant:d.matchedAssistant,crossMessage:d.crossMessage}));
  const record:RequestDiagnostics={sequence:++sequence,ms:Math.round(performance.now()),mode,status:'built',sources:safeSources,sourcesOmitted:Math.max(0,sources.length-safeSources.length),lore:decisions,loreOmitted:Math.max(0,(details.lore?.length??0)-decisions.length),skippedBooks:{disabled:details.skippedBooks?.disabled??0,outOfScope:details.skippedBooks?.outOfScope??0},history:{available:details.history?.available??0,included:details.history?.included??0},...(details.memory?{memory:{selected:details.memory.selected,skippedIrrelevant:details.memory.skippedIrrelevant,skippedBudget:details.memory.skippedBudget}}:{}),...(details.budget?{budget:{systemLimit:details.budget.systemLimit,historyLimit:details.budget.historyLimit,loreAllowance:details.budget.loreAllowance,systemUsed:details.budget.systemUsed,historyUsed:details.budget.historyUsed}}:{}),attempts:[]};
  associations.set(messages,record.sequence);records=[...records.slice(-19),record];for(const f of listeners)f();
 }catch{/* No diagnostics failure may prevent a request. */}
}
const reasons=new Set(['injected','book-disabled','entry-disabled','compatibility-paused','no-user-message','regex-error','primary-miss','secondary-miss','probability','context-budget','book-budget']);
export function linkRequestDiagnostics(from:ContextMessage[],to:ContextMessage[]){if(requestDebugEnabled()){const id=associations.get(from);if(id!==undefined)associations.set(to,id);}}
export function recordRequestAttempt(messages:ContextMessage[],protocol:'gemini'|'openai',roles:Role[]){
 update(messages,r=>({...r,status:'request',attempts:[...r.attempts.slice(-1),{protocol,fallback:r.attempts.length>0,roles:[...roles],characters:messages.reduce((n,m)=>n+m.content.length,0),signals:formatSignals(messages.map(m=>m.content).join('\n'))}]}));
}
export function recordRequestResponse(messages:ContextMessage[],text:string){update(messages,r=>({...r,status:'response',response:{chars:text.length,...formatSignals(text)}}));}
export function recordRequestFailure(messages:ContextMessage[],status:'network-error'|'http-error'|'invalid-response',httpStatus?:number){update(messages,r=>({...r,status,...(httpStatus===undefined?{}:{httpStatus})}));}
