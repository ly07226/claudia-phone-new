import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('magnetic deadlight counts consecutive failed batches and clears on success',async({page})=>{
 await isolatedApp(page,'magnetic-deadlight');
 const values=await page.evaluate(async()=>{
  const {magneticBatchHealth}=await import('/src/memoryMagnetMessages.ts');
  const first=magneticBatchHealth(0,3,0);
  const second=magneticBatchHealth(first.zeroRuns,2,0);
  const idle=magneticBatchHealth(second.zeroRuns,0,0);
  const recovered=magneticBatchHealth(idle.zeroRuns,4,1);
  return {first,second,idle,recovered};
 });
 expect(values.first).toEqual({zeroRuns:1,deadlight:false});
 expect(values.second).toEqual({zeroRuns:2,deadlight:true});
 expect(values.idle).toEqual({zeroRuns:2,deadlight:true});
 expect(values.recovered).toEqual({zeroRuns:0,deadlight:false});
});
