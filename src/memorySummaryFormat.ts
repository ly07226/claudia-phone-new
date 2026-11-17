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

/** Recover incomplete model metadata from the *actual* input, never from invented citations.
 * A model may omit quality fields; source quotes remain mandatory unless the
 * proposed memory itself appears verbatim in a source message.
 */
export function parseSummaryWithSourceRecovery(raw:string,input:string):SummaryFact[]{
 const value=summaryJsonCandidate(raw);
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.memories))reject('root-shape',{stage:'validate'});
 const turns=JSON.parse(input) as {role:string;content:string}[][];
 const out:SummaryFact[]=[];
 for(const item of value.memories.slice(0,summaryLimits.facts)){
  if(!item||typeof item!=='object'||typeof item.content!=='string'||!item.content.trim()||item.content.length>summaryLimits.factChars)continue;
  const q=item.quality??{};
  const suppliedEvidence=Array.isArray(q.evidence)?q.evidence:Array.isArray(item.evidence)?item.evidence:[];
  const validEvidence=suppliedEvidence.filter((e:any)=>Number.isInteger(e?.turn)&&e.turn>0&&['user','assistant'].includes(e.role)&&typeof e.quote==='string'&&e.quote.length>=4&&turns[e.turn-1]?.some(m=>m.role===e.role&&m.content.includes(e.quote))).slice(0,4);
  // The only automatic evidence recovery allowed is a verbatim content match.
  if(!validEvidence.length)for(let i=0;i<turns.length;i++){const source=turns[i].find(m=>m.content.includes(item.content.trim())&&item.content.trim().length>=4);if(source){validEvidence.push({turn:i+1,role:source.role,quote:item.content.trim()});break;}}
  if(!validEvidence.length)continue;
  const category=summaryQualityCategories.includes(q.category)?q.category:'continuity';
  const importance=['high','medium','low'].includes(q.importance)?q.importance:'medium';
  const durability=['lasting','temporary'].includes(q.durability)?q.durability:'lasting';
  const impact=typeof q.impact==='string'&&q.impact.trim()?q.impact:'后续互动需要保留此来源明确的事实或状态';
  const type=['fact','belief','speculation','pending'].includes(item.type)?item.type:'fact';
  const kind=['core','long'].includes(item.kind)?item.kind:'long';
  out.push({type,kind,content:item.content.trim(),quality:{category,importance,durability,impact,evidence:validEvidence}});
 }
 if(value.memories.length&&!out.length)reject('invalid-quality',{stage:'validate'});
 return out;
}
/** Repair model-omitted classification metadata only when the original evidence is intact.
 * Never synthesize quotations, turns, or speakers. Source verification still runs downstream. */
function normalizeEvidenceQuality(m:any):any{
 const q=m?.quality;
 const evidence=Array.isArray(q?.evidence)?q.evidence:Array.isArray(m?.evidence)?m.evidence:undefined;
 if(!evidence?.length||evidence.length>4||evidence.some((e:any)=>!e||!Number.isInteger(e.turn)||e.turn<1||!['user','assistant'].includes(e.role)||typeof e.quote!=='string'||e.quote.length<4))return q;
 const content=String(m.content??'');
 const category=summaryQualityCategories.includes(q?.category)?q.category:
  /拒绝|不接受|禁止|不能|必须|边界/.test(content)?'boundary':
  /喜欢|偏好|讨厌|希望|更愿意/.test(content)?'preference':
  /关系|伴侣|恋人|夫妻|结婚|分手/.test(content)?'relationship':
  /承诺|保证|约定/.test(content)?'commitment':
  /每天|每周|每次|习惯|经常/.test(content)?'habit':
  /身份|名字|职业|年龄/.test(content)?'identity':
  /冲突|矛盾|争吵|决裂/.test(content)?'ongoing-conflict':
  /已经|完成|发生|离开|去世|入职/.test(content)?'major-event':'continuity';
 const importance=['high','medium','low'].includes(q?.importance)?q.importance:'medium';
 const durability=['lasting','temporary'].includes(q?.durability)?q.durability:'lasting';
 const impact=typeof q?.impact==='string'&&q.impact.trim()?q.impact:'后续对话应保留这一有来源的事实及其状态';
 return {category,importance,durability,impact,evidence};
}
/** Source-backed candidates for the primary durable memory pipeline. */
export function parseSummaryWithEvidence(raw:string):SummaryFact[]{
 const value=summaryJsonCandidate(raw);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='memories')||!Array.isArray(value.memories))reject('root-shape',{stage:'validate'});
 if(value.memories.length>summaryLimits.facts)reject('too-many-facts',{stage:'validate'});
 const result:SummaryFact[]=[];
 let invalidQualityCount=0;
 for(let i=0;i<value.memories.length;i++){
  const m=value.memories[i];
  if(!m||typeof m!=='object'||Array.isArray(m))reject('invalid-item',{stage:'validate',itemIndex:i});
  if(!['fact','belief','speculation','pending'].includes(m.type)||!['core','long'].includes(m.kind))reject('invalid-enum',{stage:'validate',itemIndex:i});
  if(typeof m.content!=='string'||!m.content.trim()||m.content.length>summaryLimits.factChars)reject('invalid-content',{stage:'validate',itemIndex:i});
  const q=normalizeEvidenceQuality(m);
  // Missing or malformed evidence is never invented. Reject only the offending
  // candidate so one imperfect model row cannot discard other grounded memories.
  if(!q||!summaryQualityCategories.includes(q.category)||!['high','medium','low'].includes(q.importance)||!['lasting','temporary'].includes(q.durability)||typeof q.impact!=='string'||!q.impact.trim()||!Array.isArray(q.evidence)||!q.evidence.length||q.evidence.length>4||q.evidence.some((e:unknown)=>!e||typeof e!=='object'||!Number.isInteger((e as any).turn)||(e as any).turn<1||!['user','assistant'].includes((e as any).role)||typeof (e as any).quote!=='string'||(e as any).quote.length<4)){invalidQualityCount++;continue;}
  result.push({type:m.type,kind:m.kind,content:m.content.trim(),quality:{category:q.category,importance:q.importance,durability:q.durability,impact:q.impact,evidence:q.evidence}});
 }
 // Never mark an entirely invalid model response as a successful empty memory batch.
 if(invalidQualityCount>0&&result.length===0)reject('invalid-quality',{stage:'validate'});
 return result;
}
