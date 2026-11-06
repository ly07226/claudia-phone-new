import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
test.use({timezoneId:'Asia/Shanghai'});
const now=Date.parse('2026-11-03T12:34:00Z');
async function seed(page:Page){
 await isolatedApp(page,'real-time-'+crypto.randomUUID());
 return page.evaluate(async()=>{
  const {db,usePhone}=await import('/src/store.ts');const {getConversation}=await import('/src/chatService.ts');
  await db.characters.bulkAdd([{id:'time-a',name:'时间角色',persona:'保持原始设定'},{id:'time-b',name:'另一角色',persona:''}]);
  for(const id of ['time-world-a','time-world-b']){await db.worlds.add({id,name:id,description:'原始世界',createdAt:1});await db.worldProfiles.add({id,worldId:id,characterId:'time-a',setting:'原始世界身份'});}
  const a=await getConversation('time-a'),b=await getConversation('time-b'),wa=await getConversation('time-a','time-world-a'),wb=await getConversation('time-a','time-world-b');
  await db.apiConfigs.add({id:'time-api',name:'模拟',provider:'openai-compatible',baseUrl:'https://real-time.test/v1',model:'mock',enabled:true,isDefault:true,temperature:.7,maxTokens:100,createdAt:1,updatedAt:1});
  await db.apiCredentials.add({configId:'time-api',apiKey:'synthetic-fixture-only'});await usePhone.getState().reload();return {a:a.id,b:b.id,wa:wa.id,wb:wb.id};
 });
}

test('默认关闭、按聊天独立保存、刷新保留，真实请求随开关动态包含日期分钟与设备时区',async({page})=>{
 const ids=await seed(page);await page.clock.setFixedTime(now);
 const requests:any[]=[];await page.route('https://real-time.test/**',async r=>{requests.push(r.request().postDataJSON());await r.fulfill({json:{choices:[{message:{content:'模拟回复'}}]}});});
 const open=async()=>{await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'时间角色 开始 / 继续聊天'}).click();};
 await open();await page.getByRole('button',{name:'会话管理',exact:true}).click();
 const toggle=page.getByRole('switch',{name:'跟随真实时间',exact:true});await expect(toggle).not.toBeChecked();await toggle.click();await expect(toggle).toBeChecked();
 expect(await page.evaluate(async ids=>{const {db}=await import('/src/store.ts');return Promise.all([ids.a,ids.b,ids.wa,ids.wb].map(async id=>(await db.conversations.get(id))?.chatSettings?.followRealTime??false));},ids)).toEqual([true,false,false,false]);
 await page.reload();await expect(page.locator('.desktop')).toBeVisible();await open();await page.getByRole('button',{name:'会话管理',exact:true}).click();await expect(toggle).toBeChecked();await page.getByRole('button',{name:'返回聊天',exact:true}).click();
 await page.getByLabel('聊天消息',{exact:true}).fill('首次请求');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.chat-history')).toContainText('模拟回复');
 const timed=requests[0].messages.filter((m:any)=>m.content.includes('[真实时间上下文]'));expect(timed).toHaveLength(1);expect(timed[0].role).toBe('system');expect(timed[0].content).toContain('2026-11-03 20:34');expect(timed[0].content).toContain('Asia/Shanghai');
 await page.getByRole('button',{name:'会话管理',exact:true}).click();await toggle.click();await expect(toggle).not.toBeChecked();await page.getByRole('button',{name:'返回聊天',exact:true}).click();
 await page.getByLabel('聊天消息',{exact:true}).fill('关闭后请求');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>requests.length).toBe(2);await expect(page.getByRole('button',{name:'取消请求',exact:true})).toHaveCount(0);
 expect(JSON.stringify(requests[1].messages)).not.toContain('[真实时间上下文]');
 expect(await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return [(await db.characters.get('time-a'))!.persona,db.verno];})).toEqual(['保持原始设定',6]);
});

