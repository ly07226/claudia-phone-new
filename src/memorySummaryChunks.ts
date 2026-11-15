import {memoryTokenCost} from './memoryContext';
export interface SummaryChunkMessage {role:string;content:string;images:number;turnIndex?:number;part?:number}
export interface SummaryChunkTurn {messages:SummaryChunkMessage[]}
/** Preserve all text and chronology, splitting oversized turns into bounded API payloads. */
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
  const messages=turns[turnIndex].messages;
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
