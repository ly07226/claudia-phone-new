import {expectedGlobalCharacterConstraints} from './globalCharacterConstraintsFixture';
import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
import {reply} from './storyFixture';
async function seed(page:Page,debug=true){
 await isolatedApp(page,'context-regression-'+crypto.randomUUID());
 return page.evaluate(async debug=>{
  if(debug)history.replaceState(null,'','/?requestDebug=1');
  const {db}=await import('/src/store.ts');const {getConversation}=await import('/src/chatService.ts');
  await db.characters.bulkPut([{id:'actor',name:'离线角色',persona:'人设开始。仅当用户连名带姓称呼我才说「看来不会发生什么好事了」。人设结束。',speakingStyle:'角色原有的说话方式。'},{id:'other',name:'另一角色',persona:'OTHER_ACTOR_SECRET'}]);
  for(const id of ['one','two']){await db.worlds.put({id,name:id,description:id+'的世界简介',rules:'不得替用户决定行动',background:id+'的世界背景',createdAt:1,script:{version:1,playMode:'story',opening:'STORY_OPEN_ONLY',direction:'STORY_DIRECTION_ONLY',definitionRevision:1}});await db.worldProfiles.put({id,worldId:id,characterId:'actor',setting:id+'的世界角色设定'});}
  const cs=[await getConversation('actor'),await getConversation('actor','one'),await getConversation('actor','two'),await getConversation('other')];
  for(const c of cs)await db.messages.bulkPut([{id:c.id+'u',conversationId:c.id,role:'user',content:'昨晚我们在餐厅',createdAt:1},{id:c.id+'a',conversationId:c.id,role:'assistant',content:'昨晚在看菜单',createdAt:2}]);
  return cs.map(c=>c.id);
 },debug);
}

for(const provider of ['openai-compatible','gemini'])test('最终请求：人物卡完整、当前行动在末尾、Daily/World/角色/记忆作用域隔离 '+provider,async({page})=>{
 const ids=await seed(page);const requests:any[]=[];
 await page.route('https://context.test/**',r=>{requests.push(r.request().postDataJSON());return r.fulfill({json:provider==='gemini'?{candidates:[{content:{parts:[{text:'离线回复'}]}}]}:{choices:[{message:{content:'离线回复'}}]}});});
 const r=await page.evaluate(async({ids,provider})=>{
  const {db}=await import('/src/store.ts');const {getMemoryScope,createMemory}=await import('/src/memoryStore.ts');const {sendMessage}=await import('/src/chatService.ts');const {newBook,newEntry}=await import('/src/loreTypes.ts');
  await db.apiConfigs.put({id:'mock',name:'测试配置',provider,baseUrl:'https://context.test/v1',model:'mock',temperature:.63,maxTokens:777,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'mock',apiKey:'synthetic-secret-not-logged'});
  const book={...newBook(),id:'lore-one',worldIds:['one']};await db.lorebooks.put(book);await db.loreEntries.put({...newEntry(book.id),constant:true,content:'ONE_ONLY_LORE'});
  for(let i=0;i<ids.length;i++){const scope=await getMemoryScope(ids[i]);await createMemory(scope,{kind:'core',content:'仅此作用域核心'+i});await createMemory(scope,{kind:'long',content:'上班安排：仅此作用域长期'+i});}
  const stores=await db.conversations.toArray();for(const id of ids)await sendMessage(id,'我现在要去上班，不是去休息。');
  return {before:stores.map(c=>c.memoryStore),after:(await db.conversations.toArray()).map(c=>c.memoryStore),logs:(await import('/src/chatRequestDiagnostics.ts')).exportRequestDiagnostics()};
 },{ids,provider});
 expect(requests).toHaveLength(4);for(let i=0;i<4;i++){
  const b=requests[i],text=JSON.stringify(b),system=provider==='gemini'?b.systemInstruction.parts[0].text:b.messages[0].content;
  expect(system).toContain('仅此作用域核心'+i);expect(system).toContain('上班安排：仅此作用域长期'+i);
  for(let j=0;j<4;j++)if(i!==j){expect(text).not.toContain('仅此作用域核心'+j);expect(text).not.toContain('仅此作用域长期'+j);}
  if(i<3){expect(system).toContain('人设开始。仅当用户连名带姓称呼我才说「看来不会发生什么好事了」。人设结束。');expect(system).toContain('角色原有的说话方式。');expect(text).not.toContain('OTHER_ACTOR_SECRET');}
  expect(text).not.toContain('STORY_OPEN_ONLY');expect(text).not.toContain('STORY_DIRECTION_ONLY');expect(text).not.toContain('恰好四');expect(text).not.toContain('segments');
  expect(provider==='gemini'?b.contents.at(-1).parts.at(-1).text:b.messages.at(-1).content).toBe('我现在要去上班，不是去休息。');
  expect(provider==='gemini'?b.generationConfig:{temperature:b.temperature,maxOutputTokens:b.max_tokens}).toEqual({temperature:.63,maxOutputTokens:777});
  if(i===1){expect(text).toContain('ONE_ONLY_LORE');expect(system).toContain('one的世界角色设定');}else expect(text).not.toContain('ONE_ONLY_LORE');
  if(i===0||i===3){expect(text).not.toContain('one的世界背景');expect(text).not.toContain('two的世界背景');}
 }
 expect(r.after).toEqual(r.before);expect(r.logs).not.toContain('synthetic-secret');expect(r.logs).not.toContain('我现在要');expect(r.logs).not.toContain('仅此作用域');
});

