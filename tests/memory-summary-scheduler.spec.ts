import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('summary errors: transient retry only, never quota/auth/safety/format',async({page})=>{
 await isolatedApp(page,'summary-errors-'+crypto.randomUUID());
 const decisions=await page.evaluate(async()=>{
  const {classifySummaryError}=await import('/src/memorySummaryErrors.ts');
  const {ReplyRequestError,replyFailureDetails}=await import('/src/replyFailure.ts');
  const {SummaryResponseError}=await import('/src/memorySummaryRequest.ts');
  const http=(status:number,code?:string)=>new ReplyRequestError('synthetic',replyFailureDetails({httpStatus:status,code}));
  return {
   offline:classifySummaryError(http(503),false),
   network:classifySummaryError(new ReplyRequestError('synthetic',replyFailureDetails({network:true}))),
   server:classifySummaryError(http(503)),
   rate:classifySummaryError(http(429,'rate_limit_exceeded')),
   quota:classifySummaryError(http(429,'insufficient_quota')),
   auth:classifySummaryError(http(401)),
   safety:classifySummaryError(http(400,'content_filter')),
   format:classifySummaryError(new SummaryResponseError({version:1,stage:'parse',code:'json-syntax'})),
   unsupported:classifySummaryError(new SummaryResponseError({version:1,stage:'response',code:'structured-unsupported'}))
  };
 });
 expect(decisions.offline.kind).toBe('offline');
 expect(decisions.network.retry).toBe(true);
 expect(decisions.server.retry).toBe(true);
 expect(decisions.rate.retry).toBe(true);
 for(const kind of ['offline','quota','auth','safety','format','unsupported'] as const)expect(decisions[kind].retry).toBe(false);
 expect(decisions.quota.kind).toBe('quota');
 expect(decisions.rate.kind).toBe('transient');
});

test('automatic summary: provider 503 ends immediately, cooldown recovery does not require more chat',async({page})=>{
 await isolatedApp(page,'summary-retry-'+crypto.randomUUID());
 const id=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {getConversation}=await import('/src/chatService.ts');
  const {getMemoryScope}=await import('/src/memoryStore.ts');
  const {saveSummarySettings}=await import('/src/memorySummary.ts');
  await db.characters.put({id:'retry-character',name:'Retry',persona:''});
  const c=await getConversation('retry-character');
  const messages=[];
  for(let i=0;i<20;i++){messages.push({id:'ru'+i,conversationId:c.id,role:'user',content:'第'+i+'轮计划',createdAt:i*2+1},{id:'ra'+i,conversationId:c.id,role:'assistant',content:'第'+i+'轮回复',createdAt:i*2+2});}
  await db.messages.bulkPut(messages);
  await db.apiConfigs.put({id:'retry-api',name:'mock',provider:'openai-compatible',baseUrl:'https://summary-retry.test/v1',model:'fixture',temperature:0,maxTokens:4000,enabled:true,isDefault:true,createdAt:1,updatedAt:1});
  await db.apiCredentials.put({configId:'retry-api',apiKey:'synthetic'});
  const transport=(await db.apiConfigs.toArray())[0];await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi({...transport,apiKey:'synthetic'});await saveSummarySettings(await getMemoryScope(c.id),true,20);
  return c.id;
 });
 let calls=0;
 await page.route('https://summary-retry.test/**',route=>{calls++;return route.fulfill({status:503,json:{error:{message:'server unavailable'}}});});
 await page.evaluate(async id=>{const {tryAutoSummary}=await import('/src/memorySummary.ts');await tryAutoSummary(id);},id);
 await expect.poll(async()=>page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.memorySummary?.job?.status,id)).toBe('failed');
 expect(calls).toBe(1);
 const state=await page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.memorySummary,id);
 expect(state?.job?.failureKind).toBe('transient');
 expect(state?.requiresManualResume).toBe(false);expect(state?.deferUntilPending).toBeUndefined();
 expect(state?.receipts).toHaveLength(0);
 await page.evaluate(async id=>{await(await import('/src/memorySummary.ts')).tryAutoSummary(id);},id);
 expect(calls).toBe(1);
});

test('automatic summary: authentication error preserves backlog and requires explicit recovery',async({page})=>{
 await isolatedApp(page,'summary-auth-'+crypto.randomUUID());
 const id=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {getConversation}=await import('/src/chatService.ts');
  const {getMemoryScope}=await import('/src/memoryStore.ts');
  const {saveSummarySettings}=await import('/src/memorySummary.ts');
  await db.characters.put({id:'auth-character',name:'Auth',persona:''});
  const c=await getConversation('auth-character');
  const messages=[];
  for(let i=0;i<20;i++)messages.push({id:'au'+i,conversationId:c.id,role:'user',content:'第'+i+'轮',createdAt:i*2+1},{id:'aa'+i,conversationId:c.id,role:'assistant',content:'第'+i+'轮回复',createdAt:i*2+2});
  await db.messages.bulkPut(messages);
  await db.apiConfigs.put({id:'auth-api',name:'mock',provider:'openai-compatible',baseUrl:'https://summary-auth.test/v1',model:'fixture',temperature:0,maxTokens:4000,enabled:true,isDefault:true,createdAt:1,updatedAt:1});
  await db.apiCredentials.put({configId:'auth-api',apiKey:'synthetic'});
  const transport=(await db.apiConfigs.toArray())[0];await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi({...transport,apiKey:'synthetic'});await saveSummarySettings(await getMemoryScope(c.id),true,20);
  return c.id;
 });
 let calls=0;
 await page.route('https://summary-auth.test/**',route=>{calls++;return route.fulfill({status:401,json:{error:{code:'invalid_api_key',message:'synthetic'}}});});
 await page.evaluate(async id=>{await(await import('/src/memorySummary.ts')).tryAutoSummary(id);},id);
 await expect.poll(async()=>page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.memorySummary?.job?.status,id)).toBe('failed');
 expect(calls).toBe(1);
 const state=await page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.memorySummary,id);
 expect(state?.job?.failureKind).toBe('auth');
 expect(state?.requiresManualResume).toBe(true);expect(state?.deferUntilPending).toBeUndefined();
 expect(state?.receipts).toHaveLength(0);
});
