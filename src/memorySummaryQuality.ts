import type {SummaryFact,SummaryCategory} from './memorySummaryTypes';
import {SummaryFormatError} from './memorySummaryFormat';
export type SummaryQualityRejection='unsupported-evidence'|'temporary'|'low-importance'|'weak-impact'|'unsupported-inference'|'uncertain-as-fact'|'lost-condition'|'unsupported-detail'|'unattributed-view';
const evidenceText=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
const negative=/(?:不|没|无|未|别(?!的|人|处)|勿|拒绝|禁止|避免|不能|不得)/u;
const uncertainty=/(?:如果|假如|除非|也许|可能|似乎|猜测|怀疑|不确定|未证实)/u;
const future=/(?:计划|打算|准备|将要|将会|以后|今后|未来|下次|会去|要去|要给|还没|尚未|未完成|约好|承诺)/u;
const completed=/(?:已经|已完成|完成了|实现了|发生了|做过|去了|买了|结婚了|搬了家)/u;
const view=/(?:认为|觉得|相信|在.{0,8}看来|主观|猜测|怀疑|可能|未确认|未证实)/u;
const durable=/(?:长期|持续|一直|从此|以后|今后|不再|再也|终身|永久|多年|每次|每天|每周|习惯|尚未解决|关系|伴侣|夫妻|身份|改变|导致|影响|必须|去世|死亡|重伤|确诊|入职|离职|失业|搬家|破产|结婚|离婚|决裂|和解)/u;
const emotional=[/爱上|深爱|爱情|恋爱|喜欢(?:用户|角色|对方|他|她)/u,/占有欲|独占|占有|控制欲/u,/性格|温柔|体贴|细心|内向|外向|偏执|天生|一贯|本质/u];
/** Take the actual source clause and preceding conditional context, rather than
 * trusting an excerpt that silently omits "if", "not", or "not yet".
 */
function sourceContext(message:string,quote:string){
 const text=evidenceText(message),start=text.indexOf(evidenceText(quote)),before=text.slice(0,start),end=start+evidenceText(quote).length;
 const sentenceStart=Math.max(...['。','！','？','!','?','\n'].map(c=>before.lastIndexOf(c)))+1;
 const sentenceEnd=text.slice(end).search(/[。！？!?\n]/u);
 const sentence=text.slice(sentenceStart,sentenceEnd<0?text.length:end+sentenceEnd);
 const prefix=text.slice(sentenceStart,start);
 const clauseStart=Math.max(before.lastIndexOf('，'),before.lastIndexOf(','),sentenceStart-1)+1;
 const after=text.slice(end),clauseEnd=after.search(/[，,。！？!?\n]/u);
 return {clause:text.slice(clauseStart,clauseEnd<0?text.length:end+clauseEnd),conditional:uncertainty.test(prefix),sentence};
}
/** Format validation is atomic. Quality rejection is content selection, not an
 * API failure: valid candidates may produce a genuinely empty selection.
 */
