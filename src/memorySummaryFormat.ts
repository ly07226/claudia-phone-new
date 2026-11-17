import {summaryLimits,type SummaryFact,type SummaryCategory,type SummaryDiagnostic,summaryQualityCategories} from './memorySummaryTypes';
export const summaryPrompt="你是聊天长期记忆提取器。输入是按轮次排列的聊天消息。请直接理解并提取对后续对话有价值的稳定事实、关系变化、偏好、承诺、重大事件和未完成事项。不要编造事实，不要混淆用户与角色、现实与角色扮演、否定与肯定、计划与完成。只输出JSON对象，例如：{\"memories\":[{\"content\":\"用户不喜欢别人碰自己的东西\",\"type\":\"fact\",\"kind\":\"long\"}]}。type可选fact、belief、speculation、pending，kind可选long、core；最多8条。无需输出quality、evidence、quote、turn、role或原文引用；没有值得保存的记忆时输出{\"memories\":[]}。不要Markdown或额外说明。";
export const summaryResponseSchema={type:'OBJECT',properties:{memories:{type:'ARRAY',items:{type:'OBJECT',properties:{type:{type:'STRING',enum:['fact','belief','speculation','pending']},kind:{type:'STRING',enum:['core','long']},content:{type:'STRING'},quality:{type:'OBJECT',properties:{category:{type:'STRING',enum:['identity','relationship','major-event','preference','boundary','habit','commitment','ongoing-conflict','continuity','routine','short-plan','resolved']},importance:{type:'STRING',enum:['high','medium','low']},durability:{type:'STRING',enum:['lasting','temporary']},impact:{type:'STRING'},evidence:{type:'ARRAY',items:{type:'OBJECT',properties:{turn:{type:'INTEGER'},role:{type:'STRING',enum:['user','assistant']},quote:{type:'STRING'}},required:['turn','role','quote']}}},required:['category','importance','durability','impact','evidence']}},required:['type','kind','content','quality']}}},required:['memories']};
export class SummaryFormatError extends Error {
 constructor(public diagnostic:SummaryDiagnostic){super(diagnostic.code==='empty'?'empty':'format');}
}
function reject(code:SummaryDiagnostic['code'],meta:Partial<SummaryDiagnostic>={}):never{throw new SummaryFormatError({version:1,stage:'parse',code,...meta});}
/** Only extract a single complete JSON value. Never repair incomplete JSON or execute prose surrounding the data.
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
/** Lightweight extraction: source ownership belongs to the timeline receipt, not model citations. */
export function parseSimpleSummary(raw:string):{facts:SummaryFact[];candidates:number;rejected:number}{
 const value=summaryJsonCandidate(raw);
 if(value&&typeof value==='object'&&!Array.isArray(value)&&['operation','deleteAll','resetDatabase','clear'].some(k=>Object.hasOwn(value,k)))reject('unexpected-field',{stage:'validate'});
 const rows=Array.isArray(value)?value:value&&typeof value==='object'?(value.memories??value.facts):undefined;
 if(!Array.isArray(rows))reject('root-shape',{stage:'validate'});
 if(rows.length>summaryLimits.facts*100)reject('too-many-facts',{stage:'validate'});
 const facts:SummaryFact[]=[];
 for(const item of rows){
  if(facts.length>=summaryLimits.facts)break;
  const content=typeof item==='string'?item:item?.content??item?.text??item?.memory;
  if(typeof content!=='string'||!content.trim()||content.length>summaryLimits.factChars||!/[\p{L}\p{N}]/u.test(content))continue;
  const type=typeof item==='string'?'fact':item.type??'fact';
  if(!['fact','belief','speculation','pending'].includes(type))continue;
  const kind=typeof item==='string'?'long':item.kind==='core'?'core':'long';
  facts.push({type,kind,content:content.trim()});
 }
 return {facts,candidates:rows.length,rejected:rows.length-facts.length};
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
   if(/[\p{L}\p{N}]/u.test(content))facts.push({type:'fact',content});
   continue;
  }
  if(!item||typeof item!=='object'||Array.isArray(item))continue;
  if(Object.hasOwn(item,'operation')||item.type!==undefined&&!['fact','belief','speculation','pending'].includes(item.type))reject('invalid-enum',{stage:'validate'});
  const rawContent=item.content??item.text??item.memory;
  if(typeof rawContent!=='string')continue;
  const content=rawContent.trim().slice(0,summaryLimits.factChars);
  if(!content||!/[\p{L}\p{N}]/u.test(content))continue;
  const type=typeof item.type==='string'&&['fact','belief','speculation','pending'].includes(item.type.toLowerCase())?item.type.toLowerCase() as SummaryCategory:'fact';
  const kind=item.kind==='core'||item.kind==='long'?item.kind:undefined;
  const quality=normalizeEvidenceQuality(item);facts.push({type,content,...(kind?{kind}:{}),...(quality?{quality}:{})});
 }
 // Empty valid JSON is a valid no-facts result; preserve event summaries separately.
 return facts;
}

