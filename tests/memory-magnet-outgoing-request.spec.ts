import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

/** The outgoing provider request is the oracle, not a UI badge or an internal
 * selection count. No paid provider is contacted: Playwright intercepts it.
 */
for(const provider of ['openai-compatible','gemini'])test('message-level recall reaches actual model request and removing tag stops return: '+provider,async({page})=>{
 await isolatedApp(page,'magnet-outgoing-'+provider);
 const bodies:any[]=[];
 await page.route('https://magnet-request.test/**',route=>{
  bodies.push(route.request().postDataJSON());
  return route.fulfill({json:provider==='gemini'?{candidates:[{content:{parts:[{text:'收到'}]}}]}:{choices:[{message:{content:'收到'}}]}});
 });
 const id=await page.evaluate(async provider=>{
  const {db}=await import('/src/store.ts');
  const {getConversation}=await import('/src/chatService.ts');
  await db.characters.put({id:'magnet-character',name:'测试角色',persona:'请自然回复'});
  const c=await getConversation('magnet-character');
  await db.apiConfigs.put({id:'magnet-api',name:'模拟',provider,baseUrl:'https://magnet-request.test/v1',model:'mock',enabled:true,isDefault:true,temperature:.7,maxTokens:100,createdAt:1,updatedAt:1});
  await db.apiCredentials.put({configId:'magnet-api',apiKey:'synthetic-fixture-only'});
  const message={id:'magnet-history',conversationId:c.id,role:'user' as const,content:'我们曾在码头约定下周见面。',createdAt:Date.now()-60000};
  await db.messages.put(message);
  const scope={mode:'daily' as const,spaceId:'daily' as const,conversationId:c.id,characterId:c.characterId};
  const bytes=new TextEncoder().encode(JSON.stringify([message.id,'',message.content]));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const fingerprint=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  await db.conversations.update(c.id,{memoryStore:{version:1,revision:0,entries:[],forks:[],magneticMessages:[{messageId:message.id,fingerprint,scope,summary:'在码头约定下周见面。',detail:'',tags:[{axis:'keyword',tag:'码头',weight:2}],createdAt:message.createdAt,taggedAt:Date.now(),active:true}]}});
  const {sendMessage}=await import('/src/chatService.ts');
  await sendMessage(c.id,'你还记得码头吗？');
  return c.id;
 },provider);
 expect(bodies).toHaveLength(1);
 const system=(body:any)=>provider==='gemini'?body.systemInstruction.parts[0].text:body.messages[0].content;
 expect(system(bodies[0])).toContain('[磁铁记忆');
 expect(system(bodies[0])).toContain('在码头约定下周见面');
 const before=await page.evaluate(async id=>{const {lastMemoryContextTrace}=await import('/src/memoryContext.ts');return lastMemoryContextTrace(id);},id);
 expect(before?.injectedMagnetic).toBe(1);
 await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');
  const c=(await db.conversations.get(id))!;
  const store=structuredClone(c.memoryStore!);
  store.magneticMessages![0].tags=[];
  await db.conversations.update(id,{memoryStore:store});
  const {sendMessage}=await import('/src/chatService.ts');
  await sendMessage(id,'码头那件事你记得吗？');
 },id);
 expect(bodies).toHaveLength(2);
 expect(system(bodies[1])).not.toContain('[磁铁记忆');
 const after=await page.evaluate(async id=>{const {lastMemoryContextTrace}=await import('/src/memoryContext.ts');return lastMemoryContextTrace(id);},id);
 expect(after?.injectedMagnetic).toBe(0);
});
