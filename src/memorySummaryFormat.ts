import {summaryLimits,type SummaryFact,type SummaryCategory,type SummaryDiagnostic,summaryQualityCategories} from './memorySummaryTypes';
export const summaryPrompt='主记忆提取必须输出带quality和逐字evidence的结构化JSON；不允许使用旧版无证据协议。';
export const summaryResponseSchema={type:'OBJECT',properties:{memories:{type:'ARRAY',items:{type:'OBJECT',properties:{type:{type:'STRING',enum:['fact','belief','speculation','pending']},kind:{type:'STRING',enum:['core','long']},content:{type:'STRING'},quality:{type:'OBJECT',properties:{category:{type:'STRING',enum:['identity','relationship','major-event','preference','boundary','habit','commitment','ongoing-conflict','continuity','routine','short-plan','resolved']},importance:{type:'STRING',enum:['high','medium','low']},durability:{type:'STRING',enum:['lasting','temporary']},impact:{type:'STRING'},evidence:{type:'ARRAY',items:{type:'OBJECT',properties:{turn:{type:'INTEGER'},role:{type:'STRING',enum:['user','assistant']},quote:{type:'STRING'}},required:['turn','role','quote']}}},required:['category','importance','durability','impact','evidence']}},required:['type','kind','content','quality']}}},required:['memories']};
export class SummaryFormatError extends Error {
 constructor(public diagnostic:SummaryDiagnostic){super(diagnostic.code==='empty'?'empty':'format');}
}
function reject(code:SummaryDiagnostic['code'],meta:Partial<SummaryDiagnostic>={}):never{throw new SummaryFormatError({version:1,stage:'parse',code,...meta});}
/** Only extract a single complete JSON value. Never repair JSON, discard invalid
 * rows, infer a missing category, or execute prose surrounding the data.
 */
export function summaryJsonCandidate(raw:string){
 if(raw.length>summaryLimits.outputChars)reject('output-limit');
 const text=raw.replace(/^\uFEFF/,'').trim();
 try{return JSON.parse(text);}catch{/* A complete value may have a prose/fence wrapper. */}
 const values:{start:number;end:number}[]=[];let start=-1,quoted=false,escape=false;const stack:string[]=[];
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(start<0){if(c==='{'||c==='['){start=i;stack.push(c);}continue;}
  if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}
  if(c==='"')quoted=true;
  else if(c==='{'||c==='[')stack.push(c);
  else if(c==='}'||c===']'){const open=stack.pop();if(open!==(c==='}'?'{':'['))reject('json-syntax');if(!stack.length){values.push({start,end:i+1});start=-1;}}
 }
 if(start>=0||quoted)reject('truncated',{suspectedTruncated:true});
 if(values.length>1)reject('ambiguous-json');
 if(values.length!==1)reject('json-syntax');
 const value=values[0],outside=text.slice(0,value.start)+text.slice(value.end);
 const fences=outside.match(/```[^\n`]*/g)??[];
 if(fences.length&&(fences.length!==2||fences.some(f=>!/^```(?:json)?\s*$/i.test(f))))reject('json-syntax',{suspectedTruncated:fences.length===1});
 if(/[{}\[\]]/.test(outside))reject('json-syntax');
 try{return JSON.parse(text.slice(value.start,value.end));}catch{reject('json-syntax');}
}
export function parseSummary(raw:string):SummaryFact[]{
 if(raw.length>summaryLimits.outputChars)reject('output-limit');
 const value=summaryJsonCandidate(raw);
 // Accept a JSON array and the common alternative "facts" key from compatible models.
 const source=Array.isArray(value)?value:value&&typeof value==='object'?(value.memories??value.facts):undefined;
 if(!Array.isArray(source))reject('invalid-array',{stage:'validate'});
 const facts:SummaryFact[]=[];
 for(const item of source){
  if(facts.length>=summaryLimits.facts)break;
  if(typeof item==='string'){
   const content=item.trim().slice(0,summaryLimits.factChars);
   if(/[\\p{L}\\p{N}]/u.test(content))facts.push({type:'fact',content});
   continue;
  }
  if(!item||typeof item!=='object'||Array.isArray(item))continue;
  const rawContent=item.content??item.text??item.memory;
  if(typeof rawContent!=='string')continue;
  const content=rawContent.trim().slice(0,summaryLimits.factChars);
  if(!content||!/[\\p{L}\\p{N}]/u.test(content))continue;
  const type=typeof item.type==='string'&&['fact','belief','speculation','pending'].includes(item.type.toLowerCase())?item.type.toLowerCase() as SummaryCategory:'fact';
  const kind=item.kind==='core'||item.kind==='long'?item.kind:undefined;
  facts.push({type,content,...(kind?{kind}:{})});
 }
 // Empty valid JSON is a valid no-facts result; preserve event summaries separately.
 return facts;
}

/** Source-backed candidates for the primary durable memory pipeline. */
export function parseSummaryWithEvidence(raw:string):SummaryFact[]{
 const value=summaryJsonCandidate(raw);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='memories')||!Array.isArray(value.memories))reject('root-shape',{stage:'validate'});
 if(value.memories.length>summaryLimits.facts)reject('too-many-facts',{stage:'validate'});
 const result:SummaryFact[]=[];
 for(let i=0;i<value.memories.length;i++){
  const m=value.memories[i];
  if(!m||typeof m!=='object'||Array.isArray(m))reject('invalid-item',{stage:'validate',itemIndex:i});
  if(!['fact','belief','speculation','pending'].includes(m.type)||!['core','long'].includes(m.kind))reject('invalid-enum',{stage:'validate',itemIndex:i});
  if(typeof m.content!=='string'||!m.content.trim()||m.content.length>summaryLimits.factChars)reject('invalid-content',{stage:'validate',itemIndex:i});
  const q=m.quality;
  if(!q||!summaryQualityCategories.includes(q.category)||!['high','medium','low'].includes(q.importance)||!['lasting','temporary'].includes(q.durability)||typeof q.impact!=='string'||!q.impact.trim()||!Array.isArray(q.evidence)||!q.evidence.length||q.evidence.length>4||q.evidence.some((e:unknown)=>!e||typeof e!=='object'||!Number.isInteger((e as any).turn)||(e as any).turn<1||!['user','assistant'].includes((e as any).role)||typeof (e as any).quote!=='string'||(e as any).quote.length<4))reject('invalid-quality',{stage:'validate',itemIndex:i});
  result.push({type:m.type,kind:m.kind,content:m.content.trim(),quality:{category:q.category,importance:q.importance,durability:q.durability,impact:q.impact,evidence:q.evidence}});
 }
 return result;
}
