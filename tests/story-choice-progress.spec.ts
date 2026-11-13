import {test,expect} from '@playwright/test';
import {storySeed} from './storyFixture';

test('生产提示明确禁止虚构既往暗号并要求选项带来实际变化',async({page})=>{
 await storySeed(page);
 const r=await page.evaluate(async()=>{
  const {storyPrompt}=await import('/src/storyContext.ts');
  return {prompt:storyPrompt};
 });
 expect(r.prompt).toContain('禁止捏造既往约定、暗号');
 expect(r.prompt).toContain('每轮承接 selectedAction 后必须出现可观察的新结果');
 expect(r.prompt).toContain('至少一项能直接处理当前最重要的未决冲突');
});

test('玩家选中的选项文本进入下一轮实际输入，未选选项不能冒充已发生事实',async({page})=>{
 await storySeed(page);
 const r=await page.evaluate(async()=>{
  const {claimStory}=await import('/src/storyStore.ts');
  const {storyInput}=await import('/src/storyContext.ts');
  const session=(await claimStory('story',undefined,false)).session;
  const path=[{id:'node-1',body:'陛下尚未禅位。',choices:[
   {id:'choice-a',label:'A',text:'进入御书房面见陛下'},
   {id:'choice-b',label:'B',text:'去后院查看密信'},
   {id:'choice-c',label:'C',text:'留在原地等待'},
   {id:'choice-d',label:'D',text:'询问门外侍卫'}]}] as any;
  return JSON.parse(storyInput(session,path,{kind:'choice',choiceId:'choice-b'}));
 });
 expect(r.selectedAction).toMatchObject({kind:'choice',label:'B',text:'去后院查看密信'});
 expect(r.confirmedHistory).toHaveLength(1);
 expect(r.confirmedHistory[0].body).toBe('陛下尚未禅位。');
 expect(r.recentStoryChoices[0].choices).toContain('进入御书房面见陛下');
 expect(r.continuity.confirmedSources).toContain('行动意图与实际结果分开');
});


test('生产剧本提示保护玩家主控权，并将长篇幅与玩家反应解耦',async({page})=>{
 await storySeed(page);
 const result=await page.evaluate(async()=>{
  const {storyPrompt,storyInput}=await import('/src/storyContext.ts');
  const {claimStory}=await import('/src/storyStore.ts');
  const session=(await claimStory('story',undefined,false)).session;
  const path=[{id:'node-1',body:'七皇子放下茶杯，等待回应。',choices:[
   {id:'a',label:'A',text:'询问他的来意'},
   {id:'b',label:'B',text:'离开房间'},
   {id:'c',label:'C',text:'沉默'},
   {id:'d',label:'D',text:'观察窗外'}]}] as any;
  return {prompt:storyPrompt,input:JSON.parse(storyInput(session,path,{kind:'custom',text:'我抬头看着七皇子，没有说话。'},'standard'))};
 });
 expect(result.prompt).toContain('严禁擅自添加玩家未表达的言语');
 expect(result.prompt).toContain('生理反应（如脸红、心跳、颤抖、流泪）');
 expect(result.prompt).toContain('不以新增玩家反应凑字数');
 expect(result.prompt).toContain('在该处停住并给出选择');
 expect(result.input.selectedAction).toMatchObject({kind:'custom',text:'我抬头看着七皇子，没有说话。'});
 expect(result.input.narrativeLength).toBeDefined();
});
