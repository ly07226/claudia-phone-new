import {summaryLimits} from './memorySummaryTypes';
import {chatYield} from './chatCooperative';
import {memoryTokenCost} from './memoryContext';
export interface SummaryChunkMessage {role:string;content:string;images:number;turnIndex?:number;part?:number}
export interface SummaryChunkTurn {messages:SummaryChunkMessage[]}
const MAX_TURN_CHARS=3000;
const OMITTED='【...后文省略】';
/** Conservative local redaction before summary API transmission.
 * Only replace explicitly sexual passages; keep surrounding relationship context.
 * This is a heuristic, not a guarantee that every euphemism will be recognized.
 */
const explicitActs=/(?:性交|做爱|口交|肛交|自慰|手淫|插入|抽插|射精|高潮|性器官|阴茎|阴道|龟头|乳头|下体|私处|床笫|性行为|性描写|性爱过程|肉棒|阳具|阴蒂|精液|体液|湿透|顶弄|挺入|贯穿|进入她|进入他|舔舐|吮吸|揉捏|抚弄|喘息|呻吟|律动|撞击|高潮迭起|交合|交媾|欲火|欲望宣泄|床上运动|衣衫尽褪|褪去衣物|赤裸相对)/u;
const explicitEnglish=/\b(?:penetrat(?:e|ion|ing)|masturbat(?:e|ion|ing)|orgasm|ejaculat(?:e|ion|ing)|genitals?|intercourse|fellatio|cunnilingus|thrust(?:ing)?|climax(?:ed|ing)?|naked|moan(?:ing)?)\b/i;
const OMITTED_ADULT='【亲密情节具体过程已省略】';
const isExplicit=(text:string)=>explicitActs.test(text)||explicitEnglish.test(text);
/** Redact entire adjacent explicit paragraphs, not merely the triggering sentence.
 * Preserve ordinary story paragraphs and negation/relationship statements outside
 * the removed block. This is a local best-effort filter, not a safety guarantee.
 */
export function redactSummaryAdultContent(content:string):string{
 // Preserve ordinary relationship/commitment sentences even when the same
 // paragraph contains explicit detail. No source database mutation.
 return content.split(/(?<=[。！？!?；;\n])/u).map(part=>isExplicit(part)?OMITTED_ADULT:part).join('').replace(/(?:【亲密情节具体过程已省略】\s*){2,}/gu,OMITTED_ADULT);
}
/** Truncate only the summary API projection; never mutate original chat messages.
 * Count Unicode code points and apply the limit to the entire completed turn,
 * not independently to each message.
 */
export function limitSummaryTurn(messages:SummaryChunkMessage[]):SummaryChunkMessage[]{
 const total=messages.reduce((n,m)=>n+Array.from(m.content).length,0);
 if(total<=MAX_TURN_CHARS)return messages;
 let remaining=MAX_TURN_CHARS-Array.from(OMITTED).length;
 let marked=false;
 return messages.flatMap(message=>{
  if(marked)return [];
  const chars=Array.from(message.content);
  const take=Math.min(remaining,chars.length);
  remaining-=take;
  if(take<chars.length){marked=true;return [{...message,content:chars.slice(0,take).join('')+OMITTED}];}
  if(remaining===0){marked=true;return [{...message,content:message.content+OMITTED}];}
  return [message];
 });
}
/** Build bounded summary API payloads; preserve source messages in storage. */
export function buildSummaryInputs(turns:SummaryChunkTurn[],systemPrompt:string,budget:number):string[]{
 const base=memoryTokenCost(systemPrompt);
 if(base>=budget)throw Error('input-too-large');
 const inputs:string[]=[];let batch:SummaryChunkMessage[][]=[];
 const fits=(candidate:SummaryChunkMessage[][])=>base+memoryTokenCost(JSON.stringify(candidate))<=budget;
 const flush=()=>{if(batch.length){inputs.push(JSON.stringify(batch));batch=[];}};
 const append=(messages:SummaryChunkMessage[])=>{
  if(fits([...batch,messages])){batch.push(messages);return;}
  flush();if(!fits([messages]))throw Error('input-too-large');batch.push(messages);
 };
 for(let turnIndex=0;turnIndex<turns.length;turnIndex++){
  const messages=turns[turnIndex].messages.map(message=>({...message,turnIndex:message.turnIndex??turnIndex,content:redactSummaryAdultContent(message.content)}));
  if(fits([...batch,messages])){batch.push(messages);continue;}
  if(fits([messages])){flush();batch.push(messages);continue;}
  flush();
  for(const message of messages){
   const chars=Array.from(message.content);let offset=0,part=0;
   if(!chars.length){append([{...message,turnIndex:message.turnIndex??turnIndex,part:1}]);continue;}
   while(offset<chars.length){
    let lo=1,hi=Math.min(chars.length-offset,Math.max(1,budget-base)),best=0;
    while(lo<=hi){
     const mid=Math.floor((lo+hi)/2);
     const candidate={...message,content:chars.slice(offset,offset+mid).join(''),turnIndex:message.turnIndex??turnIndex,part:part+1};
     if(fits([[candidate]])){best=mid;lo=mid+1;}else hi=mid-1;
    }
    if(!best)throw Error('input-too-large');
    append([{...message,content:chars.slice(offset,offset+best).join(''),turnIndex:message.turnIndex??turnIndex,part:++part}]);offset+=best;
   }
  }
 }
 flush();return inputs;
}

/** Bounded UTF-16 projections plus real task yields, including for a single huge
 * message. Surrogate pairs remain intact. This is not an omission limit. */
export async function buildSummaryInputsCooperative(turns:SummaryChunkTurn[],system:string,budget:number){
 const out:string[]=[],queue:SummaryChunkTurn[]=[];
 const flush=async()=>{if(!queue.length)return;const next=buildSummaryInputs(queue,system,budget);queue.length=0;
  if(out.length&&next.length){const joined=[...JSON.parse(out[out.length-1]),...JSON.parse(next[0])];if(memoryTokenCost(system)+memoryTokenCost(JSON.stringify(joined))<=budget){out[out.length-1]=JSON.stringify(joined);next.shift();}}
  out.push(...next);if(out.length>summaryLimits.maxChunks)throw Error('input-too-large');await chatYield();
 };
 for(let i=0;i<turns.length;i++){
  const messages=turns[i].messages.map(m=>({...m,turnIndex:i,content:redactSummaryAdultContent(m.content)}));
  if(messages.every(m=>m.content.length<=2048))queue.push({messages});
  else for(const m of messages){let at=0,part=0;if(!m.content.length)queue.push({messages:[m]});while(at<m.content.length){let end=Math.min(m.content.length,at+2048);if(end<m.content.length&&/[\uD800-\uDBFF]/.test(m.content[end-1]))end--;queue.push({messages:[{...m,content:m.content.slice(at,end),part:++part,images:at===0?m.images:0}]});at=end;if(queue.length>=8)await flush();}}
  if(queue.length>=8)await flush();
 }
 await flush();return out;
}
