import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

/** A summary is only a memory if the exact original conversation still proves
 * its source. Assert the assembled model context, not a settings-page counter.
 */
test('verified first-pass summary reaches prompt; edited source invalidates it',async({page})=>{
 await isolatedApp(page,'summary-receipt-return');
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {getConversation}=await import('/src/chatService.ts');
  const {buildContext}=await import('/src/chatContext.ts');
  const {messageSourceFingerprint}=await import('/src/summarySourceFingerprint.ts');
  const {lastMemoryContextTrace}=await import('/src/memoryContext.ts');
  await db.characters.put({id:'summary-character',name:'角色',persona:'按事实回应'});
  const c=await getConversation('summary-character');
  const base=Date.now()-3600000;
  const user={id:'summary-u',conversationId:c.id,role:'user' as const,content:'我们在雨夜的桥上和好了。',createdAt:base};
  const assistant={id:'summary-a',conversationId:c.id,role:'assistant' as const,content:'我记得那天的雨。',createdAt:base+1000};
  await db.messages.bulkPut([user,assistant]);
  const fingerprint='s3:'+await messageSourceFingerprint([user,assistant] as any);
  const scope={mode:'daily' as const,spaceId:'daily' as const,conversationId:c.id,characterId:c.characterId};
  const receipt={id:'receipt-1',revision:1,scope,epoch:0,timelineId:'',throughNodeId:'summary-a',turns:[{userIds:[user.id],assistantId:assistant.id}],sourceFingerprint:fingerprint,shortSummary:'桥上的雨夜争执已经和解，双方重新建立信任。',createdAt:base+2000,added:0,duplicates:0};
  await db.conversations.update(c.id,{memorySummary:{version:1,enabled:true,interval:20,revision:1,receipts:[receipt]}});
  const current=(await db.conversations.get(c.id))!;
  const before=JSON.stringify(await buildContext(current));
  const beforeTrace=lastMemoryContextTrace(c.id);
  await db.messages.update(user.id,{content:'我们从未在桥上和好。'});
  const after=JSON.stringify(await buildContext((await db.conversations.get(c.id))!));
  const afterTrace=lastMemoryContextTrace(c.id);
  return {before,after,beforeTrace,afterTrace};
 });
 expect(result.before).toContain('桥上的雨夜争执已经和解');
 expect(result.beforeTrace?.injectedReceipts).toBe(1);
 expect(result.after).not.toContain('桥上的雨夜争执已经和解');
 expect(result.afterTrace?.injectedReceipts).toBe(0);
 expect(JSON.stringify(result.beforeTrace)).not.toContain('桥上的雨夜争执');
});
