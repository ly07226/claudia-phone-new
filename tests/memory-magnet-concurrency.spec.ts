import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('two concurrent tag batches claim each source revision once without real API calls',async({page})=>{
 await isolatedApp(page,'magnet-concurrent-claim');
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {tagMagneticMessages}=await import('/src/memoryMagnetMessages.ts');
  const scope={mode:'daily' as const,spaceId:'daily' as const,conversationId:'magnet-concurrent',characterId:'test-character'};
  await db.conversations.put({id:scope.conversationId,scopeKey:'magnet-concurrent',characterId:scope.characterId,mode:'daily',createdAt:1,updatedAt:1});
  await db.messages.put({id:'magnet-message',conversationId:scope.conversationId,role:'user',content:'我们在码头见面',createdAt:2});
  let calls=0;
  const provider=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,80));return {summary:'曾在码头见面',keyword:['码头'],emotion:[],topic:[]};};
  const taxonomy={emotion:['高兴'],topic:['旅行']};
  const [a,b]=await Promise.all([tagMagneticMessages(scope,provider,taxonomy,20),tagMagneticMessages(scope,provider,taxonomy,20)]);
  const stored=(await db.conversations.get(scope.conversationId))?.memoryStore;
  const after=await tagMagneticMessages(scope,provider,taxonomy,20);
  return {calls,tagged:a.tagged+b.tagged,seen:a.seen+b.seen,records:stored?.magneticMessages?.length,attempts:stored?.magneticAttempts?.length,after:after.seen,initialized:stored?.version===1};
 });
 expect(result).toEqual({calls:1,tagged:1,seen:1,records:1,attempts:0,after:0,initialized:true});
});

test('interrupted claim never auto-retries; explicit recovery requires failed status',async({page})=>{
 await isolatedApp(page,'magnet-interrupted-claim');
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {tagMagneticMessages}=await import('/src/memoryMagnetMessages.ts');
  const scope={mode:'daily' as const,spaceId:'daily' as const,conversationId:'magnet-interrupted',characterId:'test-character'};
  await db.conversations.put({id:scope.conversationId,scopeKey:'magnet-interrupted',characterId:scope.characterId,mode:'daily',createdAt:1,updatedAt:1});
  const message={id:'magnet-message',conversationId:scope.conversationId,role:'user' as const,content:'码头的约定',createdAt:2};
  await db.messages.put(message);
  const bytes=new TextEncoder().encode(JSON.stringify([message.id,'',message.content]));
  const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  await db.conversations.update(scope.conversationId,{memoryStore:{version:1,revision:0,entries:[],forks:[],magneticAttempts:[{messageId:message.id,fingerprint,status:'pending',startedAt:1}]}});
  let calls=0;const provider=async()=>{calls++;return {summary:'码头约定',keyword:['码头'],emotion:[],topic:[]};};
  const taxonomy={emotion:['高兴'],topic:['旅行']};
  const normal=await tagMagneticMessages(scope,provider,taxonomy,20);
  const retry=await tagMagneticMessages(scope,provider,taxonomy,20,true);
  return {calls,normal:normal.seen,retry:retry.seen};
 });
 expect(result).toEqual({calls:0,normal:0,retry:0});
});
