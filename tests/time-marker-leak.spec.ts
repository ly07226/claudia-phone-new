import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('internal timestamps are stripped only when they occupy a standalone assistant line',async({page})=>{
 await isolatedApp(page,'time-leak-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {stripLeakedTimeMarkers:clean}=await import('/src/timeMarkerSanitizer.ts');
  return {
   leaked:clean('[消息发送时间：2026-11-16, 10:57]\n昨晚是不是抓着手机纠结了半宿。\n[消息发送时间：2026-11-16, 10:58]\n你说得对。'),
   normal:clean('我们约在2026-11-16, 10:57见面。'),
   inline:clean('他说：[消息发送时间：2026-11-16, 10:57]'),
   malformed:clean('[消息发送时间：明天]\n保留原文'),
  };
 });
 expect(result.leaked).toBe('昨晚是不是抓着手机纠结了半宿。\n你说得对。');
 expect(result.normal).toBe('我们约在2026-11-16, 10:57见面。');
 expect(result.inline).toBe('他说：[消息发送时间：2026-11-16, 10:57]');
 expect(result.malformed).toBe('[消息发送时间：明天]\n保留原文');
});

test('real-time daily context does not prefix individual dialogue messages',async({page})=>{
 await isolatedApp(page,'time-context-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {getConversation}=await import('/src/chatService.ts');
  const {buildContext}=await import('/src/chatContext.ts');
  const id=crypto.randomUUID();
  await db.characters.add({id,name:'时钟角色',persona:'正常对话'});
  const conversation=await getConversation(id);
  await db.conversations.update(conversation.id,{chatSettings:{followRealTime:true}});
  const now=Date.now();
  await db.messages.bulkAdd([
   {id:crypto.randomUUID(),conversationId:conversation.id,role:'user',content:'现在几点？',createdAt:now-120000},
   {id:crypto.randomUUID(),conversationId:conversation.id,role:'assistant',content:'[消息发送时间：2026-11-16, 10:57]\n我在。',createdAt:now-60000},
  ]);
  const context=await buildContext((await db.conversations.get(conversation.id))!);
  return {history:context.filter(x=>x.role!=='system').map(x=>x.content),hasTime:context.some(x=>x.content.includes('[真实时间上下文]'))};
 });
 expect(result.hasTime).toBe(true);
 expect(result.history).toContain('我在。');
 expect(result.history).toContain('现在几点？');
 expect(result.history.join('\n')).not.toContain('[消息发送时间：');
});
