import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('零相关长期不注入，核心独立优先；空查询不补入长期记忆',async({page})=>{
 await isolatedApp(page,'memory-integrity-'+crypto.randomUUID());
 const r=await page.evaluate(async()=>{
  const {selectMemoryContext}=await import('/src/memoryContext.ts');
  const base={revision:1,scope:{mode:'daily' as const,spaceId:'daily' as const,conversationId:'fixture',characterId:'fixture'},source:'manual' as const,deleted:false,createdAt:1,updatedAt:1,inherited:false};
  const core={...base,id:'core',kind:'core' as const,content:'花生过敏，不能食用。'},long={...base,id:'long',kind:'long' as const,content:'篮球比赛结束了。'},related={...base,id:'related',kind:'long' as const,content:'咖啡必须不加糖。'};
  const tags=[{entryId:'related',revision:1,tags:[{axis:'keyword' as const,tag:'咖啡',weight:1}],taggedAt:1}];return {normal:selectMemoryContext([long,related,core],'我想喝咖啡',24000,tags),empty:selectMemoryContext([long,related,core],'',24000,tags),untagged:selectMemoryContext([long,related,core],'我想喝咖啡',24000)};
 });
 expect(r.normal.text).toContain('花生过敏，不能食用。');expect(r.normal.text).toContain('咖啡必须不加糖。');expect(r.normal.text).not.toContain('篮球');expect(r.normal.skippedIrrelevant).toBe(1);expect(r.normal.text.indexOf('花生')).toBeLessThan(r.normal.text.indexOf('咖啡'));
 expect(r.untagged.selected).toBe(1);expect(r.untagged.text).not.toContain('咖啡');expect(r.empty.selected).toBe(1);expect(r.empty.text).not.toContain('咖啡');expect(r.empty.skippedIrrelevant).toBe(2);
});

test('否定、主体、数字、时间及后置条件完整保留；超预算整条跳过不截断',async({page})=>{
 await isolatedApp(page,'memory-whole-'+crypto.randomUUID());
 const r=await page.evaluate(async()=>{
  const {selectMemoryContext,memoryTokenCost,memoryContextLimits}=await import('/src/memoryContext.ts');
  const base={kind:'core' as const,revision:1,scope:{mode:'daily' as const,spaceId:'daily' as const,conversationId:'fixture',characterId:'fixture'},source:'manual' as const,deleted:false,createdAt:1,updatedAt:1,inherited:false};
  const fact='昨天可以休息；但今天08:00用户要上班，只有请假获批才可休息，不是角色去上班。';
  const long='昨日可以休息。'.repeat(80)+'但今天用户要上班，不得建议休息。';
  const entries=[{...base,id:'large',content:long},{...base,id:'small',content:fact}];
  const original=JSON.stringify(entries),selected=selectMemoryContext(entries,'上班',24000),tight=selectMemoryContext([{...base,id:'small',content:fact}],'上班',30);
  return {fact,long,selected,tight,unchanged:original===JSON.stringify(entries),cost:memoryTokenCost(selected.text),limit:memoryContextLimits.tokens};
 });
 expect(r.selected.text).toContain(r.fact);expect(r.selected.text).not.toContain('昨日可以休息');expect(r.selected.truncated).toBe(0);expect(r.selected.skippedBudget).toBe(1);expect(r.cost).toBeLessThanOrEqual(r.limit);expect(r.unchanged).toBe(true);expect(r.tight.text).toBe('');expect(r.tight.skippedBudget).toBe(1);
});

test('预算边界不截断单条 JSON 事实，数据库原始记忆与版本不变',async({page})=>{
 await isolatedApp(page,'memory-persistent-'+crypto.randomUUID());
 const r=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');const {getConversation}=await import('/src/chatService.ts');const {getMemoryScope,createMemory}=await import('/src/memoryStore.ts');const {buildContext}=await import('/src/chatContext.ts');const {lastMemoryContextTrace}=await import('/src/memoryContext.ts');
  await db.characters.put({id:'fixture',name:'角色',persona:'完整人设'});const c=await getConversation('fixture');await db.messages.put({id:'user',conversationId:c.id,role:'user',content:'今天去上班',createdAt:1});
  const scope=await getMemoryScope(c.id);await createMemory(scope,{kind:'core',content:'昨天可休息。'.repeat(100)+'除非今天必须上班，不要建议休息。'});await createMemory(scope,{kind:'long',content:'篮球比赛普通经历。'});
  const before=(await db.conversations.get(c.id))!.memoryStore;const context=await buildContext((await db.conversations.get(c.id))!);const after=(await db.conversations.get(c.id))!.memoryStore;
  return {before,after,context,trace:lastMemoryContextTrace(c.id)};
 });
 expect(r.after).toEqual(r.before);expect(r.trace).toMatchObject({selected:0,truncated:0,skippedBudget:1,skippedIrrelevant:1});expect(r.context.at(-1)!.content).toBe('今天去上班');expect(JSON.stringify(r.context)).not.toContain('昨天可休息');
});
