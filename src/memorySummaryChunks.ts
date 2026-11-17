import {memoryTokenCost} from './memoryContext';
export interface SummaryChunkMessage {role:string;content:string;images:number;turnIndex?:number;part?:number}
export interface SummaryChunkTurn {messages:SummaryChunkMessage[]}
const MAX_TURN_CHARS=3000;
const OMITTED='【...后文省略】';
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
  const messages=limitSummaryTurn(turns[turnIndex].messages);
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
