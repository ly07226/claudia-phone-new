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
 expect(r.prompt).toContain('只有当玩家仍在主动处理某项未决冲突时');
 expect(r.prompt).toContain('不得强制保留原冲突的选项');
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
 expect(result.prompt).not.toContain('至少一项能直接处理当前最重要的未决冲突');
 expect(result.prompt).toContain('玩家主动探索恋爱、暧昧、成人向关系');
 expect(result.prompt).toContain('不得伪装成剧情必然转回主线');
 expect(result.prompt).toContain('玩家沉默、靠近、亲吻等单一行为均不等于对后续行为的概括同意');
 expect(result.input.selectedAction).toMatchObject({kind:'custom',text:'我抬头看着七皇子，没有说话。'});
 expect(result.input.narrativeLength).toMatchObject({targetChineseCharacters:'800～1500'});
});


test('主控权反例覆盖擅自出城、亲密反应和第一第二人称越权',async({page})=>{
 await storySeed(page);
 const prompt=await page.evaluate(async()=> (await import('/src/storyContext.ts')).storyPrompt);
 for(const rule of ['【逐句主控权自检','不等于授权已收拾行囊、出城、到江南或租到店铺','不授权后退半步、脸红、心跳或继续亲吻','第一人称叙事尤其禁止新增以“我”作主语的行动和心理','第二人称同样禁止新增“你”的动作','不得以‘镜头切换’‘蒙太奇’‘总结旅途’规避','NPC可以主动表达情感'])expect(prompt).toContain(rule);
});


test('每轮输入携带玩家授权边界，长期目标不能被当成旅程已完成',async({page})=>{
 await storySeed(page);
 const result=await page.evaluate(async()=>{
  const {storyInput}=await import('/src/storyContext.ts');
  const {claimStory}=await import('/src/storyStore.ts');
  const session=(await claimStory('story',undefined,false)).session;
  return JSON.parse(storyInput(session,[],{kind:'custom',text:'我想离开京城去江南开茶馆。'},'standard'));
 });
 expect(result.playerAgencyContract.authorizedNow).toBe('我想离开京城去江南开茶馆。');
 expect(result.playerAgencyContract.authorizationScope).toContain('长期目标不授权执行全部步骤');
 expect(result.playerAgencyContract.narrativeBoundary).toContain('不得跳时间替玩家完成');
 expect(result.playerAgencyContract.selfCheck).toContain('confirmedHistory');
});
