import {test,expect} from '@playwright/test';
import {storySeed,reply} from './storyFixture';
test('过期页面的自定义行动在请求前拒绝，不应用到另一标签页的新节点',async({page})=>{
 await storySeed(page);let calls=0;await page.route('https://story.test/**',r=>{calls++;return r.fulfill({json:{choices:[{message:{content:JSON.stringify(reply(calls))}}]}});});
 const result=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {generateStory}=await import('/src/storyGeneration.ts');const root=await generateStory('story');const old=(await db.storySessions.toArray())[0];const expected={sessionId:old.id,headNodeId:old.headNodeId,revision:old.revision};await generateStory('story',root.choices[0].id);let rejected=false;try{await generateStory('story',{kind:'custom',text:'基于上一节点尝试开门。'},{expected} as any);}catch{rejected=true;}return {rejected,nodes:await db.storyNodes.count(),revision:(await db.storySessions.toArray())[0].revision};});
 expect(result).toEqual({rejected:true,nodes:2,revision:2});expect(calls).toBe(2);
});
test('配置读取期间租约过期，不再发起已失效的付费请求',async({page})=>{
 await storySeed(page);let calls=0;await page.route('https://story.test/**',r=>{calls++;return r.fulfill({json:{choices:[{message:{content:JSON.stringify(reply())}}]}});});
 const result=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {generateStory}=await import('/src/storyGeneration.ts');const clock=Date.now,base=clock();const late=(c:any)=>{Date.now=()=>base+180000;return c;};db.apiConfigs.hook('reading',late);let rejected=false;try{await generateStory('story');}catch{rejected=true;}finally{db.apiConfigs.hook('reading').unsubscribe(late);Date.now=clock;}return {rejected,nodes:await db.storyNodes.count(),revision:(await db.storySessions.toArray())[0].revision};});
 expect(result).toEqual({rejected:true,nodes:0,revision:0});expect(calls).toBe(0);
});
