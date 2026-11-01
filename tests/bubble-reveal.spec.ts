import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
async function setup(page:Page,reply:string){
  await isolatedApp(page,'bubble-reveal-'+crypto.randomUUID());
  await page.evaluate(async()=>{const {db,usePhone}=await import('/src/store.ts');await db.characters.bulkAdd([{id:'a',name:'节奏角色',persona:''},{id:'b',name:'另一角色',persona:''}]);await db.apiConfigs.add({id:'api',name:'模拟配置',provider:'openai-compatible',baseUrl:'https://reveal.test/v1',model:'mock',enabled:true,isDefault:true,temperature:.7,maxTokens:100,createdAt:1,updatedAt:1});await db.apiCredentials.add({configId:'api',apiKey:'synthetic-fixture-only'});await usePhone.getState().reload();});
  let calls=0;await page.route('https://reveal.test/**',async r=>{calls++;await r.fulfill({json:{choices:[{message:{content:reply}}]}});});
  await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'节奏角色 开始 / 继续聊天'}).click();
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  return ()=>calls;
}
async function send(page:Page){await page.getByLabel('聊天消息',{exact:true}).fill('请回复');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByLabel('聊天消息',{exact:true})).toBeEnabled();}
const surfaces=(page:Page)=>page.locator('.chat-assistant .chat-bubble-surface');
test('新四气泡首条立即、后续350ms逐条完整显示，数据库始终只有一条完整AI消息',async({page})=>{
  const reply='第一条。第二条。第三条。第四条。',calls=await setup(page,reply);await send(page);
  await expect(surfaces(page)).toHaveCount(1);await expect(surfaces(page).first()).toHaveText('第一条。');
  const saved=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return (await db.messages.toArray()).sort((a,b)=>a.createdAt-b.createdAt).map(m=>({role:m.role,content:m.content}));});expect(saved).toEqual([{role:'user',content:'请回复'},{role:'assistant',content:reply}]);
  await page.clock.runFor(349);await expect(surfaces(page)).toHaveCount(1);
  await page.clock.runFor(1);await expect(surfaces(page)).toHaveCount(2);await expect(surfaces(page).nth(1)).toHaveText('第二条。');
  await page.clock.runFor(350);await expect(surfaces(page)).toHaveCount(3);
  await page.clock.runFor(350);await expect(surfaces(page)).toHaveCount(4);expect((await surfaces(page).allTextContents()).join('')).toBe(reply);expect(calls()).toBe(1);
});
test('单气泡立即显示；历史重进不重播',async({page})=>{
  await setup(page,'一句完整回复。');await send(page);await expect(surfaces(page)).toHaveCount(1);await expect(surfaces(page)).toHaveText('一句完整回复。');
  await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.getByRole('button',{name:'节奏角色 开始 / 继续聊天'}).click();await expect(surfaces(page)).toHaveCount(1);
});
test('未播完切换聊天/离开组件取消旧计时；历史刷新和时间线切换直接完整显示',async({page})=>{
  const calls=await setup(page,'第一条。第二条。第三条。第四条。');await send(page);await expect(surfaces(page)).toHaveCount(1);
  await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.getByRole('button',{name:'另一角色 开始 / 继续聊天'}).click();await page.clock.runFor(1400);await expect(surfaces(page)).toHaveCount(0);expect(calls()).toBe(1);
  await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.getByRole('button',{name:'节奏角色 开始 / 继续聊天'}).click();await expect(surfaces(page)).toHaveCount(4);
  await send(page);await expect(surfaces(page)).toHaveCount(5);
  const original=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {activeMessages}=await import('/src/messagePath.ts');const {editMessage}=await import('/src/messageOperations.ts');const c=(await db.conversations.where('characterId').equals('a').first())!;const last=(await activeMessages(c.id)).at(-1)!;await editMessage(c.id,last.id,'编辑一。编辑二。编辑三。编辑四。');return {id:c.id,timeline:c.activeTimelineId!};});
  await expect.poll(async()=>{await page.clock.runFor(1);return surfaces(page).last().textContent();}).toBe('编辑四。');await expect(surfaces(page)).toHaveCount(8);
  await page.evaluate(async({id,timeline})=>{await(await import('/src/timelines.ts')).switchTimeline(id,timeline);},original);
  await expect.poll(async()=>{await page.clock.runFor(1);return surfaces(page).last().textContent();}).toBe('第四条。');await expect(surfaces(page)).toHaveCount(8);await page.clock.runFor(1400);await expect(surfaces(page)).toHaveCount(8);
  await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.getByRole('button',{name:'返回桌面',exact:true}).click();await page.clock.runFor(1400);await expect(surfaces(page)).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'节奏角色 开始 / 继续聊天'}).click();await expect(surfaces(page)).toHaveCount(8);expect(calls()).toBe(2);
});
