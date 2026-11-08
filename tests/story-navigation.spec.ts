import {test,expect,type Page} from '@playwright/test';
import {storySeed,reply} from './storyFixture';

async function openReader(page:Page,width:number,standalone:boolean,safeTop:number){
 await page.setViewportSize({width,height:844});
 await page.addInitScript(standalone=>Object.defineProperty(navigator,'standalone',{configurable:true,value:standalone}),standalone);
 await storySeed(page);
 // Chromium does not expose a native iPhone notch. Simulate the safe-area value
 // already used by the app; geometry assertions treat this band as unavailable.
 await page.evaluate(safeTop=>document.documentElement.style.setProperty('--safe-top',`${safeTop}px`),safeTop);
 let calls=0;
 await page.route('https://story.test/**',r=>{calls++;return r.fulfill({json:{choices:[{message:{content:JSON.stringify({...reply(),body:'雨停后，你先确认信上的日期，再决定是否出门。\n'.repeat(100)})}}]}});});
 const saved=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.worlds.update('story',{name:'导航验收剧本'});
  await(await import('/src/storyGeneration.ts')).generateStory('story');
  return {nodes:JSON.stringify(await db.storyNodes.toArray()),session:(await db.storySessions.where('worldId').equals('story').first())!};
 });
 await page.getByRole('button',{name:'剧本',exact:true}).click();await expect(page.locator('.story-heading h1')).toHaveText('导航验收剧本');
 return {saved,calls:()=>calls};
}
async function navigation(page:Page){
 return page.locator('.story-heading').evaluate(el=>{
  const rect=(s:string)=>{const r=el.querySelector(s)!.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,center:r.left+r.width/2};};
  const button=el.querySelector('button')!,r=button.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  return {back:rect('button:first-child'),title:rect('h1'),headingTop:el.getBoundingClientRect().top,hitBack:!!hit&&button.contains(hit),windowY:window.scrollY};
 });
}
for(const width of [390,430])for(const standalone of [false,true])test(`${standalone?'PWA':'Safari'} ${width} 顶栏避开安全区，滚动/抽屉/视口开合后返回入口及进度不丢失`,async({page},info)=>{
 const safeTop=standalone?59:20,state=await openReader(page,width,standalone,safeTop);
 const back=page.getByRole('button',{name:'返回手机桌面',exact:true});const heading=page.locator('.story-heading h1'),reader=page.getByLabel('连续剧情',{exact:true});
 await expect(back).toBeVisible();await expect(page.locator('.stage')).toHaveAttribute('data-ios','true');if(standalone)await expect(page.locator('.stage')).toHaveAttribute('data-standalone','true');
 const before=await navigation(page);
 // A button can pass toBeVisible while actually sitting under the native status
 // bar/Dynamic Island. Both its hit area and the title must clear the safe inset.
 expect(before.back.top).toBeGreaterThanOrEqual(safeTop);expect(before.title.top).toBeGreaterThanOrEqual(safeTop);expect(before.hitBack).toBe(true);expect(Math.abs(before.title.center-width/2)).toBeLessThan(1);
 await reader.evaluate(el=>el.scrollTop=el.scrollHeight);expect(await reader.evaluate(el=>el.scrollTop)).toBeGreaterThan(100);const scrolled=await navigation(page);expect(Math.abs(scrolled.headingTop-before.headingTop)).toBeLessThan(1);expect(scrolled.hitBack).toBe(true);expect(scrolled.windowY).toBe(before.windowY);
 await page.getByRole('button',{name:'收起操作',exact:true}).click();await expect(back).toBeInViewport();await expect(heading).toBeInViewport();await page.screenshot({path:info.outputPath(`story-navigation-${standalone?'pwa':'safari'}-${width}.png`)});
 await page.getByRole('button',{name:'展开操作',exact:true}).click();await page.getByLabel('自定义行动',{exact:true}).fill('保留阅读进度和这份未提交草稿。');
 await page.setViewportSize({width,height:440});await page.getByLabel('自定义行动',{exact:true}).focus();await expect.poll(async()=>(await navigation(page)).back.top).toBeGreaterThanOrEqual(safeTop);await expect(back).toBeInViewport();await expect(heading).toHaveText('导航验收剧本');
 await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'剧本设置',exact:true}).click();await expect(page.getByRole('dialog',{name:'剧本设置'})).toBeVisible();await page.getByRole('button',{name:'关闭',exact:true}).click();expect((await navigation(page)).hitBack).toBe(true);
 await expect.poll(()=>page.evaluate(async()=>((await(await import('/src/store.ts')).db.storySessions.where('worldId').equals('story').first())?.actionDraft?.customText))).toBe('保留阅读进度和这份未提交草稿。');
 await back.click();await expect(page.locator('.desktop')).toBeVisible();expect(await page.evaluate(async()=>(await import('/src/spaces.ts')).useSpaces.getState().space?.spaceId)).toBe('world:story');
 await page.getByRole('button',{name:'剧本',exact:true}).click();await expect(heading).toHaveText('导航验收剧本');await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('保留阅读进度和这份未提交草稿。');
 const after=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return {nodes:JSON.stringify(await db.storyNodes.toArray()),session:(await db.storySessions.where('worldId').equals('story').first())!};});
 expect(after.nodes).toBe(state.saved.nodes);expect(after.session.headNodeId).toBe(state.saved.session.headNodeId);expect(after.session.revision).toBe(state.saved.session.revision);expect(state.calls()).toBe(1);
 await back.click();await page.getByRole('button',{name:'返回空间列表',exact:true}).click();await expect(page.getByRole('heading',{name:'剧本世界',exact:true})).toBeVisible();
});
