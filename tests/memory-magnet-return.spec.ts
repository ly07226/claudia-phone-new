import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

/** Mutation control: removing the matching tag must remove the recall.
 * This tests retrieval + rendering, not merely whether a tag filter returns IDs.
 */
test('memory recall is actually returned to prompt, and disappears without the trigger tag',async({page})=>{
 await isolatedApp(page,'magnetic-return-mutation');
 const result=await page.evaluate(async()=>{
  const {selectMagneticMessages}=await import('/src/memoryMagnetRecall.ts');
  const scope={mode:'daily',spaceId:'daily',conversationId:'c',characterId:'x'};
  const record={messageId:'m1',fingerprint:'hash',scope,summary:'两人在码头约定下周见面。',detail:'',tags:[{axis:'keyword',tag:'码头',weight:2}],createdAt:Date.now(),taggedAt:Date.now(),active:true};
  const matched=selectMagneticMessages([record] as any,'码头上的约定',1200);
  const removed=selectMagneticMessages([{...record,tags:[]}] as any,'码头上的约定',1200);
  const retired=selectMagneticMessages([{...record,active:false}] as any,'码头上的约定',1200);
  const unrelated=selectMagneticMessages([record] as any,'天气很好',1200);
  const budget=selectMagneticMessages([record] as any,'码头',5);
  return {matched:matched.text.includes(record.summary),matchedCount:matched.selected,removed:removed.text,retired:retired.text,unrelated:unrelated.text,budget:budget.text};
 });
 expect(result).toEqual({matched:true,matchedCount:1,removed:'',retired:'',unrelated:'',budget:''});
});

test('magnetic recall ranks by tag weight and respects total character and item budgets',async({page})=>{
 await isolatedApp(page,'magnetic-return-budget');
 const result=await page.evaluate(async()=>{
  const {selectMagneticMessages}=await import('/src/memoryMagnetRecall.ts');
  const scope={mode:'daily',spaceId:'daily',conversationId:'c',characterId:'x'};
  const rows=Array.from({length:12},(_,i)=>({messageId:'m'+i,fingerprint:'h'+i,scope,summary:'码头约定'+i,detail:'',tags:[{axis:'keyword',tag:'码头',weight:12-i}],createdAt:Date.now(),taggedAt:Date.now(),active:true}));
  const selected=selectMagneticMessages(rows as any,'码头',1200);
  const small=selectMagneticMessages(rows as any,'码头',90);
  return {count:selected.selected,first:selected.text.indexOf('码头约定0')<selected.text.indexOf('码头约定1'),chars:selected.text.length,smallChars:small.text.length,smallCount:small.selected};
 });
 expect(result.count).toBe(8);
 expect(result.first).toBe(true);
 expect(result.chars).toBeLessThanOrEqual(1200);
 expect(result.smallChars).toBeLessThanOrEqual(90);
 expect(result.smallCount).toBeLessThanOrEqual(8);
});