test('原始时间戳、明确的本轮前间隔与无效时间安全降级，不读取版本生成时间',async({page})=>{
 await seed(page);
 const result=await page.evaluate(async now=>{
  const {realTimeContext}=await import('/src/realTimeContext.ts');
  const m=(id:string,role:'user'|'assistant',createdAt:number)=>({id,conversationId:'c',role,content:'不应进入时间上下文的正文',createdAt});
  const previous=m('a','assistant',now-7200000),first=m('u1','user',now-600000),last=m('u2','user',now-300000);
  return {valid:realTimeContext('c',[previous,first,last],now,'Asia/Shanghai')!.content,empty:realTimeContext('c',[],now,'Asia/Shanghai')!.content,
   invalid:[NaN,0,-1,Infinity,now+60000].map(t=>realTimeContext('c',[m('x','user',t)],now,'Asia/Shanghai')!.content),
   foreign:realTimeContext('c',[{...last,conversationId:'other'}],now,'Asia/Shanghai')!.content};
 },now);
 expect(result.valid).toContain('上次有效互动（本轮用户消息之前，原始发送时间）：2026-11-03 18:34');expect(result.valid).toContain('距离上次互动：120分钟');expect(result.valid).not.toContain('5分钟');expect(result.valid).not.toContain('110分钟');expect(result.valid).not.toContain('不应进入');
 for(const content of [result.empty,result.foreign,...result.invalid]){expect(content).not.toContain('上次有效互动（');expect(content).not.toContain('距离上次互动：');}
});

test('Daily/World及真实分支切换只采用当前有效路径；历史回复重新生成不重置原始发送时间',async({page})=>{
 const ids=await seed(page);await page.clock.setFixedTime(now);
 const data=await page.evaluate(async({ids,now})=>{
  const {db}=await import('/src/store.ts');const {saveChatSettings}=await import('/src/chatPreferences.ts');const {buildContext}=await import('/src/chatContext.ts');const {getCurrentTimeline,switchTimeline}=await import('/src/timelines.ts');const {editMessage,addGeneratedVariant}=await import('/src/messageOperations.ts');
  for(const [id,minutes] of [[ids.a,60],[ids.wa,120],[ids.wb,180]] as const){await saveChatSettings(id,{followRealTime:true});await db.messages.bulkAdd([{id:id+'u',conversationId:id,role:'user',content:'首条',createdAt:now-(minutes+1)*60000},{id:id+'a',conversationId:id,role:'assistant',content:'原始回复',createdAt:now-minutes*60000}]);}
  const context=async(id:string,before?:string)=>(await buildContext((await db.conversations.get(id))!,before)).find(m=>m.content.includes('[真实时间上下文]'))!.content;
  const daily=await context(ids.a),wa=await context(ids.wa),wb=await context(ids.wb);
  const root=await getCurrentTimeline(ids.a);await editMessage(ids.a,ids.a+'u','修改历史',true);
  const child=await context(ids.a);await switchTimeline(ids.a,root.id);const restored=await context(ids.a);
  // A newer selected variant keeps the original Message.createdAt.
  const original=(await db.messages.get(ids.wa+'a'))!;await addGeneratedVariant(original,'新版本');
  return {daily,wa,wb,child,restored,regenerated:await context(ids.wa),historical:await context(ids.wa,ids.wa+'a')};
 },{ids,now});
 expect(data.daily).toContain('距离上次互动：60分钟');expect(data.wa).toContain('距离上次互动：120分钟');expect(data.wb).toContain('距离上次互动：180分钟');
 expect(data.child).not.toContain('距离上次互动：');expect(data.restored).toBe(data.daily);expect(data.regenerated).toBe(data.wa);expect(data.historical).not.toContain('距离上次互动：');
});

