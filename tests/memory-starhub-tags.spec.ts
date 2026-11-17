import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('StarHub magnetic recall depends on stored tags, not memory text',async({page})=>{
 await isolatedApp(page,'starhub-mutation');
 const result=await page.evaluate(async()=>{
  const {selectMemoryContext}=await import('/src/memoryContext.ts');
  const entry={id:'event',revision:7,kind:'long',source:'manual',content:'那天我们在码头讨论过一次重要约定。',deleted:false,createdAt:Date.now(),updatedAt:Date.now(),inherited:false};
  const tags=[{entryId:'event',revision:7,tags:[{axis:'keyword',tag:'码头',weight:2}],taggedAt:Date.now()}];
  return {matched:selectMemoryContext([entry] as any,'还记得码头吗？',8000,tags as any).selected,
    removed:selectMemoryContext([entry] as any,'还记得码头吗？',8000,[]).selected,
    stale:selectMemoryContext([{...entry,revision:8}] as any,'还记得码头吗？',8000,tags as any).selected,
    deleted:selectMemoryContext([{...entry,deleted:true}] as any,'还记得码头吗？',8000,tags as any).selected};
 });
 expect(result).toEqual({matched:1,removed:0,stale:0,deleted:0});
});

test('StarHub tagger rejects invented emotion/topic classes',async({page})=>{
 await isolatedApp(page,'starhub-taxonomy');
 const result=await page.evaluate(async()=>{
  const {validateTagging}=await import('/src/memoryMagnetTagger.ts');
  const taxonomy={emotion:['愉快','悲伤'],topic:['旅行','家庭']};
  const good=validateTagging({summary:'曾经旅行',keyword:['码头'],emotion:['愉快'],topic:['旅行']},taxonomy);
  let rejected=false;
  try{validateTagging({summary:'曾经旅行',keyword:[],emotion:['不存在的情绪'],topic:[]},taxonomy);}catch{rejected=true;}
  return {good:good.length,rejected};
 });
 expect(result).toEqual({good:3,rejected:true});
});
