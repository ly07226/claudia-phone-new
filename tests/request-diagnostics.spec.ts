import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
async function seed(page:Page,debug=true){
 await isolatedApp(page,'request-diagnostics-'+crypto.randomUUID());
 return page.evaluate(async debug=>{if(debug)history.replaceState(null,'','/?requestDebug=1');const {db}=await import('/src/store.ts');const {getConversation}=await import('/src/chatService.ts');await db.characters.put({id:'private-character-id',name:'PRIVATE_NAME',persona:'PRIVATE_PERSONA_SECRET',speakingStyle:'PRIVATE_STYLE'});return (await getConversation('private-character-id')).id;},debug);
}

test('默认关闭，启用时只存脱敏元数据；诊断不改变请求、记忆或持久化内容',async({page})=>{
 const id=await seed(page,false);
 const r=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const {buildContext}=await import('/src/chatContext.ts');const debug=await import('/src/chatRequestDiagnostics.ts');
  await db.messages.put({id:'private-message-id',conversationId:id,role:'user',content:'PRIVATE_CHAT_SECRET',createdAt:1});
  const snapshot=async()=>JSON.stringify(await Promise.all(db.tables.map(t=>t.toArray())));const before=await snapshot();const storage=JSON.stringify(localStorage),c=(await db.conversations.get(id))!;
  const disabled=await buildContext(c),off=debug.getRequestDiagnostics();history.replaceState(null,'','/?requestDebug=1');const enabled=await buildContext(c),on=debug.exportRequestDiagnostics();
  return {disabled,enabled,off,on,unchanged:before===await snapshot(),storageUnchanged:storage===JSON.stringify(localStorage)};
 },id);
 expect(r.enabled).toEqual(r.disabled);expect(r.off).toHaveLength(0);expect(JSON.parse(r.on).requests).toHaveLength(1);for(const secret of ['PRIVATE','private-character-id','private-message-id',id])expect(r.on).not.toContain(secret);expect(r.unchanged).toBe(true);expect(r.storageUnchanged).toBe(true);
 await expect(page.getByRole('complementary',{name:'聊天请求脱敏诊断'})).toBeVisible();
});

test('世界书触发、重复内容、插入角色/位置、跳过原因及预算可追踪，不自动去重或改写',async({page})=>{
 const id=await seed(page);
 const r=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const {buildContext}=await import('/src/chatContext.ts');const {newBook,newEntry}=await import('/src/loreTypes.ts');const {getRequestDiagnostics}=await import('/src/chatRequestDiagnostics.ts');
  const global={...newBook(),id:'global',global:true,charBudget:4000},outside={...newBook(),id:'outside',worldIds:['another-world']},small={...newBook(),id:'small',global:true,charBudget:1},disabled={...newBook(),id:'disabled',global:true,enabled:false};await db.lorebooks.bulkPut([global,outside,small,disabled]);
  await db.loreEntries.bulkPut([
   {...newEntry(global.id),id:'first',constant:true,content:'PRIVATE_DUPLICATE_RULE',role:'system',insertionPosition:'before-profile'},
   {...newEntry(global.id),id:'second',constant:true,content:'PRIVATE_DUPLICATE_RULE',role:'assistant',insertionPosition:'after-conversation'},
   {...newEntry(global.id),id:'triggered',primaryKeys:['上班'],content:'PRIVATE_TRIGGERED_RULE',insertionPosition:'at-depth',insertionDepth:1},
   {...newEntry(global.id),id:'miss',primaryKeys:['未出现暗号'],content:'PRIVATE_MISSED_RULE'},
   {...newEntry(small.id),id:'overbudget',constant:true,content:'PRIVATE_BUDGET_RULE'},
   {...newEntry(outside.id),id:'outside-rule',constant:true,content:'PRIVATE_OUTSIDE_RULE'},
  ]);
  await db.messages.put({id:'current',conversationId:id,role:'user',content:'我今天去上班',createdAt:1});const messages=await buildContext((await db.conversations.get(id))!);return {record:getRequestDiagnostics().at(-1),messages};
 },id);
 const trace=r.record!;expect(trace.sources.filter(s=>s.source==='lore')).toHaveLength(3);expect(trace.sources.some(s=>s.source==='lore'&&s.duplicateOf!==undefined)).toBe(true);expect(trace.sources.some(s=>s.source==='lore'&&s.position==='after-conversation'&&s.role==='assistant')).toBe(true);expect(trace.sources.some(s=>s.position==='at-depth'&&s.depth===1)).toBe(true);expect(trace.sources.filter(s=>s.source==='lore').every(s=>s.scope==='global')).toBe(true);
 expect(trace.lore.some(d=>d.reason==='primary-miss')).toBe(true);expect(trace.lore.some(d=>d.reason==='book-budget')).toBe(true);expect(trace.skippedBooks).toEqual({disabled:1,outOfScope:1});expect(JSON.stringify(trace)).not.toContain('PRIVATE');expect(trace.budget!.systemUsed).toBeLessThanOrEqual(trace.budget!.systemLimit);expect(JSON.stringify(r.messages).split('PRIVATE_DUPLICATE_RULE')).toHaveLength(3);expect(JSON.stringify(r.messages)).not.toContain('PRIVATE_OUTSIDE_RULE');
});

