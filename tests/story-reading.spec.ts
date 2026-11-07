import {test,expect} from '@playwright/test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {storySeed,reply} from './storyFixture';
const screenshotRoot=await mkdtemp(join(tmpdir(),'claudia-b11-reading-'));
// After reload a visible App button may precede async restoration of the World route.
async function openRestoredStory(page:any){
 await expect.poll(()=>page.evaluate(async()=>{const n=(await import('/src/spaces.ts')).useSpaces.getState(),p=(await import('/src/store.ts')).usePhone.getState();return n.booted&&!n.transitioning&&n.route.screen==='phone'&&n.route.spaceId==='world:story'&&p.worldId==='story';})).toBe(true);
 // The phone uses a finite entrance transform; finish it before coordinate-based clicking.
 await page.locator('.phone').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
 await page.getByRole('button',{name:'剧本',exact:true}).click();
 await expect(page.getByLabel('剧本主线',{exact:true})).toBeVisible();
}
async function seedHistory(page:any,total=30){
 await storySeed(page);await page.route('https://story.test/**',(r:any)=>r.fulfill({json:{choices:[{message:{content:JSON.stringify(reply())}}]}}));
 await page.evaluate(async total=>{const {db}=await import('/src/store.ts');await(await import('/src/storyGeneration.ts')).generateStory('story');const session=(await db.storySessions.toArray())[0];let parent=(await db.storyNodes.get(session.headNodeId!))!;
  await db.transaction('rw',db.storyNodes,db.storySessions,async()=>{for(let i=2;i<=total;i++){const id=crypto.randomUUID(),node={id,worldId:'story',sessionId:session.id,parentNodeId:parent.id,fromChoiceId:parent.choices[0].id,body:`第${i}段持久化正文。\n\n`+'这是保留在数据库中的经历，不是临时拼接的阅读示例。\n'.repeat(18),choices:parent.choices.map(c=>({...c,id:`${id}:${c.label}`})),createdAt:i,requestId:crypto.randomUUID(),definitionRevision:1,sequence:i};await db.storyNodes.add(node as any);parent=node as any;}await db.storySessions.update(session.id,{headNodeId:parent.id,revision:total});});await(await import('/src/storyValidation.ts')).validateStoryDatabase(db);
 },total);await openRestoredStory(page);await expect(page.locator('[data-story-sequence]')).toHaveCount(Math.min(total,12));
}
for(const width of [375,390,430])test(`连续历史、抽屉、草稿与窄屏布局 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});await seedHistory(page);const reader=page.getByLabel('连续剧情',{exact:true});await expect(page.locator('[data-story-sequence]').first()).toHaveAttribute('data-story-sequence','19');
 await reader.evaluate(el=>{el.scrollTop=el.scrollHeight/2;});const before=await reader.evaluate(el=>({top:el.scrollTop,height:el.clientHeight}));await page.getByRole('button',{name:'收起操作',exact:true}).click();await expect.poll(()=>page.locator('.story-drawer-panel').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(1);const closed=await reader.evaluate(el=>({top:el.scrollTop,height:el.clientHeight}));expect(closed.height).toBeGreaterThan(before.height+60);expect(Math.abs(closed.top-before.top)).toBeLessThanOrEqual(1);
 await page.screenshot({path:join(screenshotRoot,`reading-${width}-collapsed.png`),animations:'disabled'});
 await page.getByRole('button',{name:'展开操作',exact:true}).click();await expect(page.getByRole('radio')).toHaveCount(4);await expect.poll(()=>page.locator('.story-drawer-panel').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(100);await page.getByRole('radio').first().check();await page.getByLabel('自定义行动',{exact:true}).fill('我把通讯器藏进口袋，假装没有收到消息。');await expect(page.getByRole('radio').first()).not.toBeChecked();
 await page.getByRole('button',{name:'收起操作',exact:true}).click();await page.getByRole('button',{name:'展开操作',exact:true}).click();await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('我把通讯器藏进口袋，假装没有收到消息。');
 await page.getByRole('radio').nth(1).check();await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('');await page.getByLabel('自定义行动',{exact:true}).fill('先看看周围的人。');await expect.poll(()=>page.evaluate(async()=>{const {db}=await import('/src/store.ts');return (await db.storySessions.toArray())[0].actionDraft?.customText;})).toBe('先看看周围的人。');
 await page.getByRole('button',{name:'返回手机桌面',exact:true}).click();await openRestoredStory(page);await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('先看看周围的人。');await page.reload();await openRestoredStory(page);await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('先看看周围的人。');
 await page.getByLabel('自定义行动',{exact:true}).blur();await page.screenshot({path:join(screenshotRoot,`reading-${width}-expanded.png`),animations:'disabled'});
 await reader.evaluate(el=>el.scrollTop=0);await page.getByRole('button',{name:/查看更早剧情/}).click();await expect(page.locator('[data-story-sequence]').first()).toHaveAttribute('data-story-sequence','7');expect(await reader.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);await reader.evaluate(el=>el.scrollTop=0);await page.getByRole('button',{name:/查看更早剧情/}).click();await expect(page.locator('[data-story-sequence]')).toHaveCount(30);const sequences=await page.locator('[data-story-sequence]').evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute('data-story-sequence'))));expect(sequences).toEqual(Array.from({length:30},(_,i)=>i+1));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // Emulate a reduced visual viewport; this is not an actual iOS keyboard test.
 await page.setViewportSize({width,height:480});await expect.poll(()=>page.locator('.story-app').evaluate(el=>{const b=el.getBoundingClientRect();return b.height>0&&b.bottom<=(visualViewport?.height??innerHeight)+(visualViewport?.offsetTop??0)+1;})).toBe(true);await page.getByLabel('自定义行动',{exact:true}).focus();await expect(page.getByLabel('自定义行动',{exact:true})).toBeInViewport();await expect(page.getByRole('button',{name:'确认选择',exact:true})).toBeInViewport();const buttonBox=await page.getByRole('button',{name:'确认选择',exact:true}).evaluate(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,viewBottom:(visualViewport?.height??innerHeight)+(visualViewport?.offsetTop??0)}));expect(buttonBox.top).toBeGreaterThanOrEqual(0);expect(buttonBox.bottom).toBeLessThanOrEqual(buttonBox.viewBottom+1);await page.screenshot({path:join(screenshotRoot,`reading-${width}-small-viewport.png`),animations:'disabled'});
 console.log('B1.1 screenshots:',screenshotRoot);
});
test('减少动态效果设置关闭抽屉动画；失败和重试保留自定义行动，旧文追加而不替换',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await seedHistory(page,2);let mode='failure',calls=0;const requests:any[]=[];await page.route('https://story.test/**',r=>{calls++;requests.push(r.request().postDataJSON());return mode==='failure'?r.fulfill({status:500,json:{error:{message:'fixture'}}}):r.fulfill({json:{choices:[{message:{content:JSON.stringify(reply(3))}}]}});});await page.getByLabel('自定义行动',{exact:true}).fill('我没有回答，而是把通讯器藏进口袋。');
 await page.getByRole('button',{name:'确认选择',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('我没有回答，而是把通讯器藏进口袋。');expect(calls).toBe(1);await expect(page.locator('[data-story-sequence]')).toHaveCount(2);
 mode='success';await page.getByRole('button',{name:'确认选择',exact:true}).dblclick();await expect(page.locator('[data-story-sequence]')).toHaveCount(3);expect(calls).toBe(2);await expect(page.locator('.story-action-record').last()).toContainText('自定义行动');await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('');expect(JSON.stringify(requests[1])).toContain('我没有回答，而是把通讯器藏进口袋。');expect(JSON.stringify(requests[1])).toContain('尝试');
 expect(await page.locator('.story-drawer-panel').evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
});