/** Recover incomplete model metadata from the *actual* input, never from invented citations.
 * A model may omit quality fields; source quotes remain mandatory unless the
 * proposed memory itself appears verbatim in a source message.
 */
/** Formatting equivalence returns the real contiguous source slice, not a rewritten quote. */
function verifiedSourceQuote(message:string,quote:string){
 if(message.includes(quote))return quote;
 const chars:string[]=[],starts:number[]=[],ends:number[]=[];let offset=0;
 for(const symbol of message){const normalized=symbol.normalize('NFKC');for(let i=0;i<normalized.length;i++)if(!/[\s“”‘’"'，,。.!！?？、：:；;（）()]/u.test(normalized[i])){chars.push(normalized[i]);starts.push(offset);ends.push(offset+symbol.length);}offset+=symbol.length;}
 const needle=quote.normalize('NFKC').replace(/[\s“”‘’"'，,。.!！?？、：:；;（）()]/gu,'');if(needle.length<4)return;
 const at=chars.join('').indexOf(needle);if(at<0)return;
 const actual=message.slice(starts[at],ends[at+needle.length-1]);return actual.length<=160?actual:undefined;
}
export interface RecoveredSummaryBatch {facts:SummaryFact[];candidates:number;rejected:{index:number;reason:import('./memorySummaryQuality').SummaryQualityRejection}[]}
/** Format recovery cannot invent facts or citations. Invalid candidates are
 * counted individually; only an invalid envelope aborts the extraction. */
export function recoverSummaryBatch(raw:string,input:string):RecoveredSummaryBatch{
 const value=summaryJsonCandidate(raw);
 if(value&&typeof value==='object'&&!Array.isArray(value)&&['operation','deleteAll','resetDatabase','clear'].some(k=>Object.hasOwn(value,k)))reject('unexpected-field',{stage:'validate'});
 const rows=Array.isArray(value)?value&&value:value&&typeof value==='object'?(value.memories??value.facts):undefined;
 if(!Array.isArray(rows))reject('root-shape',{stage:'validate'});
 if(rows.length>summaryLimits.facts*100)reject('too-many-facts',{stage:'validate'});
 const turns=JSON.parse(input) as {role:string;content:string}[][];
 const facts:SummaryFact[]=[],rejected:RecoveredSummaryBatch['rejected']=[];
 const object=(x:any)=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
 const normalize=(x:string)=>x.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').replace(/^第\d+轮/,'').replace(/^(?:用户|角色)(?:明确)?(?:表示|说|提到)?/u,'').replace(/^我/u,'');
 const polarity=(x:string)=>/不|没|无|未|拒绝|禁止|不能|不得/u.test(x);
 const uncertain=(x:string)=>/如果|假如|除非|也许|可能|猜测|怀疑|未证实/u.test(x);
 for(const [index,item] of rows.entries()){
  const bad=(reason:RecoveredSummaryBatch['rejected'][number]['reason'])=>rejected.push({index,reason});
  if(!item||typeof item!=='object'||Array.isArray(item)){bad('invalid-candidate');continue;}
  const rawContent=item.content??item.text??item.memory;
  if(typeof rawContent!=='string'||!rawContent.trim()||rawContent.length>summaryLimits.factChars){bad('invalid-candidate');continue;}
  const content=rawContent.trim(),type=typeof item.type==='string'?item.type.trim().toLowerCase():undefined;
  if(type!==undefined&&!['fact','belief','speculation','pending'].includes(type)){bad('invalid-candidate');continue;}
  if(item.kind!==undefined&&!['core','long'].includes(item.kind)){bad('invalid-candidate');continue;}
  const q={...object(item.quality)},source=object(item.source),provenance=object(item.provenance);
  const supplied=q.evidence??item.evidence??source.evidence??provenance.evidence;
  const evidenceRows=Array.isArray(supplied)?supplied:supplied&&typeof supplied==='object'?[supplied]:[];
  if(evidenceRows.length>4){bad('invalid-candidate');continue;}
  let invalidEvidence=false;const evidence:{turn:number;role:'user'|'assistant';quote:string}[]=[];
  for(const e of evidenceRows){
   const turn=typeof e?.turn==='string'&&/^\d+$/.test(e.turn)?Number(e.turn):e?.turn;
   const role=e?.role==='model'||e?.role==='ai'?'assistant':e?.role==='human'?'user':e?.role;
   if(!Number.isInteger(turn)||turn<1||!['user','assistant'].includes(role)||typeof e?.quote!=='string'||e.quote.length<4||e.quote.length>160){invalidEvidence=true;continue;}
   const quote=turns[turn-1]?.filter(m=>m.role===role).map(m=>verifiedSourceQuote(m.content,e.quote)).find(Boolean);
   if(quote)evidence.push({turn,role,quote});else invalidEvidence=true;
  }
  // Wrong explicit citations are not silently replaced. Missing citations may
  // be recovered only from strongly matching actual source clauses.
  if(invalidEvidence||!evidence.length&&evidenceRows.length){bad('unsupported-evidence');continue;}
  if(!evidence.length){
   const candidate=normalize(content),role=/^用户/u.test(content)?'user':/^角色/u.test(content)?'assistant':undefined;
   const pairs=(x:string)=>new Set(Array.from({length:Math.max(0,x.length-1)},(_,i)=>x.slice(i,i+2)));
   const target=pairs(candidate);let best:{turn:number;role:'user'|'assistant';quote:string;score:number}|undefined;
   if(candidate.length>=4)for(let i=0;i<turns.length;i++)for(const m of turns[i]){
    if(!['user','assistant'].includes(m.role)||role&&m.role!==role)continue;
    for(const clause of m.content.split(/[。！？!?\n]/u).map(x=>x.trim()).filter(x=>x.length>=4&&x.length<=160)){
     const text=normalize(clause);if(polarity(text)!==polarity(candidate)||uncertain(text)!==uncertain(candidate))continue;
     const numbers=(x:string)=>x.normalize('NFKC').match(/[+\-−]?\d+(?:\.\d+)?(?:[%％])?/g)?.map(n=>n.replace('−','-')).join('|')??'';
     if(numbers(clause.replace(/^第\d+轮[:：]\s*/u,''))!==numbers(content))continue;
     const found=pairs(text);let common=0;for(const token of target)if(found.has(token))common++;
     const score=common/Math.max(1,target.size);if(score>=.8&&(!best||score>best.score))best={turn:i+1,role:m.role as 'user'|'assistant',quote:clause.replace(/^第\d+轮[:：]\s*/u,''),score};
    }
   }
   if(best)evidence.push({turn:best.turn,role:best.role,quote:best.quote});
  }
  if(!evidence.length){bad('unsupported-evidence');continue;}
  const quality=normalizeEvidenceQuality({...item,quality:{category:q.category??item.category,importance:q.importance??item.importance,durability:q.durability??item.durability,impact:q.impact??item.impact,evidence}});
  if(!quality){bad('invalid-candidate');continue;}
  facts.push({type:(type??'fact') as SummaryCategory,...(item.kind?{kind:item.kind}:{}),content,quality});
 }
 if(rows.length&&!facts.length)reject('invalid-quality',{stage:'validate'});
 return {facts,candidates:rows.length,rejected};
}
/** Legacy callers can keep a strict failure for entirely unsupported output. */
export function parseSummaryWithSourceRecovery(raw:string,input:string):SummaryFact[]{
 const result=recoverSummaryBatch(raw,input);if(result.candidates&&!result.facts.length)reject('invalid-quality',{stage:'validate'});return result.facts;
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
 const impact=typeof q?.impact==='string'&&q.impact.trim()&&q.impact.length<=160?q.impact:'后续对话应保留这一有来源的事实及其状态';
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