test('最终Provider角色变换及一次旧式role降级可观察；无额外重试、Key/URL/模型/错误正文不进入日志',async({page})=>{
 const id=await seed(page);
 const r=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const {buildContext}=await import('/src/chatContext.ts');const {requestReply}=await import('/src/chatProvider.ts');const {exportRequestDiagnostics,getRequestDiagnostics}=await import('/src/chatRequestDiagnostics.ts');
  await db.messages.put({id:'current',conversationId:id,role:'user',content:'私人问题',createdAt:1});const messages=await buildContext((await db.conversations.get(id))!);let calls=0;
  const output=await requestReply({id:'config',name:'private-config',provider:'openai-compatible',baseUrl:'https://private-endpoint.test/v1',model:'private-model',temperature:.7,maxTokens:100,enabled:true,createdAt:1,updatedAt:1},'sk-sensitive-synthetic',messages,new AbortController().signal,{send:async()=>{calls++;return calls===1?new Response(JSON.stringify({error:{code:'unsupported_role',message:'private-error-token'}}),{status:400}):new Response(JSON.stringify({choices:[{message:{content:'响应不应日志保存 sk-sensitive-synthetic'}}]}));}});
  return {calls,output,record:getRequestDiagnostics().at(-1),log:exportRequestDiagnostics()};
 },id);
 expect(r.calls).toBe(2);expect(r.record!.attempts).toHaveLength(2);expect(r.record!.attempts[0].fallback).toBe(false);expect(r.record!.attempts[1]).toMatchObject({fallback:true,roles:['user','user']});expect(r.output).toContain('[凭据已隐藏]');for(const privateText of ['PRIVATE','sk-sensitive','private-endpoint','private-error','private-model','私人问题','响应不应'])expect(r.log).not.toContain(privateText);
});

test('内存只保留20次请求，来源超限有明确截断计数；失败只有类别和状态码',async({page})=>{
 await seed(page);
 const r=await page.evaluate(async()=>{
  const {registerRequestDiagnostics,getRequestDiagnostics,recordRequestFailure,exportRequestDiagnostics}=await import('/src/chatRequestDiagnostics.ts');
  for(let i=0;i<22;i++){const messages=[{role:'user' as const,content:'SECRET_TOKEN'}];registerRequestDiagnostics('daily',messages,Array.from({length:205},()=>({source:'history' as const,text:'PRIVATE'})));recordRequestFailure(messages,'http-error',429);}
  return {records:getRequestDiagnostics(),text:exportRequestDiagnostics()};
 });
 expect(r.records).toHaveLength(20);expect(r.records[0].sequence).toBe(3);expect(r.records.at(-1)).toMatchObject({status:'http-error',httpStatus:429,sourcesOmitted:5});expect(r.text).not.toContain('SECRET');expect(r.text).not.toContain('PRIVATE');
});

test('390px脱敏面板按需展开、可复制，不主动抢输入焦点或改变页面滚动',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await page.setViewportSize({width:390,height:844});const id=await seed(page);
 await page.evaluate(async id=>{const {db,usePhone}=await import('/src/store.ts');await db.messages.put({id:'current',conversationId:id,role:'user',content:'私人文字',createdAt:1});await usePhone.getState().reload();usePhone.getState().set({activeApp:'聊天'});},id);
 await page.getByRole('button',{name:/PRIVATE_NAME 开始/}).click();await page.getByLabel('聊天消息',{exact:true}).fill('待发送草稿');await page.getByLabel('聊天消息',{exact:true}).focus();
 await page.evaluate(async id=>{const {db}=await import('/src/store.ts');await(await import('/src/chatContext.ts')).buildContext((await db.conversations.get(id))!);},id);
 const position=await page.evaluate(()=>({y:scrollY,input:document.activeElement?.getAttribute('aria-label')}));await page.getByRole('button',{name:/请求诊断/}).click();await page.getByRole('button',{name:'复制脱敏诊断'}).click();await expect(page.getByText('已复制脱敏诊断')).toBeVisible();
 const state=await page.evaluate(()=>({y:scrollY,input:document.activeElement?.getAttribute('aria-label')}));expect(state).toEqual(position);await expect(page.getByLabel('聊天消息',{exact:true})).toHaveValue('待发送草稿');const log=await page.evaluate(()=>navigator.clipboard.readText());expect(log).not.toContain('私人文字');expect(log).not.toContain('PRIVATE_NAME');
});
