import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

/** Secondary digests must survive only while their complete source-day
 * message set remains byte-for-byte verifiable. No model API is invoked.
 */
test('verified second-level daily digest returns to context; edit and inserted source invalidate it',async({page})=>{
 await isolatedApp(page,'digest-return');
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {getConversation}=await import('/src/chatService.ts');
  const {buildContext}=await import('/src/chatContext.ts');
  const {messageSourceFingerprint}=await import('/src/summarySourceFingerprint.ts');
  const {lastMemoryContextTrace}=await import('/src/memoryContext.ts');
  await db.characters.put({id:'digest-character',name:'角色',persona:'按事实回应'});
  const c=await getConversation('digest-character');
  const yesterday=new Date();yesterday.setHours(0,0,0,0);yesterday.setDate(yesterday.getDate()-1);
  const today=new Date(yesterday);today.setDate(today.getDate()+1);
  const day=(d:Date)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  const first={id:'digest-u',conversationId:c.id,role:'user' as const,content:'昨天在灯塔商量了旅行计划。',createdAt:yesterday.getTime()+3600000};
  const second={id:'digest-a',conversationId:c.id,role:'assistant' as const,content:'我们决定一起出发。',createdAt:yesterday.getTime()+3601000};
  const latest={id:'digest-today',conversationId:c.id,role:'user' as const,content:'灯塔旅行的计划还算数吗？',createdAt:today.getTime()+3600000};
  await db.messages.bulkPut([first,second,latest]);
  const scope={mode:'daily' as const,spaceId:'daily' as const,conversationId:c.id,characterId:c.characterId};
  const digest={id:'digest-1',scope,startDay:day(yesterday),endDay:day(today),text:'灯塔旅行：两人约定一起出发。',createdAt:Date.now(),sourceMessageIds:[first.id,second.id],sourceFingerprint:'s3:'+await messageSourceFingerprint([first,second] as any)};
  await db.conversations.update(c.id,{dailyDigests:[digest]});
  const context=async()=>JSON.stringify(await buildContext((await db.conversations.get(c.id))!));
  const before=await context(),beforeTrace=lastMemoryContextTrace(c.id);
  await db.messages.update(first.id,{content:'昨天并没有讨论旅行。'});
  const edited=await context(),editedTrace=lastMemoryContextTrace(c.id);
  await db.messages.update(first.id,{content:first.content});
  await db.messages.put({id:'digest-insert',conversationId:c.id,role:'user',content:'插入的昨日消息',createdAt:yesterday.getTime()+3600500});
  const inserted=await context(),insertedTrace=lastMemoryContextTrace(c.id);
  return {before,edited,inserted,beforeTrace,editedTrace,insertedTrace};
 });
 expect(result.before).toContain('灯塔旅行：两人约定一起出发');
 expect(result.beforeTrace?.injectedDigests).toBe(1);
 expect(result.edited).not.toContain('灯塔旅行：两人约定一起出发');
 expect(result.editedTrace?.injectedDigests).toBe(0);
 expect(result.inserted).not.toContain('灯塔旅行：两人约定一起出发');
 expect(result.insertedTrace?.injectedDigests).toBe(0);
 expect(JSON.stringify(result.beforeTrace)).not.toContain('灯塔旅行');
});