test('会话设置通过现有备份与候选恢复保留，不修改正式库和数据库结构',async({page})=>{
 const ids=await seed(page);const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{followRealTime:true,continuousSend:true});
  const {createBackup,readBackup}=await import('/src/backupService.ts');const exported=await createBackup({closedOtherClients:true});
  try{
   const m=exported.manifest,files=[new File([JSON.stringify(m)],m.backupId+'.manifest.json')];for(const part of m.parts)files.push(new File([await exported.readPart(part.index)],part.name));
   const restored=await readBackup(files,{mode:'rehearse'});
   try{const D=Object.getPrototypeOf(db.constructor),candidate=new D(restored.report.candidateName!);candidate.version(6).stores(Object.fromEntries(db.tables.map(t=>[t.name,[t.schema.primKey.src,...t.schema.indexes.map(i=>i.src)].join(',')])));await candidate.open();try{return {copy:(await candidate.table('conversations').get(id)).chatSettings,original:(await db.conversations.get(id))!.chatSettings,version:db.verno,tables:db.tables.length,status:restored.report.status};}finally{candidate.close();}}
   finally{await restored.dispose();}
  }finally{await exported.dispose();}
 },ids.a);
 expect(result.copy).toEqual(result.original);expect(result.copy).toMatchObject({followRealTime:true,continuousSend:true});expect(result.version).toBe(6);expect(result.tables).toBe(18);expect(result.status).toBe('rehearsed');
});

test('Gemini系统指令同时保留角色资料和独立时间区块，每次请求重新读取时钟',async({page})=>{
 const ids=await seed(page);await page.clock.setFixedTime(now);
 const generate=async()=>page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{followRealTime:true});
  const context=await(await import('/src/chatContext.ts')).buildContext((await db.conversations.get(id))!);
  const config={...(await db.apiConfigs.get('time-api'))!,provider:'gemini' as const,baseUrl:'https://gemini-fixture.test/v1beta'};
  let body:any;
  await(await import('/src/chatProvider.ts')).requestReply(config,'synthetic-fixture-only',context,new AbortController().signal,{send:async(_url,init)=>{body=JSON.parse(init!.body as string);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'模拟回复'}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});}});
  return body;
 },ids.a);
 const first=await generate();expect(first.systemInstruction.parts[0].text).toContain('角色：时间角色');expect(first.systemInstruction.parts[0].text).toContain('[真实时间上下文]');expect(first.systemInstruction.parts[0].text).toContain('2026-11-03 20:34');
 await page.clock.setFixedTime(now+60000);const second=await generate();expect(second.systemInstruction.parts[0].text).toContain('2026-11-03 20:35');
});

test('跨夜/页面后台停留：本轮消息先保存，08:00请求仍使用昨晚23:00互动及540分钟间隔',async({page})=>{
 const ids=await seed(page),night=Date.parse('2026-11-03T15:00:00Z'),morning=Date.parse('2026-11-04T00:00:00Z');
 await page.clock.setFixedTime(night);
 await page.evaluate(async({id,night})=>{
  const {db}=await import('/src/store.ts');await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{followRealTime:true});
  await db.messages.bulkAdd([{id:'night-u',conversationId:id,role:'user',content:'晚安',createdAt:night-60000},{id:'night-a',conversationId:id,role:'assistant',content:'晚安回复',createdAt:night}]);
 },{id:ids.a,night});
 await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'时间角色 开始 / 继续聊天'}).click();
 // Keep the same mounted page; advance wall time without reloading the app or module.
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.setFixedTime(morning);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 let request:any;await page.route('https://real-time.test/**',async r=>{request=r.request().postDataJSON();await r.fulfill({json:{choices:[{message:{content:'模拟早安回复'}}]}});});
 await page.getByLabel('聊天消息',{exact:true}).fill('早上好');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.chat-history')).toContainText('模拟早安回复');
 const system=request.messages.find((m:any)=>m.content.includes('[真实时间上下文]')).content;
 expect(system).toContain('当前现实日期与时间（精确到分钟）：2026-11-04 08:00');
 expect(system).toContain('上次有效互动（本轮用户消息之前，原始发送时间）：2026-11-03 23:00');
 expect(system).toContain('距离上次互动：540分钟');expect(system).not.toContain('距离上次互动：0分钟');
 const saved=await page.evaluate(async id=>(await(await import('/src/messagePath.ts')).activeMessages(id)).find(m=>m.content==='早上好')?.createdAt,ids.a);expect(saved).toBe(morning);
});