test('确定性旧请求契约：基础提示/角色顺序不变；Story配置、节点及选项变化不影响World/Daily请求',async({page})=>{
 const ids=await seed(page);
 const r=await page.evaluate(async ids=>{
  const {db}=await import('/src/store.ts');const {buildContext}=await import('/src/chatContext.ts');
  const build=async(id:string)=>buildContext((await db.conversations.get(id))!);const before=[await build(ids[0]),await build(ids[1])];
  await db.worlds.update('one',{script:{version:1,playMode:'story',opening:'新的Story开场 A/B/C/D',direction:'恰好四个选项',definitionRevision:2},storyPreferences:{length:'detailed'}});
  // Even sentinel Story records must never be queried by free chat.
  await db.storyNodes.put({id:'sentinel',worldId:'one',sessionId:'sentinel-session',body:'STORY_BODY_ONLY',choices:['A','B','C','D'].map(label=>({id:label,label,text:'STORY_CHOICE_ONLY'})),createdAt:1,requestId:'sentinel-request',definitionRevision:2,sequence:1} as any);
  return {before,after:[await build(ids[0]),await build(ids[1])]};
 },ids);
 expect(r.after).toEqual(r.before);expect(r.before[0]).toEqual([
  {role:'system',content:'你正在进行角色扮演。遵循角色资料回应用户。只使用本会话提供的资料，不声称知道其他聊天空间的经历。\n角色：离线角色\n基础人格与设定：人设开始。仅当用户连名带姓称呼我才说「看来不会发生什么好事了」。人设结束。\n说话方式：角色原有的说话方式。\n当前聊天空间：日常聊天。此空间不采用任何世界背景。'+expectedGlobalCharacterConstraints},
  {role:'user',content:'昨晚我们在餐厅'},{role:'assistant',content:'昨晚在看菜单'}
 ]);
});

test('有效历史、选中回复版本及分支切换决定请求，不读取另一分支未来',async({page})=>{
 const ids=await seed(page);
 const r=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const {getCurrentTimeline,switchTimeline}=await import('/src/timelines.ts');const {editMessage,addGeneratedVariant,selectVariant}=await import('/src/messageOperations.ts');const {buildContext}=await import('/src/chatContext.ts');
  const root=await getCurrentTimeline(id);const m=(await db.messages.get(id+'a'))!;const variant=await addGeneratedVariant(m,'选中版本：用户明早必须上班');await selectVariant(id,m.id,variant.id,true);
  const selected=await buildContext((await db.conversations.get(id))!);await editMessage(id,id+'u','子分支独有事实：不去餐厅',true);const child=await buildContext((await db.conversations.get(id))!);
  await switchTimeline(id,root.id);const restored=await buildContext((await db.conversations.get(id))!);return {selected,child,restored};
 },ids[1]);
 expect(JSON.stringify(r.selected)).toContain('选中版本：用户明早必须上班');expect(JSON.stringify(r.selected)).not.toContain('昨晚在看菜单');expect(JSON.stringify(r.child)).toContain('子分支独有事实');expect(JSON.stringify(r.child)).not.toContain('选中版本');expect(JSON.stringify(r.restored)).toContain('昨晚在看菜单');expect(JSON.stringify(r.restored)).not.toContain('子分支独有事实');
});

test('ABCD来源分别标记世界书、记忆、历史与模型原始输出；不删改输出',async({page})=>{
 const ids=await seed(page);const choices='A. 第一项\nB. 第二项\nC. 第三项\nD. 玩家自由输入';
 const r=await page.evaluate(async({id,choices})=>{
  const {db}=await import('/src/store.ts');const {buildContext}=await import('/src/chatContext.ts');const {requestReply}=await import('/src/chatProvider.ts');const {getRequestDiagnostics}=await import('/src/chatRequestDiagnostics.ts');const {newBook,newEntry}=await import('/src/loreTypes.ts');const {getMemoryScope,createMemory}=await import('/src/memoryStore.ts');
  await db.messages.put({id:id+'a',conversationId:id,role:'assistant',content:choices,createdAt:2});await db.messages.put({id:'current',conversationId:id,role:'user',content:'上班',createdAt:3});
  const book={...newBook(),id:'one-book',worldIds:['one']};await db.lorebooks.put(book);await db.loreEntries.put({...newEntry(book.id),constant:true,content:choices});await createMemory(await getMemoryScope(id),{kind:'core',content:choices});
  const messages=await buildContext((await db.conversations.get(id))!);const config={id:'mock',name:'mock',provider:'openai-compatible' as const,baseUrl:'https://offline.test/v1',model:'mock',temperature:.7,maxTokens:500,enabled:true,createdAt:1,updatedAt:1};
  let calls=0;const output=await requestReply(config,'synthetic-secret',messages,new AbortController().signal,{send:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:choices}}]}));}});
  return {record:getRequestDiagnostics().at(-1),output,calls};
 },{id:ids[1],choices});
 expect(r.output).toBe(choices);expect(r.calls).toBe(1);for(const source of ['lore','memory','history'])expect(r.record!.sources.some(s=>s.source===source&&s.abcdLabels===4)).toBe(true);expect(r.record!.sources.some(s=>s.source==='story-instruction')).toBe(false);expect(r.record!.response!.abcdLabels).toBe(4);
});

