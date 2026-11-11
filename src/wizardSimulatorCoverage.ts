import type {SimulatorSection} from './wizardSimulatorDocument';
export interface SimulatorAnalysisChunk {id:string;start:number;end:number;text:string;headings:string[]}
export interface SimulatorCoverage {total:number;covered:number;complete:boolean;gaps:{start:number;end:number}[]}
/** Partition the ENTIRE original source without sampling or silently truncating. */
export function planSimulatorAnalysis(body:string,sections:SimulatorSection[],maxChars=8000):SimulatorAnalysisChunk[]{
 if(!Number.isInteger(maxChars)||maxChars<500)throw Error('分段大小无效');
 if(!body)return [];
 const chunks:SimulatorAnalysisChunk[]=[];let start=0;
 while(start<body.length){
  const hardEnd=Math.min(body.length,start+maxChars);let end=hardEnd;
  if(hardEnd<body.length){
   const newline=body.lastIndexOf('\n',hardEnd-1);
   if(newline>start+Math.floor(maxChars/2))end=newline+1;
  }
  const headings=sections.filter(s=>s.start<end&&s.end>start).map(s=>s.heading);
  chunks.push({id:'chunk-'+chunks.length,start,end,text:body.slice(start,end),headings:[...new Set(headings)]});
  start=end;
 }
 return chunks;
}
export function checkSimulatorCoverage(body:string,chunks:Pick<SimulatorAnalysisChunk,'start'|'end'|'text'>[]):SimulatorCoverage{
 const sorted=[...chunks].sort((a,b)=>a.start-b.start),gaps:{start:number;end:number}[]=[];
 let cursor=0,covered=0,valid=true;
 for(const c of sorted){
  if(!Number.isInteger(c.start)||!Number.isInteger(c.end)||c.start<0||c.end>body.length||c.end<=c.start||c.text!==body.slice(c.start,c.end)){valid=false;continue;}
  if(c.start>cursor)gaps.push({start:cursor,end:c.start});
  if(c.start<cursor)valid=false;
  covered+=Math.max(0,c.end-Math.max(cursor,c.start));cursor=Math.max(cursor,c.end);
 }
 if(cursor<body.length)gaps.push({start:cursor,end:body.length});
 return {total:body.length,covered,complete:valid&&gaps.length===0&&covered===body.length,gaps};
}
