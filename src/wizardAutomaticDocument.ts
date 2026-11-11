import {readLongNarrative,storePreparedSource} from './wizardLongNarrative';
import {reviewSimulatorChunk} from './wizardSimulatorReview';
import {listSimulatorReviews,saveSimulatorReview,type SavedSimulatorReview,type SimulatorDecision} from './wizardSimulatorReviewStore';
import {planSimulatorAnalysis,checkSimulatorCoverage} from './wizardSimulatorCoverage';
import {indexSimulatorDocument} from './wizardSimulatorDocument';
import {simulatorAuditStatus} from './wizardSimulatorAudit';
import {compileAutomaticMechanics,conditionEvidence} from './wizardAutomaticMechanics';
import {findSimulatorReviewPairs} from './wizardSimulatorConflicts';
import type {DocumentRuntimeConfig} from './wizardRuntimeConfig';
export interface AutomaticPreparation {version:1;chunkChars:2000;reviews:SavedSimulatorReview[];decisions:SimulatorDecision[];runtime?:DocumentRuntimeConfig;deferred:number}
const abort=(signal:AbortSignal)=>{if(signal.aborted)throw Error('准备已中断，原文与已完成部分已保存。点击重新准备后继续，不会自动重试。');};
/** One bounded sequential pass, initiated only by upload/retry; cache committed chunks across refresh. */
export async function prepareAutomaticDocument(id:string,signal:AbortSignal,onProgress?:(done:number,total:number)=>void){
 if(!navigator.locks)throw Error('当前浏览器不支持安全准备，请更新浏览器后重试。');
 return navigator.locks.request('claudia-auto-document:'+id,{ifAvailable:true},async lock=>{
  if(!lock)throw Error('另一页面正在准备此剧本，请等待完成。');abort(signal);let source=await readLongNarrative(id);if(!source)throw Error('上传原文不存在，请重新上传。');if(source.preparation)return source.preparation;
  if(new TextEncoder().encode(JSON.stringify(source)).length>12*1024*1024)throw Error('完整原文归档超过单世界12 MiB安全容量，文件已保留，未发起AI请求。');
  const chunks=planSimulatorAnalysis(source.body,indexSimulatorDocument(source.body),2000);if(!checkSimulatorCoverage(source.body,chunks).complete)throw Error('文档读取不完整，未开始分析。');
  // Avoid silently launching hundreds of paid calls. Full source remains locally available.
  if(chunks.length>120)throw Error('文档自动准备超过本次120次分析的安全容量，原文已完整保存；请保留文件，当前不会发起费用请求。');
  const cached=await listSimulatorReviews(id,source.body.length),reviews:SavedSimulatorReview[]=[];
  for(const [i,chunk] of chunks.entries()){
   abort(signal);onProgress?.(i,chunks.length);let saved=cached.find(x=>x.review.chunkIndex===i&&x.review.automatic?.version===1&&x.review.automatic.chunkChars===2000&&x.review.start===chunk.start&&x.review.end===chunk.end);
   if(!saved){const review=await reviewSimulatorChunk(id,i,signal,2000);abort(signal);await saveSimulatorReview(id,source.body.length,source.name,review);saved={id:id+':'+i,sourceId:id,sourceLength:source.body.length,sourceName:source.name,review,savedAt:Date.now()};}reviews.push(saved);
  }
  abort(signal);let deferred=reviews.reduce((n,r)=>n+r.review.rejected,0);
  const paragraphs=[...source.body.matchAll(/[^\r\n]+/g)].map(m=>({text:m[0],start:m.index!,end:m.index!+m[0].length}));
  for(const r of reviews){const c=chunks[r.review.chunkIndex];r.review.findings=r.review.findings.filter((f,i,all)=>all.findIndex(g=>g.start===f.start&&g.end===f.end&&g.kind===f.kind)===i);
   // A fragment lacking the rest of its paragraph cannot become an unconditional rule.
   for(const f of r.review.findings)if((f.start>0&&!/[\r\n]/.test(source.body[f.start-1]))||(f.end<source.body.length&&!/[\r\n]/.test(source.body[f.end])))f.certainty='uncertain';
   for(const p of paragraphs.filter(p=>p.start<c.end&&p.end>c.start&&!/^\s*#/.test(p.text))){const start=Math.max(c.start,p.start),end=Math.min(c.end,p.end),secret=/秘密|隐瞒|未公开|不知情/.test(p.text),kind=secret?'secret':/必须|不得|禁止|只有|除非|如果|初始|条件|每(?:轮|回合)/.test(p.text)?'conditional':'background';if(r.review.findings.some(f=>(!secret||f.kind==='secret')&&f.start<=start&&f.end>=end))continue;r.review.findings.push({kind,quote:source.body.slice(start,end),start,end,interpretation:'尚未确认含义，保留原文供按需判断，不作为已发生事实。',confidence:'source-verified',certainty:'uncertain'});deferred++;}
  }
  const pairs=findSimulatorReviewPairs(reviews),conflicted=new Set(pairs.flatMap(p=>[p.left.quote,p.right.quote]));
  const secrets=reviews.flatMap(r=>r.review.findings.filter(f=>f.kind==='secret'));
  for(const r of reviews)r.review.findings=r.review.findings.filter(f=>f.kind==='secret'||!secrets.some(s=>f.start<s.end&&s.start<f.end));
  const decisions:SimulatorDecision[]=[];
  for(const r of reviews)for(const f of r.review.findings){if(conflicted.has(f.quote))f.certainty='uncertain';if(f.certainty!=='asserted')deferred++;decisions.push({id:`auto:${id}:${r.review.chunkIndex}:${f.start}:${f.end}:${f.kind}`,sourceId:id,sourceLength:source.body.length,chunkIndex:r.review.chunkIndex,findingStart:f.start,findingEnd:f.end,quote:f.quote,decision:'accepted',...(f.kind==='secret'?{knownBy:f.knownBy??[],playerKnown:f.playerKnown??false,protectedTerms:f.protectedTerms??[]} :{}),updatedAt:Date.now()});}
  if(!reviews.some(r=>r.review.findings.length))throw Error('AI 未识别出可用资料，原文已保留。请检查所选模型后重新准备。');
  const mechanical=compileAutomaticMechanics(reviews.map(r=>{const m=r.review.automatic?.mechanics;const permitted=(quote:string)=>r.review.findings.some(f=>f.kind!=='secret'&&f.certainty==='asserted'&&f.quote.includes(quote)&&!conflicted.has(f.quote));return {text:chunks[r.review.chunkIndex].text,mechanics:m&&{fields:Array.isArray(m.fields)?m.fields.filter(f=>f&&typeof f.quote==='string'&&permitted(f.quote)):[],events:Array.isArray(m.events)?m.events.filter(e=>e&&typeof e.quote==='string'&&permitted(e.quote)):[]}};}));
  for(const r of reviews)for(const f of r.review.findings){const reveal=f.revealWhen;if(f.kind!=='secret'||!reveal)continue;if(typeof reveal.key!=='string'||!['string','number','boolean'].includes(typeof reveal.equals)){deferred++;continue;}const field=mechanical.runtime?.fields[reveal.key];if(field?.label&&typeof reveal.equals===field.type&&/(?:向玩家(?:公开|揭示)|玩家(?:得知|知晓))/.test(f.quote)&&!/且|或|除非|只有|允许|可以/.test(f.quote)&&conditionEvidence(f.quote,field.label,'eq',reveal.equals)){const d=decisions.find(d=>d.chunkIndex===r.review.chunkIndex&&d.findingStart===f.start&&d.findingEnd===f.end&&d.quote===f.quote);if(d)d.revealWhen={key:reveal.key,equals:reveal.equals};}else deferred++;}
  if(!simulatorAuditStatus(chunks,reviews,decisions).ready)throw Error('剧本准备记录校验失败，原文和完成进度保留，请重新准备。');
  const preparation:AutomaticPreparation={version:1,chunkChars:2000,reviews,decisions,...(mechanical.runtime?{runtime:mechanical.runtime}:{}),deferred:deferred+mechanical.deferred};
  if(new TextEncoder().encode(JSON.stringify({...source,preparation})).length>12*1024*1024)throw Error('完整准备结果超过单世界12 MiB安全容量，原文和完成进度保留，未创建世界。');
  abort(signal);source=await readLongNarrative(id);if(!source)throw Error('原文已被移除，未保存准备结果。');await storePreparedSource({...source,preparation});onProgress?.(chunks.length,chunks.length);return preparation;
 });
}
