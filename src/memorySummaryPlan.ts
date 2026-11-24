import type {ApiConfig} from './api';
import {memoryTokenCost} from './memoryContext';
import {recoverSummaryBatch,summaryJsonCandidate,SummaryFormatError} from './memorySummaryFormat';
import {summaryDuplicateIndex} from './memorySummaryQuality';
import type {SummaryFact} from './memorySummaryTypes';
/** No model-name guesses or paid discovery. UTF-8 bytes are a conservative token
 * upper-bound proxy, not a tokenizer measurement. Undeclared contexts use 8192. */
export function summaryRequestBudget(config:Pick<ApiConfig,'maxTokens'> & {contextWindowTokens?:number;modelOutputTokens?:number}){
 const declared=config.contextWindowTokens;
 const context=Number.isSafeInteger(declared)&&declared!>=1024?declared!:8192;
 const modelOutput=Number.isSafeInteger(config.modelOutputTokens)&&config.modelOutputTokens!>0?config.modelOutputTokens!:Infinity;
 const output=Math.min(config.maxTokens,modelOutput,4096,Math.max(128,Math.floor(context/2)));
 return {output,input:Math.max(128,Math.min(6000,context-output-512)),context,declared:Number.isSafeInteger(declared)&&declared!>=1024};
}
export function splitSummaryInput(input:string):string[]{
 const turns=JSON.parse(input) as any[][];
 if(turns.length>1){const n=Math.ceil(turns.length/2);return [JSON.stringify(turns.slice(0,n)),JSON.stringify(turns.slice(n))];}
 const messages=turns[0];if(messages.length>1){const n=Math.ceil(messages.length/2);return [JSON.stringify([messages.slice(0,n)]),JSON.stringify([messages.slice(n)])];}
 const m=messages[0],text=Array.from(m?.content??'') as string[];
 if(text.length<16)return [];
 const n=Math.ceil(text.length/2);return [text.slice(0,n),text.slice(n)].map((part,i)=>JSON.stringify([[{...m,content:part.join(''),part:(m.part??0)*2+i+1}]]));
}
/** Missing optional metadata is recovered only from real source clauses. Reject
 * individual unsupported claims; never manufacture citations, repair prose or
 * infer that a plan succeeded. These guards are conservative, not semantic proof. */
export function reviewIntervalSummary(raw:string,input:string){
 let value:any;
 try{value=summaryJsonCandidate(raw);}catch(error){
  if(!(error instanceof SummaryFormatError)||!['json-syntax','root-shape'].includes(error.diagnostic.code)||/[{}\[\]`]/.test(raw))throw error;
  const lines=raw.trim().split(/\n+/).map(s=>s.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/,'').trim()).filter(s=>s.length>0);
  if(!lines.length||lines.length>8||lines.some(s=>s.length>800))throw error;
  value={memories:lines.map(content=>({content,type:'belief',kind:'long'}))};
 }
 if(value&&typeof value==='object'&&!Array.isArray(value)&&['operation','deleteAll','resetDatabase','clear'].some(k=>Object.hasOwn(value,k)))throw new SummaryFormatError({version:1,stage:'validate',code:'unexpected-field'});const rows=Array.isArray(value)?value:value?.memories??value?.facts;
 const normalized=Array.isArray(rows)?JSON.stringify({memories:rows.map((r:unknown)=>typeof r==='string'?{content:r}:r)}):raw;
 const parsed=recoverSummaryBatch(normalized,input),accepted:SummaryFact[]=[],rejected=[...parsed.rejected];
 const negative=(s:string)=>/不是|没有|不能|不会|未完成|不想|不愿|不要|不喜欢|不接受|不允许|不可能|不打算|不希望|拒绝|禁止|否认/u.test(s);
 const uncertain=(s:string)=>/如果|假如|除非|可能|也许|猜测|打算|计划|准备|明天|下周/u.test(s);
 const nums=(s:string)=>s.match(/[+\-−]?\d+(?:\.\d+)?/g)?.join('|')??'';
 for(const [index,f]of parsed.facts.entries()){
  const evidence=f.quality!.evidence,quotes=evidence.map(e=>e.quote).join('；');let reason:typeof rejected[number]['reason']|undefined;
  if(/如果|除非|只有|必须|前提/u.test(quotes)&&!/如果|除非|只有|必须|前提/u.test(f.content))reason='lost-condition';
  else if(f.type==='fact'&&uncertain(quotes))reason='uncertain-as-fact';
  else if(negative(f.type==='pending'?quotes.replace(/尚未完成|未完成|还没完成|仍未完成/g,''):quotes)!==negative(f.type==='pending'?f.content.replace(/尚未完成|未完成|还没完成|仍未完成/g,''):f.content))reason='lost-condition';
  else if(['belief','speculation'].includes(f.type)&&!/用户|角色|双方|认为|觉得|相信|猜测|可能|怀疑/u.test(f.content))reason='unattributed-view';
  else if(nums(quotes)!==nums(f.content))reason='unsupported-detail';
  else if(/^用户/.test(f.content)&&evidence.every(e=>e.role!=='user')||/^角色/.test(f.content)&&evidence.every(e=>e.role!=='assistant'))reason='unsupported-detail';
  if(reason)rejected.push({index,reason});else accepted.push(f);
 }
 if(parsed.candidates&&!accepted.length)throw new SummaryFormatError({version:1,stage:'validate',code:'invalid-quality'});
 return {facts:accepted,candidates:parsed.candidates,rejected};
}
/** Lossless local reduction tree. Do not pay a model to re-invent already checked
 * facts. Pages retain chronology, uncertainty and source-turn labels; only exact
 * duplicate facts disappear. Old states stay dated historical facts, not current
 * state overwrites. Generic semantic contradiction resolution is not claimed. */
export function mergeIntervalSummary(facts:SummaryFact[],sourceTurns:number[]){
 const known=summaryDuplicateIndex([]),rows:{text:string;key:string;current:boolean}[]=[];
 const ordered=facts.map((fact,i)=>({fact,turn:sourceTurns[i]})).sort((a,b)=>a.turn-b.turn);
 const slots=new Map<string,number>();
 for(const {fact:f,turn}of ordered){if(known.has(f))continue;known.add(f);
  // Only recognize an otherwise identical, explicitly sourced subject/statement.
  // Do not infer that a different topic, promise or hypothetical supersedes it.
  const key=f.type==='fact'?f.quality?.evidence[0]?.role+':'+f.content.normalize('NFKC').replace(/没有|不再|不|尚未|已经|仍然|现在|曾经|明确|表示|[\s\p{P}]/gu,''):'';
  const old=key?slots.get(key):undefined;if(old!==undefined)rows[old].current=false;
  if(key)slots.set(key,rows.length);
  rows.push({text:`第${turn+1}轮【${f.type}】${f.content}`,key,current:true});
 }
 const lines=rows.map(r=>r.current?r.text:r.text+'（历史状态，已被后续明确表态取代）');
 let pages:string[]=[];let page='';for(const row of lines){if(page&&memoryTokenCost(page+'\n'+row)>6000){pages.push(page);page='';}page+=(page?'\n':'')+row;}if(page)pages.push(page);
 // Merge bounded groups recursively without truncating their leaves.
 while(pages.length>1){const next:string[]=[];for(let i=0;i<pages.length;i+=8)next.push(pages.slice(i,i+8).join('\n'));if(next.length===pages.length)break;pages=next;}
 return pages[0]??'';
}
