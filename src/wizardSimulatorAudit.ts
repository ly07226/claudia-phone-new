import type {SavedSimulatorReview,SimulatorDecision} from './wizardSimulatorReviewStore';
import type {SimulatorAnalysisChunk} from './wizardSimulatorCoverage';

export interface SimulatorAuditStatus {
 totalChunks:number;reviewedChunks:number;missingChunks:number[];invalidChunks:number[];
 findings:number;accepted:number;rejected:number;pending:number;secretFindings:number;
 ready:boolean;
}
/** Pure readiness check. A saved review is not proof of complete rule extraction. */
export function simulatorAuditStatus(chunks:SimulatorAnalysisChunk[],reviews:SavedSimulatorReview[],decisions:SimulatorDecision[]):SimulatorAuditStatus {
 const byIndex=new Map<number,SavedSimulatorReview>();
 for(const r of reviews){
  const chunk=chunks[r.review.chunkIndex];
  if(!chunk||r.review.start!==chunk.start||r.review.end!==chunk.end||r.review.chunkCount!==chunks.length||r.sourceLength!==chunks.reduce((n,c)=>n+c.text.length,0))continue;
  if(r.review.findings.some(f=>f.start<chunk.start||f.end>chunk.end||f.end<=f.start||chunk.text.slice(f.start-chunk.start,f.end-chunk.start)!==f.quote))continue;
  byIndex.set(r.review.chunkIndex,r);
 }
 const missingChunks=chunks.flatMap((_,i)=>byIndex.has(i)?[]:[i]);
 const invalidChunks=reviews.filter(r=>!byIndex.has(r.review.chunkIndex)).map(r=>r.review.chunkIndex);
 let findings=0,accepted=0,rejected=0,pending=0,secretFindings=0;
 for(const [index,r] of byIndex){
  for(const f of r.review.findings){
   findings++;
   if(f.kind==='secret')secretFindings++;
   const decision=decisions.find(d=>d.chunkIndex===index&&d.findingStart===f.start&&d.findingEnd===f.end&&d.quote===f.quote&&d.sourceId===r.sourceId&&d.sourceLength===r.sourceLength)?.decision;
   if(decision==='accepted')accepted++;else if(decision==='rejected')rejected++;else pending++;
  }
 }
 return {totalChunks:chunks.length,reviewedChunks:byIndex.size,missingChunks,invalidChunks,findings,accepted,rejected,pending,secretFindings,ready:chunks.length>0&&missingChunks.length===0&&invalidChunks.length===0&&pending===0};
}
