import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
test('StarHub message recall requires persisted tags and respects deletion, k and character budget',async({page})=>{
 await isolatedApp(page,'starhub-message-recall');
 const result=await page.evaluate(async()=>{
  const {selectMagneticMessages}=await import('/src/memoryMagnetRecall.ts');
  const entry={messageId:'m1',fingerprint:'f',scope:{mode:'daily',spaceId:'daily',conversationId:'c',characterId:'x'},summary:'码头上答应一起看海',detail:'这是完整原文',tags:[{axis:'keyword',tag:'码头',weight:2}],createdAt:Date.now(),taggedAt:Date.now(),active:true};
  return {
   match:selectMagneticMessages([entry] as any,'还记得码头吗').selected,
   mutated:selectMagneticMessages([{...entry,tags:[]}] as any,'还记得码头吗').selected,
   inactive:selectMagneticMessages([{...entry,active:false}] as any,'还记得码头吗').selected,
   unrelated:selectMagneticMessages([entry] as any,'今天天气不错').text,
   budget:selectMagneticMessages([entry] as any,'码头',3).selected,
   capped:selectMagneticMessages(Array.from({length:15},(_,i)=>({...entry,messageId:String(i)})) as any,'码头').selected
  };
 });
 expect(result).toEqual({match:1,mutated:0,inactive:0,unrelated:'',budget:0,capped:8});
});
