/** Read-only batch planner. This module never calls a provider, writes to the
 * database, starts timers or enables paid work. The UI must obtain explicit
 * consent before handing any planned work to the manual runner.
 */
export interface MemoryBatchPlanInput {
 freshMessages:number;
 blockedMessages:number;
 consecutiveZeroBatches:number;
 taxonomyReady:boolean;
 providerReady:boolean;
 userApproved:boolean;
 threshold?:number;
}
export type MemoryBatchPlanReason='needs-consent'|'missing-taxonomy'|'missing-provider'|'paused-after-failures'|'below-threshold'|'ready';
export function planMemoryBatch(input:MemoryBatchPlanInput){
 const threshold=input.threshold??20;
 if(!Number.isSafeInteger(threshold)||threshold<1||threshold>100)throw Error('invalid-memory-batch-threshold');
 for(const value of [input.freshMessages,input.blockedMessages,input.consecutiveZeroBatches]){
  if(!Number.isSafeInteger(value)||value<0)throw Error('invalid-memory-batch-count');
 }
 let reason:MemoryBatchPlanReason;
 if(!input.userApproved)reason='needs-consent';
 else if(!input.taxonomyReady)reason='missing-taxonomy';
 else if(!input.providerReady)reason='missing-provider';
 else if(input.consecutiveZeroBatches>=2)reason='paused-after-failures';
 else if(input.freshMessages<threshold)reason='below-threshold';
 else reason='ready';
 return {ready:reason==='ready',reason,threshold,batchSize:reason==='ready'?Math.min(threshold,input.freshMessages):0,blocked:input.blockedMessages};
}