export function selectSummaryCandidates(facts:SummaryFact[],input:string){
 const turns=JSON.parse(input) as {role:string;content:string}[][];
 for(let i=0;i<facts.length;i++)if(!facts[i].quality)throw new SummaryFormatError({version:1,stage:'validate',code:'invalid-quality',itemIndex:i});
 const accepted:SummaryFact[]=[],rejected:{index:number;reason:SummaryQualityRejection}[]=[];
 facts.forEach((fact,index)=>{
  const q=fact.quality!;let reason:SummaryQualityRejection|undefined;
  const evidence=q.evidence.map(e=>{const source=turns[e.turn-1]?.find(m=>m.role===e.role&&evidenceText(m.content).includes(evidenceText(e.quote)));return source?sourceContext(source.content,e.quote):undefined;});
  const sentences=evidence.filter((e):e is NonNullable<typeof e>=>!!e).map(e=>e.sentence).join('\n');
  const clauses=evidence.filter((e):e is NonNullable<typeof e>=>!!e).map(e=>e.clause).join('\n');
  if(evidence.some(e=>!e))reason='unsupported-evidence';
  else if(q.durability!=='lasting'||['routine','short-plan','resolved'].includes(q.category))reason='temporary';
  else if(q.importance==='low')reason='low-importance';
  else if(q.impact.length<6||/^(?:对未来有影响|有重要影响|值得记住|影响后续|持续影响|以后要记得)[。.!！]?$/u.test(q.impact))reason='weak-impact';
  else if(emotional.some(group=>group.test(fact.content)&&!group.test(clauses)))reason='unsupported-inference';
  else if(fact.type==='fact'&&(evidence.some(e=>e!.conditional)||uncertainty.test(clauses)||/我认为|我觉得|我相信|在我看来/u.test(clauses)||((future.test(clauses)||(/明天|今晚|待会|周末|下周/u.test(clauses)&&!completed.test(clauses)))&&(q.category!=='boundary'||!/拒绝|不要|不能|必须|只有|请先|别(?!的)|勿/u.test(clauses)||completed.test(fact.content)))))reason='uncertain-as-fact';
  else if(/^(?:第\d+轮[:：]\s*)?我(?:的|叫|是|喜欢|不喜欢|拒绝|不接受|习惯|每天|一直|已经|承诺|长期承诺|保证|认为|觉得|相信|怀疑)/u.test(evidence[0]!.clause)&&/^(用户|角色)/u.test(fact.content)&&!fact.content.startsWith(q.evidence[0].role==='user'?'用户':'角色'))reason='unsupported-detail';
  else if(fact.type!=='fact'&&!view.test(fact.content)&&fact.type!=='pending')reason='unattributed-view';
  else if(fact.type==='belief'&&!/认为|觉得|相信|看来/u.test(clauses))reason='unsupported-inference';
  else if(fact.type==='pending'&&completed.test(clauses)&&!future.test(clauses)&&!/尚未|未完成|还没|剩余|仍需|尚欠/u.test(clauses))reason='unsupported-detail';
  else if(['preference','habit'].includes(q.category)&&negative.test(fact.content)&&!negative.test(clauses))reason='unsupported-detail';
  else if(fact.type==='speculation'&&!uncertainty.test(clauses))reason='unsupported-inference';
  else if(negative.test(clauses)&&!negative.test(fact.content))reason='lost-condition';
  else if(/只有|必须|前提|除非|只要|先.{0,12}才/u.test(sentences)&&!/只有|必须|前提|除非|只要|先.{0,12}才/u.test(fact.content))reason='lost-condition';
  else if(q.category==='habit'&&!/每天|每周|每次|习惯|经常|通常|总是|一直|一向|多年|长期/u.test(clauses))reason='unsupported-inference';
  else if(q.category==='preference'&&!/喜欢|偏好|讨厌|不爱|宁愿|希望|在意|接受|拒绝/u.test(clauses))reason='unsupported-inference';
  else if(q.category==='relationship'&&!/关系|伴侣|恋人|夫妻|结婚|离婚|分手|订婚|家人|信任|决裂|和解|绝交|疏远|兄妹|兄弟/u.test(clauses))reason='unsupported-inference';
  else if(['major-event','ongoing-conflict','continuity'].includes(q.category)&&!durable.test(clauses))reason='weak-impact';
  else if(fact.type==='pending'&&/今天|明天|今晚|周末|待会|下班后|过一会|晚点|下周/u.test(clauses)&&!durable.test(clauses))reason='temporary';
  else if(!aligned(fact.content,clauses))reason='unsupported-detail';
  else if(numbers(fact.content).some(n=>!numbers(clauses).includes(n)))reason='unsupported-detail';
  if(reason)rejected.push({index,reason});else accepted.push(fact);
 });
 accepted.sort((a,b)=>Number(b.quality!.importance==='high')-Number(a.quality!.importance==='high'));
 return {accepted,rejected};
}
const canonical=(text:string)=>text.replace(/^【[^】]+】/,'').normalize('NFKC').toLowerCase().replace(/^(角色|用户)(?:明确)?(?:表示|表达|说道|说|提到)自己/u,'$1').replace(/明确(?:表示|表达|说道|说)|表示|表达|说道|提到/gu,'').replace(/[\s\p{P}\p{S}]/gu,'');
const shingles=(s:string)=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));
const numbers=(s:string):string[]=>evidenceText(s).match(/\d+(?:\.\d+)?/g)??[];
const anchors=(s:string)=>shingles(s.replace(/用户|角色|双方|自己|明确|表示|表达|认为|觉得|之后|以后|当前|这次|已经|可能|我们|你们/gu,'').replace(/[\s\p{P}\p{S}]/gu,''));
function aligned(content:string,source:string){const a=anchors(content),b=anchors(source);let count=0;for(const x of a)if(b.has(x))count++;return count>0&&count/Math.max(1,Math.min(a.size,b.size))>=.2;}
const category=(s:string):SummaryCategory|undefined=>s.startsWith('【已发生事实】')?'fact':s.startsWith('【人物主观判断】')?'belief':s.startsWith('【猜测（未证实）】')?'speculation':s.startsWith('【未完成事项】')?'pending':undefined;
function critical(s:string){return JSON.stringify([s.match(/\d+(?:\.\d+)?|[零一二三四五六七八九十百千万两]+(?:年|月|天|岁|元|次)/gu)??[],s.match(/不|没|无|未|拒绝|禁止|避免|如果|除非|只有|必须/gu)??[],s.match(/用户|角色|双方/gu)??[]]);}
/** Skip only; never merge/edit an existing entry. Critical numbers, negation,
 * conditions, speaker order and epistemic category must agree for near matches.
 */
export function summaryDuplicateIndex(records:readonly string[]){
 const known=records.map(content=>({text:canonical(content),type:category(content)}));
 return {has(fact:SummaryFact){const text=canonical(fact.content);return known.some(old=>{
  if(old.type&&old.type!==fact.type)return false;
  if(old.text===text)return true;
  if(Math.min(old.text.length,text.length)<12||Math.min(old.text.length,text.length)/Math.max(old.text.length,text.length)<.9||critical(old.text)!==critical(text))return false;
  const a=shingles(old.text),b=shingles(text);let overlap=0;for(const token of a)if(b.has(token))overlap++;
  return 2*overlap/(a.size+b.size)>=.92;
 });},add(fact:SummaryFact){known.push({text:canonical(fact.content),type:fact.type});}};
}
