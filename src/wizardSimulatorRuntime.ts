import {readLongNarrative} from './wizardLongNarrative';
import {indexSimulatorDocument} from './wizardSimulatorDocument';
import {planSimulatorAnalysis,checkSimulatorCoverage} from './wizardSimulatorCoverage';
import {listSimulatorReviews,listSimulatorDecisions} from './wizardSimulatorReviewStore';
import {simulatorAuditStatus} from './wizardSimulatorAudit';

export interface SimulatorRuntimePolicy {
 sourceId:string;
 sourceName:string;
 publicRules:{kind:string;text:string;sourceStart:number;sourceEnd:number}[];
 secretCount:number;
 reviewedChunks:number;
}
/** Fail closed: never supply hidden character facts to a player-facing model. */
export async function compileSimulatorRuntime(sourceId:string):Promise<SimulatorRuntimePolicy>{
 const source=await readLongNarrative(sourceId);
 if(!source)throw Error('模拟器原文已丢失，不能启用规则。');
 const chunks=planSimulatorAnalysis(source.body,indexSimulatorDocument(source.body));
 if(!checkSimulatorCoverage(source.body,chunks).complete)throw Error('模拟器原文覆盖校验失败。');
 const reviews=await listSimulatorReviews(source.id,source.body.length);
 const decisions=await listSimulatorDecisions(source.id,source.body.length);
 const audit=simulatorAuditStatus(chunks,reviews,decisions);
 if(!audit.ready)throw Error('模拟器规则审核尚未完成，不能启用运行规则。');
 const byChunk=new Map(reviews.map(r=>[r.review.chunkIndex,r]));
 const publicRules:SimulatorRuntimePolicy['publicRules']=[];
 let secretCount=0;
 for(let i=0;i<chunks.length;i++){
  const saved=byChunk.get(i);
  if(!saved)throw Error('模拟器审核记录缺失。');
  for(const finding of saved.review.findings){
   const decision=decisions.find(d=>d.sourceId===source.id&&d.sourceLength===source.body.length&&d.chunkIndex===i&&d.findingStart===finding.start&&d.findingEnd===finding.end&&d.quote===finding.quote);
   if(decision?.decision!=='accepted')continue;
   if(source.body.slice(finding.start,finding.end)!==finding.quote)throw Error('规则引用已失效。');
   if(finding.kind==='secret'){secretCount++;continue;}
   publicRules.push({kind:finding.kind,text:finding.quote,sourceStart:finding.start,sourceEnd:finding.end});
  }
 }
 return {sourceId:source.id,sourceName:source.name,publicRules,secretCount,reviewedChunks:chunks.length};
}
