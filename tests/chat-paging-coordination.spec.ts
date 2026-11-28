import {test,expect} from '@playwright/test';
import {seedPerformance} from './performanceFixture';
for(const mode of ['older-page','metadata-refresh'] as const)test(`引用分页协调 ${mode}：定位不丢失且原文完整`,async({page})=>{
 test.setTimeout(60000);const id=await seedPerformance(page,1000);
 await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts'),{activeMessages}=await import('/src/messagePath.ts'),{prepareQuote}=await import('/src/messageReferences.ts'),{messageBubbles}=await import('/src/messageBubbles.ts');
  const m=(await activeMessages(id))[1],c=(await db.conversations.get(id))!,quote=await prepareQuote(id,m.id,messageBubbles(m)[0],{timelineId:c.activeTimelineId,epoch:c.timelineEpoch??0},{content:m.content});await(await import('/src/chatService.ts')).queueUserMessage(id,'定位原始消息',undefined,[],quote);
 },id);
 await page.getByRole('button',{name:'聊天',exact:true}).click();await page.locator('.chat-list-row').filter({hasText:'性能角色'}).click();await expect(page.locator('.message-quote')).toBeVisible();
 await page.evaluate(async mode=>{
  const {db}=await import('/src/store.ts'),Dexie=Object.getPrototypeOf(db.constructor),get=db.pathNodes.get.bind(db.pathNodes),bulk=db.pathNodes.bulkGet.bind(db.pathNodes);
  let blocked=false;
  const pause=async()=>{if(blocked)return;blocked=true;(window as any).__olderBlocked=true;await Dexie.waitFor(new Promise<void>(resolve=>{(window as any).__releaseOlder=resolve;}));};
  db.pathNodes.get=(async(key:any)=>{const row=await get(key);if(key==='n964')await pause();if(mode==='metadata-refresh'&&key==='n800')await Dexie.waitFor(new Promise(r=>setTimeout(r,100)));return row;}) as any;
  db.pathNodes.bulkGet=(async(keys:any[])=>{const rows=await bulk(keys);if(keys.includes('n964'))await pause();if(mode==='metadata-refresh'&&keys.includes('n800'))await Dexie.waitFor(new Promise(r=>setTimeout(r,100)));return rows;}) as any;
  (window as any).__restorePagingMethods=()=>{db.pathNodes.get=get;db.pathNodes.bulkGet=bulk;};
 },mode);
 if(mode==='older-page'){
  await page.locator('.chat-history').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll',{bubbles:true}));});
  await expect.poll(()=>page.evaluate(()=>(window as any).__olderBlocked===true)).toBe(true);
  try{await page.locator('.message-quote').click();}finally{await page.evaluate(()=>(window as any).__releaseOlder?.());}
 }else{
  await page.locator('.message-quote').click();await expect.poll(()=>page.evaluate(()=>(window as any).__olderBlocked===true)).toBe(true);
  await page.evaluate(async id=>{const {db}=await import('/src/store.ts');(window as any).__metadataUpdate=db.conversations.update(id,{updatedAt:Date.now()+1});},id);
  await page.evaluate(()=>(window as any).__releaseOlder?.());await page.evaluate(()=>(window as any).__metadataUpdate);
 }
 await expect(page.locator('[data-message-id="m1"]')).toBeVisible();await expect(page.locator('[data-message-id="m1"]')).toContainText('抬起头');
 const data=await page.evaluate(async id=>{(window as any).__restorePagingMethods();const {db}=await import('/src/store.ts');return {messages:await db.messages.where('conversationId').equals(id).count(),nodes:await db.pathNodes.where('conversationId').equals(id).count()};},id);
 expect(data).toEqual({messages:1001,nodes:1001});
});
