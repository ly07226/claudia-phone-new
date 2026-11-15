import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('global summary API is shared across roles but separate from chat API',async({page})=>{
 await isolatedApp(page,'summary-global-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {getConversation}=await import('/src/chatService.ts');
  const {getMemoryScope}=await import('/src/memoryStore.ts');
  const {saveSummaryApi,getSummaryApi}=await import('/src/dedicatedSummaryApi.ts');
  await db.characters.bulkPut([{id:'g1',name:'A',persona:''},{id:'g2',name:'B',persona:''}]);
  const a=await getConversation('g1'),b=await getConversation('g2');
  const config={provider:'openai-compatible' as const,baseUrl:'https://summary.test/v1',model:'summary-model',apiKey:'fixture-key',temperature:.2,maxTokens:3000,enabled:true};
  await saveSummaryApi(config);
  await db.apiConfigs.put({id:'chat',name:'Chat',provider:'openai-compatible',baseUrl:'https://chat.test/v1',model:'chat-model',temperature:.7,maxTokens:3000,enabled:true,isDefault:true,createdAt:1,updatedAt:1});
  const first=await getSummaryApi(await getMemoryScope(a.id));
  const second=await getSummaryApi(await getMemoryScope(b.id));
  return {first:first.config.model,second:second.config.model,chat:(await db.apiConfigs.get('chat'))?.model,global:(await db.themes.get('global'))?.dedicatedSummaryApi?.model};
 });
 expect(result).toEqual({first:'summary-model',second:'summary-model',chat:'chat-model',global:'summary-model'});
});

test('long single message daily digest processes every part without silently dropping text',async({page})=>{
 await isolatedApp(page,'digest-long-'+crypto.randomUUID());
 const requests:string[]=[];
 await page.route('https://summary.test/**',route=>{
  const body=route.request().postDataJSON();
  requests.push(JSON.stringify(body));
  return route.fulfill({json:{choices:[{message:{content:'片段摘要：事实、时间与关系变化'}}]}});
 });
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {getConversation}=await import('/src/chatService.ts');
  const {getMemoryScope}=await import('/src/memoryStore.ts');
  const {saveSummaryApi}=await import('/src/dedicatedSummaryApi.ts');
  const {saveDailyDigestSettings,runDailyDigest,dailyDigestStatus}=await import('/src/dailyDigest.ts');
  await db.characters.put({id:'long',name:'Long',persona:''});
  const c=await getConversation('long');
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);yesterday.setHours(12,0,0,0);
  const content='开头标记'+('长篇剧情'.repeat(10000))+'结尾标记';
  await db.messages.put({id:'long-u',conversationId:c.id,role:'user',content,createdAt:yesterday.getTime()});
  const scope=await getMemoryScope(c.id);
  await saveSummaryApi({provider:'openai-compatible',baseUrl:'https://summary.test/v1',model:'fixture',apiKey:'fixture-key',temperature:.2,maxTokens:3000,enabled:true});
  await saveDailyDigestSettings(scope,true,1);
  await runDailyDigest(scope);
  const status=await dailyDigestStatus(scope);
  return {count:status.digests.length,hasText:status.digests.some(d=>d.text.length>0),sourceIds:status.digests[0]?.sourceMessageIds};
 });
 expect(result.count).toBe(1);
 expect(result.hasText).toBe(true);
 expect(result.sourceIds).toEqual(['long-u']);
 expect(requests.some(body=>body.includes('开头标记'))).toBe(true);
 expect(requests.some(body=>body.includes('结尾标记'))).toBe(true);
});

test('fallback database lease rejects concurrent jobs',async({page})=>{
 await isolatedApp(page,'summary-lock-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {withSummaryLock}=await import('/src/summaryLock.ts');
  let calls=0;
  const first=withSummaryLock('lease-test',async()=>{calls++;await new Promise(r=>setTimeout(r,100));});
  await new Promise(r=>setTimeout(r,20));
  const second=withSummaryLock('lease-test',async()=>{calls++;});
  await Promise.all([first,second]);
  return calls;
 });
 expect(result).toBe(1);
});