test('连续发送与延迟生成排除整组本轮消息，间隔使用请求时间；首次聊天/不可靠前次时间不猜测',async({page})=>{
 const ids=await seed(page),night=Date.parse('2026-11-03T15:00:00Z'),morning=Date.parse('2026-11-04T00:00:00Z');
 await page.clock.setFixedTime(night);
 await page.evaluate(async({id,night})=>{
  const {db}=await import('/src/store.ts');await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{followRealTime:true,continuousSend:true});
  await db.messages.bulkAdd([{id:'batch-old-u',conversationId:id,role:'user',content:'旧用户消息',createdAt:night-60000},{id:'batch-old-a',conversationId:id,role:'assistant',content:'上次互动',createdAt:night}]);
 },{id:ids.a,night});
 for(let i=0;i<3;i++){
  await page.clock.setFixedTime(morning+i*60000);
  await page.evaluate(async({id,i})=>{await(await import('/src/chatService.ts')).queueUserMessage(id,`本轮第${i+1}条`);},{id:ids.a,i});
 }
 await page.clock.setFixedTime(morning+10*60000);
 const context=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');return(await(await import('/src/chatContext.ts')).buildContext((await db.conversations.get(id))!))[0].content;},ids.a);
 expect(context).toContain('2026-11-04 08:10');expect(context).toContain('原始发送时间）：2026-11-03 23:00');expect(context).toContain('距离上次互动：550分钟');
 const missing=await page.evaluate(async now=>{
  const {realTimeContext}=await import('/src/realTimeContext.ts');
  const u={id:'u',conversationId:'c',role:'user' as const,content:'本轮',createdAt:now};
  return [realTimeContext('c',[u],now)!.content,realTimeContext('c',[{...u,id:'a',role:'assistant',createdAt:NaN},u],now)!.content];
 },morning+10*60000);
 for(const text of missing){expect(text).not.toContain('距离上次互动：');expect(text).not.toContain('上次有效互动（');}
});

test('17:40现实问时优先设备时间；时段阈值、跨日、明确继续意图及剧本时间边界',async({page})=>{
 await seed(page);
 const data=await page.evaluate(async()=>{
  const {realTimeContext}=await import('/src/realTimeContext.ts');
  const current=Date.parse('2026-11-04T09:40:00Z');
  const make=(delta:number,mode:'daily'|'world'='daily',at=current)=>realTimeContext('c',[{id:'a',conversationId:'c',role:'assistant',content:'昨晚餐厅的菜单',createdAt:at-delta},{id:'u',conversationId:'c',role:'user',content:'普通新消息',createdAt:at}],at,'Asia/Shanghai',mode)!.content;
  return {clock:make(29*60000),at30:make(30*60000),under4:make(4*3600000-1),at4:make(4*3600000),night:make(9*3600000,'daily',Date.parse('2026-11-04T00:00:00Z')),midnight:make(5*60000,'daily',Date.parse('2026-11-03T16:02:00Z')),world:make(9*3600000,'world')};
 });
 expect(data.clock).toContain('2026-11-04 17:40');expect(data.clock).toContain('星期三，傍晚');expect(data.clock).toContain('优先使用本上下文的设备日期');expect(data.clock).toContain('[连续对话提示]');
 for(const text of [data.clock,data.at30,data.under4,data.midnight])expect(text).not.toContain('[新交流时段提示]');
 expect(data.at30).not.toContain('[连续对话提示]');expect(data.at4).toContain('[新交流时段提示]');
 expect(data.night).toContain('2026-11-04 08:00');expect(data.night).toContain('2026-11-03 23:00');expect(data.night).toContain('540分钟');expect(data.night).toContain('不要默认双方仍停留在上轮场景');expect(data.night).toContain('不得编造间隔期间');expect(data.night).toContain('[日期变化提示]');
 expect(data.midnight).toContain('不能仅凭跨零点强制切换场景');
 for(const text of Object.values(data))expect(text).toContain('优先尊重用户意图，不因时间间隔强制切换场景');
 expect(data.world).toContain('[剧本时间边界]');expect(data.world).toContain('剧本时间推进仅以剧情内容和用户指令为准');expect(data.world).not.toContain('[新交流时段提示]');
});

