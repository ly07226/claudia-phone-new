import { test, expect, type Page } from "@playwright/test";
async function seed(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const { db, usePhone } = await import("/src/store.ts");
    const { getConversation } = await import("/src/chatService.ts");
    const canvas = document.createElement("canvas"); canvas.width=120;canvas.height=240;
    const ctx=canvas.getContext("2d")!;ctx.fillStyle="#a8baa0";ctx.fillRect(0,0,120,240);ctx.fillStyle="#fff8e7";ctx.beginPath();ctx.arc(60,120,35,0,Math.PI*2);ctx.fill();
    await db.assets.put({id:"list-avatar",type:"avatar",data:canvas.toDataURL(),createdAt:1});
    await db.characters.bulkPut([{id:"chat-a",name:"有头像的长名称角色用于检验省略",persona:"",avatar:"list-avatar"},{id:"chat-b",name:"另一个角色",persona:""},{id:"chat-empty",name:"尚未聊天角色",persona:""}]);
    await db.worlds.bulkPut([{id:"world-a",name:"自定义世界甲",description:"",createdAt:1},{id:"world-b",name:"自定义世界乙",description:"",createdAt:2}]);
    await db.worldProfiles.bulkPut([{id:"p-a",worldId:"world-a",characterId:"chat-a",setting:""},{id:"p-b",worldId:"world-b",characterId:"chat-a",setting:""}]);
    const daily=await getConversation("chat-a"),other=await getConversation("chat-b"),a=await getConversation("chat-a","world-a"),b=await getConversation("chat-a","world-b");
    const now=Date.now();
    await db.messages.bulkPut([{id:"u1",conversationId:daily.id,role:"user",content:"长文本与 URL https://example.test/"+"long".repeat(100),createdAt:now-2000},{id:"a1",conversationId:daily.id,role:"assistant",content:"旧版本不能进入预览",activeVariantId:"v1",createdAt:now-1000},{id:"archived",conversationId:daily.id,role:"assistant",content:"归档后续不能进入预览",archived:true,createdAt:now+9999},{id:"other",conversationId:other.id,role:"user",content:"另一条会话的最新消息",createdAt:now},{id:"world-a-msg",conversationId:a.id,role:"user",content:"仅甲世界的消息",createdAt:now},{id:"world-b-msg",conversationId:b.id,role:"user",content:"仅乙世界的消息",createdAt:now}]);
    await db.messageVariants.put({id:"v1",messageId:"a1",conversationId:daily.id,content:"第一句。第二句。",createdAt:now});
    await usePhone.getState().reload();
  });
  await page.getByRole("button",{name:"聊天",exact:true}).click();
  await page.locator(".chat-app").evaluate(async el => { const animations = []; for(let node:Element|null=el;node;node=node.parentElement) animations.push(...node.getAnimations()); await Promise.all(animations.map(a=>a.finished.catch(()=>{}))); });
}
for(const width of [375,390,430]) {
 test(`聊天列表 ${width}px：头像、活动版本预览、时间及空间隔离，读取不创建会话`,async({page})=>{
  await page.setViewportSize({width,height:844});await seed(page);
  await expect(page.locator(".chat-list-row")).toHaveCount(3);
  await expect(page.locator(".chat-list-row").first()).toContainText("第一句。第二句。");
  await expect(page.locator(".chat-list-row").nth(2)).toContainText("开始聊天");
  await expect(page.locator(".chat-list-row").first().locator("time")).toHaveCount(1);
  await expect(page.locator(".chat-app")).not.toContainText("仅甲世界的消息");
  const dimensions=await page.locator(".chat-list-row").first().evaluate(el=>{const avatar=el.querySelector(".chat-avatar")!.getBoundingClientRect(),info=el.querySelector(".chat-list-info")!.getBoundingClientRect();return {w:avatar.width,h:avatar.height,separate:info.left>=avatar.right,overflow:el.scrollWidth>el.clientWidth};});
  expect(Math.abs(dimensions.w-54)).toBeLessThan(0.01);expect(Math.abs(dimensions.h-54)).toBeLessThan(0.01);expect(dimensions.separate).toBe(true);expect(dimensions.overflow).toBe(false);
  const data=await page.evaluate(async()=>{const {db}=await import("/src/store.ts");const {chatListPreviews}=await import("/src/chatListPreview.ts");return {a:await chatListPreviews(["chat-a"],"world-a"),b:await chatListPreviews(["chat-a"],"world-b"),count:await db.conversations.count(),messages:await db.messages.count()};});
  expect(data.a["chat-a"].content).toBe("仅甲世界的消息");expect(data.b["chat-a"].content).toBe("仅乙世界的消息");expect(data.count).toBe(4);expect(data.messages).toBe(6);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`artifacts/chat-list-refresh-${width}.png`});
 });
 test(`对话间距 ${width}px：48头像、14列距、12气泡距、20组距及小视口`,async({page})=>{
  await page.setViewportSize({width,height:844});await seed(page);
  await page.locator(".chat-list-row").first().click();
  await expect(page.locator('[data-message-id="a1"] .chat-bubble-surface')).toHaveCount(2);
  const values=await page.locator(".chat-history").evaluate(el=>{
   const user=el.querySelector(".chat-message-row-user")!,ai=el.querySelector(".chat-message-row-assistant")!;
   const ua=user.querySelector(".chat-avatar")!.getBoundingClientRect(),aa=ai.querySelector(".chat-avatar")!.getBoundingClientRect();
   const ub=user.querySelector(".chat-bubble-surface")!.getBoundingClientRect();const bubbles=[...ai.querySelectorAll(".chat-bubble-surface")].map(e=>e.getBoundingClientRect());
   return {sizes:[ua.width,ua.height,aa.width,aa.height],aiGap:bubbles[0].left-aa.right,userGap:ua.left-ub.right,inner:bubbles[1].top-bubbles[0].bottom,groups:ai.getBoundingClientRect().top-user.getBoundingClientRect().bottom,overflow:el.scrollWidth>el.clientWidth};
  });
  for(const size of values.sizes)expect(Math.abs(size-48)).toBeLessThan(0.01);for(const [value,target] of [[values.aiGap,14],[values.userGap,14],[values.inner,12],[values.groups,20]])expect(Math.abs(value-target)).toBeLessThan(1);
  expect(values.overflow).toBe(false);
  await page.screenshot({path:`artifacts/chat-dialog-refresh-${width}.png`});
  await page.setViewportSize({width,height:460});await expect(page.getByLabel("聊天消息",{exact:true})).toBeInViewport();
  await page.getByRole("button",{name:"返回角色列表",exact:true}).click();await expect(page.locator(".chat-list-row").first()).toContainText("第一句。第二句。");
 });
}