test('无ABCD输入时模型自行输出四项：诊断保留原始输出特征，不虚报Story污染',async({page})=>{
 const ids=await seed(page);const r=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const {buildContext}=await import('/src/chatContext.ts');const {requestReply}=await import('/src/chatProvider.ts');const {getRequestDiagnostics}=await import('/src/chatRequestDiagnostics.ts');const messages=await buildContext((await db.conversations.get(id))!);
  const output='A. 一\nB. 二\nC. 三\nD. 自由输入';await requestReply({id:'mock',name:'mock',provider:'openai-compatible',baseUrl:'https://offline.test/v1',model:'mock',temperature:.7,maxTokens:500,enabled:true,createdAt:1,updatedAt:1},'secret',messages,new AbortController().signal,{send:async()=>new Response(JSON.stringify({choices:[{message:{content:output}}]}))});return getRequestDiagnostics().at(-1);
 },ids[1]);
 expect(r!.sources.every(s=>s.abcdLabels===0&&!s.choiceProtocolHint)).toBe(true);expect(r!.response!.abcdLabels).toBe(4);expect(r!.mode).toBe('world');
});

for(const provider of ['openai-compatible','gemini'])test('Story实际生成保留结构协议且不读取Daily/World聊天记忆 '+provider,async({page})=>{
 const ids=await seed(page);let request:any;
 await page.route('https://story-context.test/**',r=>{request=r.request().postDataJSON();const text=JSON.stringify(reply());return r.fulfill({json:provider==='gemini'?{candidates:[{content:{parts:[{text}]}}]}:{choices:[{message:{content:text}}]}});});
 const r=await page.evaluate(async({ids,provider})=>{
  const {db}=await import('/src/store.ts');const {createMemory,getMemoryScope}=await import('/src/memoryStore.ts');await createMemory(await getMemoryScope(ids[0]),{kind:'core',content:'DAILY_PRIVATE_MEMORY'});await createMemory(await getMemoryScope(ids[1]),{kind:'core',content:'WORLD_PRIVATE_MEMORY'});
  await db.apiConfigs.put({id:'story-api',name:'mock',provider,baseUrl:'https://story-context.test/v1',model:'mock',temperature:.7,maxTokens:3000,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'story-api',apiKey:'synthetic'});
  const node=await(await import('/src/storyGeneration.ts')).generateStory('one');return {choices:node.choices,record:(await import('/src/chatRequestDiagnostics.ts')).getRequestDiagnostics().at(-1)};
 },{ids,provider});
 const text=JSON.stringify(request);expect(text).toContain('恰好四');expect(text).toContain('STORY_OPEN_ONLY');expect(text).not.toContain('PRIVATE_MEMORY');expect(text).not.toContain('昨晚在看菜单');expect(r.choices).toHaveLength(4);expect(r.record!.mode).toBe('story');expect(r.record!.sources.map(s=>s.source)).toEqual(['story-instruction','story-input']);expect(r.record!.attempts[0].fallback).toBe(false);
});

test('真实时间：隔夜不清空话题记忆，也不强制重置场景',async({page})=>{
 await isolatedApp(page,'realtime-memory-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {realTimeSession,realTimeContext}=await import('/src/realTimeContext.ts');
  const now=Date.now(),id='daily';
  const rows=[
   {id:'a',conversationId:id,role:'assistant',content:'昨晚我们约好今天去看展',createdAt:now-10*3600000},
   {id:'u',conversationId:id,role:'user',content:'票你买好了吗',createdAt:now-500}
  ] as any;
  const session=realTimeSession(id,rows,now,'daily');
  return {newSession:session.newSession,context:realTimeContext(id,rows,now,'Asia/Shanghai','daily')?.content};
 });
 expect(result.newSession).toBe(false);
 expect(result.context).toContain('保留人物关系、过去事实、承诺、共同经历及相关长期记忆');
 expect(result.context).not.toContain('默认开启新时段');
});
