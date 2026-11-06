import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
test.use({timezoneId:'Asia/Shanghai'});
const now=Date.parse('2026-11-04T14:00:00Z');
async function seed(page:Page){
 await isolatedApp(page,'chat-time-'+crypto.randomUUID());await page.clock.setFixedTime(now);
 return page.evaluate(async now=>{
  const {db,usePhone}=await import('/src/store.ts');await db.characters.add({id:'clock-c',name:'时间胶囊角色',persona:''});
  const c=await(await import('/src/chatService.ts')).getConversation('clock-c');
  const rows=[['u1','user','2026-11-03T23:41Z','用户早安'],['a1','assistant','2026-11-03T23:42Z','第一句。第二句。'],['u2','user','2026-11-04T00:11Z','下一条'],['a2','assistant','2026-11-04T01:32Z','上午回复'],['u3','user','2026-11-04T12:49Z','晚间用户'],['a3','assistant','2026-11-04T12:50Z','旧的最后回复']];
  await db.messages.bulkAdd(rows.map(([id,role,date,content])=>({id,conversationId:c.id,role,content,createdAt:Date.parse(date),...(id==='a3'?{activeVariantId:'last-v1'}:{})})));
  await db.messageVariants.bulkAdd([{id:'last-v1',messageId:'a3',conversationId:c.id,content:'旧的最后回复',createdAt:Date.parse('2026-11-04T12:50Z'),source:'legacy'},{id:'last-v2',messageId:'a3',conversationId:c.id,content:'新的第一句。新的第二句。',createdAt:now,source:'generated'}]);
  await usePhone.getState().reload();return c.id;
 },now);
}

test('纯展示时间按原始时间30分钟/日期边界，支持年份、设备时区及无效时间降级',async({page})=>{
 await isolatedApp(page,'chat-time-unit-'+crypto.randomUUID());
 const result=await page.evaluate(async now=>{
  const {chatTimeLabels}=await import('/src/chatTime.ts');
  const rows=(values:number[])=>values.map((createdAt,i)=>({id:String(i),conversationId:'c',role:'user' as const,content:'',createdAt}));
  const at=Date.parse('2026-11-04T00:00Z');
  return {edges:[...chatTimeLabels(rows([at,at+29*60000,at+59*60000]),now)],dates:[...chatTimeLabels(rows([Date.parse('2026-11-03T15:59Z'),Date.parse('2026-11-03T16:01Z')]),now)],year:[...chatTimeLabels(rows([Date.parse('2025-12-31T12:00Z')]),now)],invalid:[...chatTimeLabels(rows([NaN,0,now+60000]),now)]};
 },now);
 expect(result.edges).toEqual([['0','星期三 08:00'],['2','星期三 08:59']]);
 expect(result.dates).toEqual([['0','11月3日 星期二 23:59'],['1','星期三 00:01']]);expect(result.year[0][1]).toBe('2025年12月31日 星期三 20:00');expect(result.invalid).toEqual([]);
});

for(const width of [375,390,430])test(`胶囊居中、小尺寸无溢出，分气泡不重复且开关关闭也显示：${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});const id=await seed(page);
 await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'时间胶囊角色 开始 / 继续聊天'}).click();
 const capsules=page.locator('.chat-time-divider');await expect(capsules).toHaveText(['星期三 07:41','星期三 09:32','星期三 20:49']);await expect(page.locator('[data-message-id="a1"] .chat-bubble-surface')).toHaveCount(2);await expect(page.locator('.chat-message-row')).toHaveCount(6);
 const layout=await capsules.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),p=node.parentElement!.getBoundingClientRect(),time=node.querySelector('time')!,t=time.getBoundingClientRect(),style=getComputedStyle(time);return {center:Math.abs((t.left+t.right-p.left-p.right)/2),inside:t.left>=r.left&&t.right<=r.right,font:parseFloat(style.fontSize),radius:style.borderRadius};}));
 expect(layout.every(r=>r.center<=1&&r.inside&&r.font===11&&r.radius==='999px')).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const data=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');const context=await(await import('/src/chatContext.ts')).buildContext((await db.conversations.get(id))!);return {count:await db.messages.where('conversationId').equals(id).count(),context,enabled:(await db.conversations.get(id))?.chatSettings?.followRealTime??false};},id);
 expect(data.count).toBe(6);expect(data.enabled).toBe(false);expect(JSON.stringify(data.context)).not.toContain('星期三');expect(JSON.stringify(data.context)).not.toContain('[真实时间上下文]');
 await page.screenshot({path:`/tmp/claudia-chat-time-${width}.png`,animations:'disabled'});
 await page.locator('.chat-app').evaluate(el=>{(el as HTMLElement).style.color='#e0e5e2';(el as HTMLElement).style.background='#1f2924';});await expect(capsules.first().locator('time')).toHaveCSS('color','rgb(224, 229, 226)');
});

test('版本切换仍用原始时间，分支切换/删除后按有效路径重算，不新增数据库消息',async({page})=>{
 const id=await seed(page);await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'时间胶囊角色 开始 / 继续聊天'}).click();
 const root=await page.evaluate(async id=>(await(await import('/src/timelines.ts')).getCurrentTimeline(id)).id,id);
 const capsules=page.locator('.chat-time-divider');await expect(capsules).toHaveCount(3);
 await page.evaluate(async id=>{await(await import('/src/messageOperations.ts')).selectVariant(id,'a3','last-v2');},id);await expect(page.locator('[data-message-id="a3"]')).toContainText('新的第一句');await expect(capsules).toHaveText(['星期三 07:41','星期三 09:32','星期三 20:49']);
 await page.evaluate(async id=>{await(await import('/src/messageOperations.ts')).editMessage(id,'u2','编辑历史',true);},id);await expect(page.locator('.chat-message-row')).toHaveCount(3);await expect(capsules).toHaveText(['星期三 07:41']);
 await page.evaluate(async({id,root})=>{await(await import('/src/timelines.ts')).switchTimeline(id,root);},{id,root});await expect(page.locator('.chat-message-row')).toHaveCount(6);await expect(capsules).toHaveCount(3);
 await page.evaluate(async id=>{await(await import('/src/messageOperations.ts')).removeMessage(id,'a2','delete',true);},id);await expect(page.locator('.chat-message-row')).toHaveCount(3);await expect(capsules).toHaveText(['星期三 07:41']);
});
