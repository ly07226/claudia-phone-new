import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('batch planning cannot approve paid work without consent or prerequisites',async({page})=>{
 await isolatedApp(page,'memory-batch-planner');
 const result=await page.evaluate(async()=>{
  const {planMemoryBatch}=await import('/src/memoryBatchPlanner.ts');
  const base={freshMessages:25,blockedMessages:2,consecutiveZeroBatches:0,taxonomyReady:true,providerReady:true,userApproved:true};
  return {
   consent:planMemoryBatch({...base,userApproved:false}),
   taxonomy:planMemoryBatch({...base,taxonomyReady:false}).reason,
   provider:planMemoryBatch({...base,providerReady:false}).reason,
   failures:planMemoryBatch({...base,consecutiveZeroBatches:2}).reason,
   threshold:planMemoryBatch({...base,freshMessages:19}).reason,
   ready:planMemoryBatch(base),
  };
 });
 expect(result).toEqual({
  consent:{ready:false,reason:'needs-consent',threshold:20,batchSize:0,blocked:2},
  taxonomy:'missing-taxonomy',
  provider:'missing-provider',
  failures:'paused-after-failures',
  threshold:'below-threshold',
  ready:{ready:true,reason:'ready',threshold:20,batchSize:20,blocked:2},
 });
});
