import {memoryTokenCost} from './memoryContext';
export interface SummaryChunkMessage {role:string;content:string;images:number;turnIndex?:number;part?:number}
export interface SummaryChunkTurn {messages:SummaryChunkMessage[]}
const MAX_TURN_CHARS=3000;
const OMITTED='【...后文省略】';
/** Conservative local redaction before summary API transmission.
 * Only replace explicitly sexual passages; keep surrounding relationship context.
 * This is a heuristic, not a guarantee that every euphemism will be recognized.
 */
const explicitActs=/(?:性交|做爱|口交|肛交|自慰|手淫|插入|抽插|射精|高潮|性器官|阴茎|阴道|龟头|乳头|下体|私处|床笫|性行为|性描写|性爱过程)/u;
const explicitEnglish=/\\b(?:penetrat(?:e|ion|ing)|masturbat(?:e|ion|ing)|orgasm|ejaculat(?:e|ion|ing)|genitals?|intercourse|fellatio|cunnilingus)\\b/i;
const OMITTED_ADULT='【亲密情节具体过程已省略】';
/** Operates on an ephemeral API projection, never on stored messages. */
export function redactSummaryAdultContent(content:string):string{
 const segments=content.split(/(\\n+)/);
 return segments.map(segment=>{
  if(!segment||/^\\n+$/.test(segment))return segment;
  // A long paragraph can contain ordinary story alongside an explicit passage.
  const pieces=segment.split(/(?<=[。！？!?；;])/u);
  let previousRedacted=false;
  return pieces.map(piece=>{
   const sensitive=explicitActs.test(piece)||explicitEnglish.test(piece);
   if(!sensitive){previousRedacted=false;return piece;}
   if(previousRedacted)return '';
   previousRedacted=true;
   return OMITTED_ADULT;
  }).join('');
 }).join('');
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
  const messages=limitSummaryTurn(turns[turnIndex].messages.map(message=>({...message,content:redactSummaryAdultContent(message.content)})));
  if(fits([...batch,messages])){batch.push(messages);continue;}
  if(fits([messages])){flush();batch.push(messages);continue;}
  flush();
  for(const message of messages){
   const chars=Array.from(message.content);let offset=0,part=0;
   if(!chars.length){append([{...message,turnIndex,part:1}]);continue;}
   while(offset<chars.length){
    let lo=1,hi=chars.length-offset,best=0;
    while(lo<=hi){
     const mid=Math.floor((lo+hi)/2);
     const candidate={...message,content:chars.slice(offset,offset+mid).join(''),turnIndex,part:part+1};
     if(fits([[candidate]])){best=mid;lo=mid+1;}else hi=mid-1;
    }
    if(!best)throw Error('input-too-large');
    append([{...message,content:chars.slice(offset,offset+best).join(''),turnIndex,part:++part}]);offset+=best;
   }
  }
 }
 flush();return inputs;
}