const sessionCases=[
 {name:'A 跨夜早安',hours:9,text:'早上好',mode:'daily',enabled:true,transition:true},
 {name:'B 六小时后晚间问候',hours:6,text:'晚上好呀',mode:'daily',enabled:true,transition:true},
 {name:'C 十分钟继续点餐',hours:1/6,text:'那我要吃糖醋里脊',mode:'daily',enabled:true,transition:false},
 {name:'D 八小时后明确续写',hours:8,text:'接着刚才在餐厅的剧情',mode:'daily',enabled:true,transition:false},
 {name:'E 世界聊天十二小时',hours:12,text:'晚上好呀',mode:'world',enabled:true,transition:false},
 {name:'F 关闭真实时间',hours:9,text:'早上好',mode:'daily',enabled:false,transition:false},
] as const;
for(const provider of ['openai-compatible','gemini'] as const)for(const scenario of sessionCases)test(`实际请求时段边界：${provider} / ${scenario.name}`,async({page})=>{
 const ids=await seed(page),id=scenario.mode==='world'?ids.wa:ids.a;
 const current=Date.parse(scenario.name.startsWith('A')?'2026-11-04T00:00:00Z':'2026-11-04T12:00:00Z'),previous=current-scenario.hours*3600000;
 await page.clock.setFixedTime(current);
 await page.evaluate(async({id,previous,enabled,provider})=>{
  const {db}=await import('/src/store.ts');await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{followRealTime:enabled});
  await db.apiConfigs.update('time-api',{provider,baseUrl:provider==='gemini'?'https://real-time.test/v1beta':'https://real-time.test/v1'});
  await db.messages.bulkAdd([{id:'session-old-user',conversationId:id,role:'user',content:'之前我们在餐厅吃饭',createdAt:previous-60000},{id:'session-old-assistant',conversationId:id,role:'assistant',content:'我拿着菜单，正准备替你点菜。',createdAt:previous}]);
 },{id,previous,enabled:scenario.enabled,provider});
 const requests:any[]=[];await page.route('https://real-time.test/**',async r=>{requests.push(r.request().postDataJSON());await r.fulfill({json:provider==='gemini'?{candidates:[{content:{parts:[{text:'模拟回复'}]}}]}:{choices:[{message:{content:'模拟回复'}}]}});});
 await page.evaluate(async({id,text})=>{await(await import('/src/chatService.ts')).sendMessage(id,text,new AbortController().signal);},{id,text:scenario.text});
 expect(requests).toHaveLength(1);const body=requests[0];
 const system=provider==='gemini'?body.systemInstruction.parts[0].text:body.messages[0].content;
 const turns=provider==='gemini'?body.contents.flatMap((m:any)=>m.parts.map((p:any)=>({role:m.role,content:p.text}))):body.messages.slice(1);
 const menu=turns.find((m:any)=>m.content.includes('我拿着菜单')),currentTurn=turns.find((m:any)=>m.content.includes(scenario.text));
 expect(system).toContain('保持原始设定');expect(menu).toBeTruthy();expect(currentTurn).toBeTruthy();
 if(scenario.transition){
  expect(system).toContain('当前对话时段：新的现实交流时段');expect(system).toContain('事件属于共同历史，不是当前正在发生的现场');expect(system).toContain('不机械延续旧地点、姿势、物品、动作或未完成的现场情节');expect(system).toContain('不得强行解释成用户在旧场景里假装刚见面');expect(system).toContain('不得编造间隔期间');
  expect(menu.content).toBe('[过去交流时段的最后记录：以下动作属于过去，不是当前正在发生的动作]\n\n我拿着菜单，正准备替你点菜。');
  expect(currentTurn.content).toBe('[当前交流时段起点：不自动延续旧现场，以此后的用户消息开始当前交流]\n\n'+scenario.text);
  expect(turns.indexOf(menu)).toBeLessThan(turns.indexOf(currentTurn));
  if(scenario.name.startsWith('A')){expect(system).toContain('2026-11-04 08:00');expect(system).toContain('2026-11-03 23:00');expect(system).toContain('540分钟');}
 }else{
  expect(system).not.toContain('[新交流时段提示]');expect(menu.content).toBe('我拿着菜单，正准备替你点菜。');expect(currentTurn.content).toBe(scenario.text);
  if(scenario.name.startsWith('C'))expect(system).toContain('[连续对话提示]');
  if(scenario.name.startsWith('D'))expect(system).toContain('[当前对话时段：延续旧场景]');
  if(scenario.mode==='world')expect(system).toContain('[剧本时间边界]');
  if(!scenario.enabled)expect(system).not.toContain('[真实时间上下文]');
 }
 const stored=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');const rows=await(await import('/src/messagePath.ts')).activeMessages(id);return {old:(await db.messages.get('session-old-assistant'))!,user:rows.filter(m=>m.role==='user').at(-1)!,count:rows.length};},id);
 expect(stored.old.content).toBe('我拿着菜单，正准备替你点菜。');expect(stored.old.createdAt).toBe(previous);expect(stored.user.content).toBe(scenario.text);expect(stored.count).toBe(4);
});

