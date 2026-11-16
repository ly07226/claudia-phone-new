import {test,expect} from '@playwright/test';
import {seedPerformance} from './performanceFixture';
test('全局重载只加载被界面引用的聊天图片，保留全部数据库资源及稳定引用',async({page})=>{
 const id=await seedPerformance(page,100);
 const result=await page.evaluate(async id=>{
  const {db,usePhone}=await import('/src/store.ts');const {defaultChatHub}=await import('/src/chatHubTypes.ts');
  const ids=['old-photo','avatar-photo','cover-photo','draft-photo','background-photo','posted-photo'];
  await db.assets.bulkPut(ids.map(id=>({id,type:'chat-image',data:'data:image/png;base64,'+'eA=='.repeat(1000),createdAt:1})));
  await db.characters.update('perf-actor',{avatar:'avatar-photo'});
  await db.conversations.update(id,{chatSettings:{background:{kind:'image',assetId:'background-photo'}}});
  const theme=(await db.themes.get('global'))??usePhone.getState().theme;const hub=defaultChatHub();hub.cover='cover-photo';hub.draft.images=['draft-photo'];hub.posts=[{id:'p',author:{kind:'user',name:'我'},text:'历史图片',images:['posted-photo'],createdAt:1,liked:false,comments:[]}];await db.themes.put({...theme,chatHub:hub});
  await usePhone.getState().reload();const first=usePhone.getState();let notifications=0;const off=usePhone.subscribe(()=>notifications++);await usePhone.getState().reload();off();const second=usePhone.getState();
  return {loaded:second.assets.filter(a=>ids.includes(a.id)).map(a=>a.id).sort(),all:await db.assets.count(),same:first===second,notifications,photo:(await db.assets.get('old-photo'))?.data.length};
 },id);
 expect(result.loaded).toEqual(['avatar-photo','background-photo','cover-photo','draft-photo']);expect(result.all).toBeGreaterThanOrEqual(6);expect(result.photo).toBeGreaterThan(1000);expect(result.same).toBe(true);expect(result.notifications).toBe(0);
});
test('动态高度索引保持精确前缀和及边界查找',async({page})=>{await seedPerformance(page,1);const result=await page.evaluate(async()=>{const {HistoryLayout}=await import('/src/historyLayout.ts');const l=new HistoryLayout(['a','b','c'],new Map([['a',40],['b',200],['c',80]]));const before=[l.offset(0),l.offset(1),l.offset(2),l.offset(3)];l.measure(1,400);l.measure(0,NaN);return {before,after:l.offset(3),at:[l.indexAt(0),l.indexAt(40),l.indexAt(439),l.indexAt(440),l.indexAt(999)]};});expect(result).toEqual({before:[0,40,240,320],after:520,at:[0,1,1,2,2]});});
test('旧会话索引预览与完整路径一致：同时间排序、有效版本、忽略系统及用户伪版本',async({page})=>{
 await seedPerformance(page,1);const result=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {getConversation}=await import('/src/chatService.ts');await db.characters.put({id:'legacy-preview',name:'旧角色',persona:''});const c=await getConversation('legacy-preview');await db.messages.bulkPut([{id:'la',conversationId:c.id,role:'assistant',content:'旧回复',activeVariantId:'lv',createdAt:1},{id:'lz',conversationId:c.id,role:'user',content:'最后的用户原文',activeVariantId:'fake',createdAt:1},{id:'ls',conversationId:c.id,role:'system',content:'系统不作预览',createdAt:2}]);await db.messageVariants.bulkPut([{id:'lv',conversationId:c.id,messageId:'la',content:'选中版本',source:'generated',createdAt:1},{id:'fake',conversationId:c.id,messageId:'lz',content:'不能覆盖用户',source:'generated',createdAt:1}]);const {chatListPreviews}=await import('/src/chatListPreview.ts');const {activeMessages}=await import('/src/messagePath.ts');const first=(await chatListPreviews(['legacy-preview']))['legacy-preview'];const last=(await activeMessages(c.id)).filter(m=>m.role==='user'||m.role==='assistant').at(-1)!;await db.messages.update('lz',{archived:true});return {first:first.content,last:last.content,selected:(await chatListPreviews(['legacy-preview']))['legacy-preview'].content};});expect(result).toEqual({first:'最后的用户原文',last:'最后的用户原文',selected:'选中版本'});
});
