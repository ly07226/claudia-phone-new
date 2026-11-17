import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('magnetic recall: related Chinese topic can recall a paraphrased long memory',async({page})=>{
 await isolatedApp(page,'magnetic-topic');
 const result=await page.evaluate(async()=>{
  const {selectMemoryContext}=await import('/src/memoryContext.ts');
  const entry={id:'a',revision:1,kind:'long',source:'manual',content:'那天两个人因为隐瞒真相发生争吵，之后彼此道歉。',deleted:false,createdAt:1,updatedAt:1,inherited:false};
  return {
   related:selectMemoryContext([entry] as any,'你是不是又在骗我？',8000),
   unrelated:selectMemoryContext([entry] as any,'天气真好，出去散步吧。',8000),
  };
 });
 expect(result.related.selected).toBe(1);
 expect(result.unrelated.selected).toBe(0);
});
test('magnetic recall: budget and tombstone still prevent injection',async({page})=>{
 await isolatedApp(page,'magnetic-bounds');
 const result=await page.evaluate(async()=>{
  const {selectMemoryContext}=await import('/src/memoryContext.ts');
  const entry={id:'a',revision:1,kind:'long',source:'manual',content:'我们发生争吵之后和好了。',deleted:false,createdAt:1,updatedAt:1,inherited:false};
  return {tooSmall:selectMemoryContext([entry] as any,'争吵',1).selected,deleted:selectMemoryContext([{...entry,deleted:true}] as any,'争吵',8000).selected};
 });
 expect(result).toEqual({tooSmall:0,deleted:0});
});

test('long Chinese summary fits the entry budget but never exceeds total injection budget',async({page})=>{
 await isolatedApp(page,'summary-budget');
 const result=await page.evaluate(async()=>{
  const {selectMemoryContext,memoryContextLimits}=await import('/src/memoryContext.ts');
  const entry={id:'summary',revision:1,kind:'long',source:'auto',content:'两人曾经发生争吵，后来认真道歉并恢复信任。'.repeat(10),deleted:false,createdAt:1,updatedAt:1,inherited:false};
  const selected=selectMemoryContext([entry] as any,'争吵',10000);
  return {selected:selected.selected,tokens:selected.estimatedTokens,limit:memoryContextLimits.tokens};
 });
 expect(result.selected).toBe(1);
 expect(result.tokens).toBeLessThanOrEqual(result.limit);
});