for(const scenario of [
 {name:'30分钟问候优先新时段',minutes:30,text:'晚上好呀',transition:true},
 {name:'不足30分钟问候不切换',minutes:29,text:'晚上好呀',transition:false},
 {name:'两小时普通点餐仍连续',minutes:120,text:'那我要吃糖醋里脊',transition:false},
 {name:'问候与续写并存尊重续写',minutes:360,text:'我回来了，继续刚才的剧情',transition:false},
 {name:'不可靠未来时间不切换',minutes:-60,text:'晚上好呀',transition:false},
])test(`实际请求信号与可靠性：${scenario.name}`,async({page})=>{
 const ids=await seed(page),current=Date.parse('2026-11-04T12:00Z');await page.clock.setFixedTime(current);
 await page.evaluate(async({id,current,minutes})=>{const {db}=await import('/src/store.ts');await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{followRealTime:true});await db.messages.bulkAdd([{id:'signal-u',conversationId:id,role:'user',content:'旧消息',createdAt:current-minutes*60000-1000},{id:'signal-a',conversationId:id,role:'assistant',content:'旧现场',createdAt:current-minutes*60000}]);},{id:ids.a,current,minutes:scenario.minutes});
 let body:any;await page.route('https://real-time.test/**',async r=>{body=r.request().postDataJSON();await r.fulfill({json:{choices:[{message:{content:'模拟回复'}}]}});});
 await page.evaluate(async({id,text})=>{await(await import('/src/chatService.ts')).sendMessage(id,text,new AbortController().signal);},{id:ids.a,text:scenario.text});
 expect(body.messages[0].content.includes('[新交流时段提示]')).toBe(scenario.transition);
 expect(body.messages.some((m:any)=>m.content.startsWith('[当前交流时段起点'))).toBe(scenario.transition);
 if(scenario.minutes<0)expect(body.messages[0].content).not.toContain('距离上次互动：');
});
