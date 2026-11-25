import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('long automatic job yields to another ready task before its next request',async({page})=>{
 await isolatedApp(page,'automation-fair-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {enqueueAutomation}=await import('/src/automationQueue.ts');
  const order:string[]=[];let release!:()=>void;
  const gate=new Promise<void>(r=>release=r);
  const a=enqueueAutomation('audit-long',async()=>{order.push('long');await gate;order.push('end')});
  await new Promise(r=>setTimeout(r,100));
  const b=enqueueAutomation('audit-short',async()=>{order.push('short')});
  await new Promise(r=>setTimeout(r,150));
  const before=order.slice();release();await Promise.all([a,b]);return before;
 });
 expect(result).toContain('short');
});
test('proactive probability or failure anchor becomes eligible in the next interval',async({page})=>{
 await isolatedApp(page,'automation-period-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {proactiveEligible}=await import('/src/proactiveMessages.ts');
  const now=Date.now(),anchor=now-6*3600000;
  return proactiveEligible({id:'a',mode:'daily',characterId:'a',createdAt:anchor,updatedAt:anchor,scopeKey:'a',chatSettings:{proactiveEnabled:true,proactiveHours:3,proactiveAttemptFor:anchor}},0,now);
 });
 expect(result).toBe(true);
});

for(const independent of [false,true])test(`${independent?'dual':'single'} API: foreground chat wins; dedicated transport can run concurrently`,async({page})=>{
 await isolatedApp(page,'automation-priority-'+crypto.randomUUID());
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),start=new Promise<void>(r=>entered=r);let autos=0;
 await page.route('https://audit.test/**',async r=>{const body=r.request().postDataJSON();if(body.messages[0].content==='foreground'){entered();await gate;}else autos++;return r.fulfill({json:{choices:[{message:{content:'完成'},finish_reason:'stop'}]}})});
 await page.evaluate(async independent=>{
  const config:any={id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:1000,temperature:0,enabled:true};
  const foreground=await import('/src/chatProvider.ts'),automatic=await import('/src/automationRequests.ts');
  (window as any).__foreground=foreground.requestReply(config,'synthetic',[{role:'user',content:'foreground'}],new AbortController().signal);
  (window as any).__config=config;(window as any).__independent=independent;(window as any).__automatic=automatic;
 },independent);
 await start;
 await page.evaluate(()=>{const w=window as any;w.__auto=w.__automatic.requestAutomationReply(w.__config,w.__independent?'different-synthetic':'synthetic',[{role:'user',content:'automatic'}],new AbortController().signal)});
 await page.waitForTimeout(650);expect(autos).toBe(independent?1:0);release();
 await page.evaluate(async()=>{await Promise.all([(window as any).__foreground,(window as any).__auto])});expect(autos).toBe(1);
});
test('every chunk rechecks busy shared transport; FIFO automatic requests alternate',async({page})=>{
 await isolatedApp(page,'automation-each-request-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {requestAutomationReply}=await import('/src/automationRequests.ts');
  const {trackForeground}=await import('/src/automationActivity.ts');
  const c:any={id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://never-sent.test/v1',model:'fixture',maxTokens:1000,temperature:0,enabled:true};
  const order:string[]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  const transport={send:async(_u:string,init:any)=>{const label=JSON.parse(init.body).messages[0].content;order.push(label);if(label==='a1')await gate;return new Response(JSON.stringify({choices:[{message:{content:'有效正文'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})}};
  const request=(label:string)=>requestAutomationReply(c,'synthetic',[{role:'user',content:label}],new AbortController().signal,transport);
  const first=(async()=>{await request('a1');await request('a2')})();
  await new Promise(r=>setTimeout(r,50));const second=request('b1');release();await Promise.all([first,second]);
  const busy=trackForeground(c,'synthetic');const third=request('a3');await new Promise(r=>setTimeout(r,600));const before=order.slice();busy();await third;return {before,order};
 });
 expect(result.before).toEqual(['a1','b1','a2']);expect(result.order).toEqual(['a1','b1','a2','a3']);
});
test('offline requests wait, cancelled waiting requests never reach API',async({page})=>{
 await isolatedApp(page,'automation-offline-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {requestAutomationReply}=await import('/src/automationRequests.ts');const config:any={id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:1000,temperature:0,enabled:true};
  Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});let calls=0;const controller=new AbortController();const task=requestAutomationReply(config,'synthetic',[{role:'user',content:'不应请求'}],controller.signal,{send:async()=>{calls++;throw Error('must not call')}}).catch(()=>null);await new Promise(r=>setTimeout(r,50));controller.abort();await task;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});return calls;
 });expect(result).toBe(0);
});
test('1185 rounds are continuously digested into interval receipts without another player message',async({page})=>{
 test.setTimeout(180000);await isolatedApp(page,'automation-backlog-'+crypto.randomUUID());let calls=0;const sourceIndexes:number[]=[];let primaryCalls=0,coreCalls=0;const started=Date.now();
 await page.route('https://audit.test/**',r=>{calls++;const request=r.request(),body=request.postDataJSON();expect(request.method()).toBe('POST');expect(request.url()).toBe('https://audit.test/v1/chat/completions');expect(request.headers().authorization).toBe('Bearer synthetic');expect(body.model).toBe('mock');expect(body.max_tokens).toBe(3000);const input=JSON.parse(body.messages[1].content);let content:string;
 if(Array.isArray(input)){primaryCalls++;for(const m of input.flat())if(m.role==='user')sourceIndexes.push(Number(m.content.match(/款式(\d+)/)?.[1]));let fact:any;for(let i=0;i<input.length&&!fact;i++)for(const m of input[i])if(m.role==='user'){const quote=m.content.replace(/。$/,'');fact={type:'fact',kind:'long',content:'用户'+quote.replace(/^我/,''),evidence:[{turn:i+1,role:'user',quote}]};break;}content=JSON.stringify({memories:fact?[fact]:[]});}else{coreCalls++;content='角色拥有已经确认的长期偏好，后续互动应保持事实连续。';}
 return r.fulfill({json:{choices:[{message:{content},finish_reason:'stop'}]}})});
 const id=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'backlog',name:'历史角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('backlog');
  await db.messages.bulkPut(Array.from({length:2370},(_,i)=>({id:'history-'+i,conversationId:c.id,role:i%2?'assistant':'user',content:i%2?'我记下了。':'我长期喜欢茶杯款式'+Math.floor(i/2)+'。',createdAt:i+1})));
  const config:any={id:'api',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:3000,temperature:0,enabled:true,isDefault:true,createdAt:1,updatedAt:1};await db.apiConfigs.put(config);await db.apiCredentials.put({configId:config.id,apiKey:'synthetic'});
  const memory=await import('/src/memorySummary.ts'),scope=await(await import('/src/memoryStore.ts')).getMemoryScope(c.id);await memory.saveSummarySettings(scope,true,100);return c.id;
 });
 await page.reload();
 await expect.poll(()=>page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.memorySummary?.receipts.length,id),{timeout:150000}).toBe(11);
 const result=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');const scope=await(await import('/src/memoryStore.ts')).getMemoryScope(id);const status=await(await import('/src/memorySummary.ts')).summaryStatus(scope);return {entries:(await(await import('/src/memoryStore.ts')).listMemories(scope)).entries.length,pending:status.pending,messages:await db.messages.count(),long:(await(await import('/src/memoryStore.ts')).listMemories(scope,'long')).entries.length,core:(await(await import('/src/memoryStore.ts')).listMemories(scope,'core')).entries.length,receiptAssistants:(await db.conversations.get(id))?.memorySummary?.receipts.flatMap(r=>r.turns.map(t=>t.assistantId)),all:(await db.conversations.get(id))?.memorySummary?.receipts.every(r=>r.turns.length===100)}},id);
 expect(result.entries).toBe(68);expect(result.long).toBe(66);expect(result.core).toBe(2);expect(primaryCalls).toBe(66);expect(coreCalls).toBe(2);expect(calls).toBe(68);expect(sourceIndexes.sort((a,b)=>a-b)).toEqual(Array.from({length:1100},(_,i)=>i));expect(result.receiptAssistants).toEqual(Array.from({length:1100},(_,i)=>'history-'+(i*2+1)));expect(result.pending).toBe(85);expect(result.messages).toBe(2370);expect(result.all).toBe(true);expect(calls).toBeGreaterThanOrEqual(11);console.log('BACKLOG1185',JSON.stringify({entries:result.entries,long:result.long,core:result.core,pending:result.pending,messages:result.messages,calls,elapsed:Date.now()-started,all:result.all}));
 const paid=calls;await page.evaluate(async id=>{const m=await import('/src/memoryStore.ts');const scope=await m.getMemoryScope(id);const core=(await m.listMemories(scope,'core')).entries[0];if(!core)throw Error('missing core');await m.deleteMemory(scope,core.id,core.revision);await(await import('/src/memoryCoreBuilder.ts')).maybeBuildCoreMemory(scope);},id);expect(calls).toBe(paid);
});
test('unsupported facts never bypass source checks; mixed candidates retain verified facts',async({page})=>{
 await isolatedApp(page,'automation-source-'+crypto.randomUUID());const result=await page.evaluate(async()=>{
  const {reviewIntervalSummary}=await import('/src/memorySummaryPlan.ts');const input=JSON.stringify([[{role:'user',content:'我不想结婚。'},{role:'assistant',content:'我记得你的态度。'}]]);
  let bad='';try{reviewIntervalSummary(JSON.stringify({memories:[{content:'用户已经结婚并生了孩子。'}]}),input)}catch(e){bad=(e as any).diagnostic?.code}
  const mixed=reviewIntervalSummary(JSON.stringify({memories:[{content:'用户不想结婚。'},{content:'用户已经结婚并生了孩子。'}]}),input);return {bad,valid:mixed.facts.map(f=>f.content),evidence:mixed.facts[0]?.quality?.evidence};
 });expect(result.bad).toBe('invalid-quality');expect(result.valid).toEqual(['用户不想结婚。']);expect(result.evidence?.[0].role).toBe('user');
});
test('automatic dreams have independent schedule and do not consume diary cursor',async({page})=>{
 await isolatedApp(page,'automation-dream-'+crypto.randomUUID());let calls=0;
 await page.route('https://audit.test/**',r=>{calls++;return r.fulfill({json:{choices:[{message:{content:JSON.stringify({title:'独立梦境',body:'这是梦中的虚构场景，不是玩家实际经历。'.repeat(12)})},finish_reason:'stop'}]}})});
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'dream',name:'梦境角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('dream');await db.apiConfigs.put({id:'api',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:3000,temperature:0,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'api',apiKey:'synthetic'});
  const a=await import('/src/privateNotesArchive.ts'),g=await import('/src/privateNotesGeneration.ts');await a.saveNoteSchedule({mode:'interval',intervalMinutes:60,dreamEnabled:true});await a.appendPrivateNote('dream',{id:'old',characterId:'dream',kind:'日记',createdAt:Date.now(),sourceLastMessageAt:777,title:'旧日记',body:'保留',comments:[]});
  const first=await g.generatePrivateNote('dream',false,'梦境'),again=await g.generatePrivateNote('dream',false,'梦境');return {kind:first?.kind,again,notes:await g.loadNotes('dream'),c:c.id};
 });expect(result.kind).toBe('梦境');expect(result.again).toBeNull();expect(result.notes.find(n=>n.id==='old')?.sourceLastMessageAt).toBe(777);expect(calls).toBe(1);
});

test('two tabs fallback lease serializes paid requests without Web Locks',async({page,context})=>{
 const name='automation-tabs-'+crypto.randomUUID();await isolatedApp(page,name);const second=await context.newPage();await isolatedApp(second,name);let active=0,max=0,calls=0;
 await context.route('https://audit.test/**',async r=>{calls++;active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,100));active--;return r.fulfill({json:{choices:[{message:{content:'已完成'},finish_reason:'stop'}]}})});
 const request=async(target:typeof page)=>target.evaluate(async()=>{
  Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});const {requestAutomationReply}=await import('/src/automationRequests.ts');return requestAutomationReply({id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:1000,temperature:0,enabled:true,isDefault:false,createdAt:1,updatedAt:1},'synthetic',[{role:'user',content:'独立任务'}],new AbortController().signal);
 });await Promise.all([request(page),request(second)]);expect(calls).toBe(2);expect(max).toBe(1);expect(await page.evaluate(async()=>(await import('/src/store.ts')).db.summaryLeases.count())).toBe(0);await second.close();
});
test('queued stale source is checked again immediately before a paid request',async({page})=>{
 await isolatedApp(page,'automation-preflight-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {requestAutomationReply,setAutomationPreflight}=await import('/src/automationRequests.ts');const {trackForeground}=await import('/src/automationActivity.ts');const config:any={id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:1000,temperature:0,enabled:true};
  const release=trackForeground(config,'synthetic'),controller=new AbortController();let calls=0,valid=true;setAutomationPreflight(controller.signal,async()=>{if(!valid)throw Error('stale source')});
  const pending=requestAutomationReply(config,'synthetic',[{role:'user',content:'已过期原文'}],controller.signal,{send:async()=>{calls++;throw Error('must not send')}}).catch(e=>e.message);await new Promise(r=>setTimeout(r,80));valid=false;release();return {error:await pending,calls};
 });expect(result).toEqual({error:'stale source',calls:0});
});
test('same task class cannot occupy all orchestration slots',async({page})=>{
 await isolatedApp(page,'automation-class-fair-'+crypto.randomUUID());const r=await page.evaluate(async()=>{
  const {enqueueAutomation}=await import('/src/automationQueue.ts');let release!:()=>void;const gate=new Promise<void>(r=>release=r);const started:string[]=[];
  const tasks=Array.from({length:8},(_,i)=>enqueueAutomation('summary:'+i,async()=>{started.push('summary');await gate}));await new Promise(r=>setTimeout(r,80));const short=enqueueAutomation('social:ready',async()=>{started.push('social')});await new Promise(r=>setTimeout(r,100));const before=started.slice();release();await Promise.all([...tasks,short]);return before;
 });expect(r).toContain('social');expect(r.filter(v=>v==='summary').length).toBeLessThanOrEqual(2);
});
test('late private-note owner cannot write after a replacement lease',async({page})=>{
 await isolatedApp(page,'automation-private-fence-'+crypto.randomUUID());const r=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts'),{withPrivateNotesTask}=await import('/src/privateNotesArchive.ts');let release!:()=>void,started!:()=>void;const entered=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);let writes=0;
  const old=withPrivateNotesTask('owner',false,'',async check=>{started();await gate;await check();writes++}).catch(e=>e.message);await entered;const row=await db.themes.get('private-notes-task:owner') as any;row.privateNotesTask.until=0;await db.themes.put(row);await withPrivateNotesTask('owner',false,'',async check=>{await check();writes++});release();return {error:await old,writes};
 });expect(r.writes).toBe(1);expect(r.error).toContain('过期');
});
test('independent notes scheduler works outside notes and without enabled life; persisted status survives refresh',async({page})=>{
 await isolatedApp(page,'automation-independent-notes-'+crypto.randomUUID());let calls=0;
 await page.route('https://audit.test/**',r=>{calls++;return r.fulfill({json:{choices:[{message:{content:JSON.stringify({title:'独立自动日记',body:'独处的感想和未完成的心事，不把想象冒充玩家经历。'.repeat(12)})},finish_reason:'stop'}]}})});
 await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'independent',name:'角色',persona:''});await(await import('/src/chatService.ts')).getConversation('independent');await db.apiConfigs.put({id:'api',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:3000,temperature:0,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'api',apiKey:'synthetic'});
  const a=await import('/src/privateNotesArchive.ts');await a.saveNoteSchedule({mode:'interval',intervalMinutes:60});await a.appendPrivateNote('independent',{id:'old',characterId:'independent',kind:'日记',createdAt:Date.now()-7200000,title:'旧日记',body:'保留',comments:[],sourceLastMessageAt:0});(window as any).__stopNotes=(await import('/src/privateNotesScheduler.ts')).installPrivateNotesScheduler();
 });await expect.poll(()=>page.evaluate(async()=>(await(await import('/src/privateNotesGeneration.ts')).loadNotes('independent')).length)).toBe(2);await page.evaluate(()=>(window as any).__stopNotes());await page.reload();expect(await page.evaluate(async()=>(await(await import('/src/privateNotesGeneration.ts')).loadNotes('independent')).length)).toBe(2);expect(calls).toBe(1);
});
for(const count of [1000,10000,30000])test(`deadline lookup ${count} messages: indexed tail vs original full path`,async({page})=>{
 await isolatedApp(page,'automation-performance-'+count+'-'+crypto.randomUUID());const r=await page.evaluate(async count=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'perf',name:'角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('perf');await db.messages.bulkPut(Array.from({length:count},(_,i)=>({id:'p'+i,conversationId:c.id,role:i%2?'assistant':'user',content:'历史内容。'.repeat(30),createdAt:i+1})));
  const {activeMessages}=await import('/src/messagePath.ts'),{latestProactiveUser}=await import('/src/proactiveMessages.ts');let start=performance.now();const old=[...await activeMessages(c.id)].reverse().find(m=>m.role==='user')?.createdAt;const oldMs=performance.now()-start;start=performance.now();const fresh=await latestProactiveUser(c);const newMs=performance.now()-start;return {count,oldMs,newMs,old,fresh};
 },count);expect(r.fresh).toBe(r.old);console.log('DEADLINE_PERFORMANCE',JSON.stringify(r));
});

test('sparse successful checkpoints survive ZIP and old manual flag resumes without repeating paid chunks',async({page})=>{
 await isolatedApp(page,'automation-sparse-'+crypto.randomUUID());let calls=0,fail=true;const seen:string[]=[];
 await page.route('https://audit.test/**',r=>{calls++;seen.push(r.request().postDataJSON().messages[1].content);return r.fulfill({json:fail&&calls===1?{choices:[]}:{choices:[{message:{content:'{"memories":[]}'},finish_reason:'stop'}]}})});
 const id=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'sparse',name:'角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('sparse');await db.messages.bulkPut(Array.from({length:40},(_,i)=>({id:'s'+i,conversationId:c.id,role:i%2?'assistant':'user',content:'真实的聊天内容与人物关系。'.repeat(12),createdAt:i+1})));
  await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi({provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',apiKey:'synthetic',maxTokens:3000,temperature:0,enabled:true});const scope=await(await import('/src/memoryStore.ts')).getMemoryScope(c.id),m=await import('/src/memorySummary.ts');await m.saveSummarySettings(scope,true,20);await m.runMemorySummary(scope);return c.id;
 });
 const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const c=(await db.conversations.get(id))!;const completed=c.memorySummary?.checkpoint?.completed.filter(Boolean).length??0;
  const {createZipBackup,readBackupZip}=await import('/src/backupZip.ts'),{readBackup,verifiedCandidate}=await import('/src/backupService.ts');const check=await readBackup(await readBackupZip(await createZipBackup({closedOtherClients:true})),{mode:'rehearse'});let restored=0;try{restored=(await verifiedCandidate(check)!.table('conversations').get(id)).memorySummary.checkpoint.completed.filter(Boolean).length;}finally{await check.dispose()}
  const state=c.memorySummary!;state.requiresManualResume=true;delete state.autoRecoveries;state.job!.failureKind='format';state.job!.finishedAt=Date.now()-31*60000;state.job!.startedAt=state.job!.finishedAt-1000;state.job!.leaseUntil=state.job!.finishedAt;await db.conversations.update(id,{memorySummary:state});return {completed,restored,status:state.job!.status};
 },id);expect(result.completed).toBeGreaterThan(0);expect(result.restored).toBe(result.completed);expect(result.status).toBe('failed');const before=calls;fail=false;await page.reload();await page.evaluate(async id=>{await(await import('/src/memorySummary.ts')).tryAutoSummary(id)},id);
 await expect.poll(()=>page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.memorySummary?.receipts.length,id)).toBe(1).catch(async error=>{console.log('SPARSE_DIAGNOSTIC',JSON.stringify(await page.evaluate(async id=>{const s=(await(await import('/src/store.ts')).db.conversations.get(id))?.memorySummary;return {job:s?.job,manual:s?.requiresManualResume,recoveries:s?.autoRecoveries,queue:(await import('/src/automationQueue.ts')).automationStatuses()}},id)));throw error});expect(calls-before).toBe(1);expect(seen.filter(v=>v===seen[0])).toHaveLength(2);expect(new Set(seen.slice(1,-1)).size).toBe(result.completed);
});

for(const keys of [false,true])test(`automation API and dream settings survive actual ZIP, keys=${keys}`,async({page})=>{
 await isolatedApp(page,'automation-backup-'+crypto.randomUUID());const result=await page.evaluate(async keys=>{
  const {db}=await import('/src/store.ts');const value={provider:'custom',protocol:'gemini' as const,baseUrl:'https://audit.test/v1',model:'saved-automation-model',apiKey:'synthetic-automation-key',maxTokens:3000,temperature:0.2,enabled:false};await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi(value);await(await import('/src/privateNotesArchive.ts')).saveNoteSchedule({mode:'interval',intervalMinutes:180,dreamEnabled:true});
  const {createZipBackup,readBackupZip}=await import('/src/backupZip.ts'),{readBackup,verifiedCandidate}=await import('/src/backupService.ts');const password=keys?'separate synthetic backup password':undefined;const zip=await createZipBackup({closedOtherClients:true,...(keys?{includeCredentials:true,credentialConsent:true,password}:{})});const check=await readBackup(await readBackupZip(zip,password),{mode:'rehearse',password});try{return {api:(await verifiedCandidate(check)!.table('themes').get('global')).dedicatedSummaryApi,schedule:(await verifiedCandidate(check)!.table('themes').get('private-notes-archive')).privateNotesArchive.schedule,local:(await db.themes.get('global'))?.dedicatedSummaryApi}}finally{await check.dispose()}
 },keys);expect(result.api.model).toBe('saved-automation-model');expect(result.api.protocol).toBe('gemini');expect(result.api.enabled).toBe(false);expect(result.api.apiKey).toBe(keys?'synthetic-automation-key':'');expect(result.local?.apiKey).toBe('synthetic-automation-key');expect(result.schedule).toEqual({mode:'interval',intervalMinutes:180,dreamEnabled:true});
});
for(const width of [390,430])test(`automation API UI ${width}: independent copy, shared fallback and queue status without key exposure`,async({page})=>{
 await page.setViewportSize({width,height:844});await isolatedApp(page,'automation-ui-'+crypto.randomUUID());
 await page.evaluate(async()=>{const {db,usePhone}=await import('/src/store.ts');await db.apiConfigs.put({id:'ordinary',name:'普通聊天接口',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'ordinary-model',maxTokens:1000,temperature:0,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'ordinary',apiKey:'synthetic-private-only'});await usePhone.getState().reload();usePhone.getState().set({activeApp:'AI / API 设置'});});
 const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'自动任务 API',exact:true})}).last();await panel.getByLabel('选择已添加的 API').selectOption('ordinary');await panel.getByRole('button',{name:'启用独立 API',exact:true}).click();await expect(panel).toContainText('独立接口：ordinary-model');await panel.getByRole('button',{name:'沿用聊天 API',exact:true}).click();await expect(panel).toContainText('沿用普通聊天 API');expect(await page.evaluate(async()=>(await(await import('/src/store.ts')).db.themes.get('global'))?.dedicatedSummaryApi?.apiKey)).toBe('synthetic-private-only');await expect(panel).not.toContainText('synthetic-private-only');await expect(panel).toContainText('待处理');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'/tmp/automation-api-'+width+'.png',fullPage:true});
});

test('queued old World scope cannot summarize a new branch or call API',async({page})=>{
 await isolatedApp(page,'automation-old-world-'+crypto.randomUUID());let calls=0;await page.route('https://audit.test/**',r=>{calls++;return r.abort()});
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'world-a',name:'角色',persona:''});await db.worlds.put({id:'world',name:'世界',description:'背景',rules:''});await db.worldProfiles.put({id:'profile',worldId:'world',characterId:'world-a',setting:'世界人设'});const c=await(await import('/src/chatService.ts')).getConversation('world-a','world');await db.messages.bulkPut([{id:'wu',conversationId:c.id,role:'user',content:'原分支行动',createdAt:1},{id:'wa',conversationId:c.id,role:'assistant',content:'原分支结果',createdAt:2}]);await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi({provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',apiKey:'synthetic',maxTokens:3000,temperature:0,enabled:true});
  const {getMemoryScope}=await import('/src/memoryStore.ts'),summary=await import('/src/memorySummary.ts');const old=await getMemoryScope(c.id);await summary.saveSummarySettings(old,true,1);await(await import('/src/messageOperations.ts')).editMessage(c.id,'wa','新分支结果',true);const fresh=await getMemoryScope(c.id);let error='';try{await summary.runMemorySummary(old,true)}catch(e){error=(e as Error).message}return {error,old,fresh,receipts:(await db.conversations.get(c.id))?.memorySummary?.receipts.length,job:(await db.conversations.get(c.id))?.memorySummary?.job};
 });expect(result.error).toContain('作用域');expect(result.old).not.toEqual(result.fresh);expect(result.receipts).toBe(0);expect(result.job).toBeUndefined();expect(calls).toBe(0);
});
test('shared/dedicated API resolution preserves ordinary binding and disabled credentials',async({page})=>{
 await isolatedApp(page,'automation-resolution-'+crypto.randomUUID());const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts'),{getConversation,resolveApi}=await import('/src/chatService.ts'),{saveSummaryApi,resolveAutomationApi,getSummaryApi}=await import('/src/dedicatedSummaryApi.ts');await db.characters.put({id:'api-owner',name:'角色',persona:''});const c=await getConversation('api-owner');await db.apiConfigs.put({id:'ordinary',name:'ordinary',provider:'openai-compatible',baseUrl:'https://ordinary.test/v1',model:'normal',maxTokens:1000,temperature:0,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'ordinary',apiKey:'synthetic-normal'});const initial=await resolveAutomationApi(c);const dedicated={provider:'custom',protocol:'gemini' as const,baseUrl:'https://dedicated.test/v1',model:'summary',apiKey:'synthetic-dedicated',maxTokens:3000,temperature:0,enabled:true};await saveSummaryApi(dedicated);const separate=await resolveAutomationApi(c),ordinary=await resolveApi(c),summary=await getSummaryApi(await(await import('/src/memoryStore.ts')).getMemoryScope(c.id));await saveSummaryApi({...dedicated,enabled:false});const restored=await resolveAutomationApi(c);return {initial:initial.config.model,separate:separate.config.model,protocol:separate.config.protocol,ordinary:ordinary.config.model,summary:summary.config.model,restored:restored.config.model,saved:(await db.themes.get('global'))?.dedicatedSummaryApi?.apiKey};
 });expect(result).toEqual({initial:'normal',separate:'summary',protocol:'gemini',ordinary:'normal',summary:'summary',restored:'normal',saved:'synthetic-dedicated'});
});

test('life player-source boundary accepts actual user decisions, not a new player action',async({page})=>{
 await isolatedApp(page,'automation-player-source-'+crypto.randomUUID());
 await page.route('https://audit.test/**',r=>r.fulfill({json:{choices:[{message:{content:JSON.stringify({focus:'整理行程',mood:'我不喜欢你总是熬夜，因为会担心你。',events:[{title:'记录已知约定',detail:'玩家已经决定搬家并答应了。',actor:'self'}],updates:[]})},finish_reason:'stop'}]}}));
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'actor',name:'角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('actor');await db.messages.bulkPut([{id:'decision',conversationId:c.id,role:'user',content:'我已经决定搬家并答应了。',createdAt:Date.now()-1000},{id:'ack',conversationId:c.id,role:'assistant',content:'我记得。',createdAt:Date.now()}]);await db.apiConfigs.put({id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:3000,temperature:0,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'a',apiKey:'synthetic'});return (await(await import('/src/characterLifeGeneration.ts')).runCharacterLife('actor',true))?.events;
 });expect(result).toHaveLength(1);expect(result![0].detail).toBe('玩家已经决定搬家并答应了。');
});

test('core write failure is atomic; primary receipts persist and explicit retry creates one core',async({page})=>{
 await isolatedApp(page,'automation-core-atomic-'+crypto.randomUUID());let cores=0;
 await page.route('https://audit.test/**',r=>{const input=JSON.parse(r.request().postDataJSON().messages[1].content);let content:string;if(Array.isArray(input)){const quote=input[0].find((m:any)=>m.role==='user').content;content=JSON.stringify({memories:[{type:'fact',content:'用户'+quote.replace(/^我/,''),evidence:[{turn:1,role:'user',quote}]}]});}else{cores++;content='角色应保留有来源的长期偏好与关系连续性。';}return r.fulfill({json:{choices:[{message:{content},finish_reason:'stop'}]}})});
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'core',name:'角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('core');await db.messages.bulkPut(Array.from({length:10},(_,i)=>({id:'core'+i,conversationId:c.id,role:i%2?'assistant':'user',content:i%2?'我记得。':'我长期喜欢茶杯款式'+Math.floor(i/2)+'。',createdAt:i+1})));await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi({provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',apiKey:'synthetic',maxTokens:3000,temperature:0,enabled:true});const m=await import('/src/memorySummary.ts'),scope=await(await import('/src/memoryStore.ts')).getMemoryScope(c.id);await m.saveSummarySettings(scope,false,1);
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='conversations'&&args[0]?.memoryStore?.entries?.some((e:any)=>e.kind==='core'))throw new DOMException('synthetic core write failure','QuotaExceededError');return put.apply(this,args as any)};
  try{await m.catchUpMemorySummaries(scope);}finally{IDBObjectStore.prototype.put=put;}
  const failed=(await db.conversations.get(c.id))!;await(await import('/src/memoryCoreBuilder.ts')).retryCoreMemory(scope);const restored=(await db.conversations.get(c.id))!;return {receipts:failed.memorySummary?.receipts.length,failedCore:failed.memoryStore?.entries.filter(e=>e.kind==='core').length??0,failedStatus:failed.memoryCoreAttempt?.status,success:restored.memoryCoreAttempt?.status,coreCount:restored.memoryStore?.entries.filter(e=>e.kind==='core').length};
 });expect(result).toEqual({receipts:5,failedCore:0,failedStatus:'failed',success:'succeeded',coreCount:1});expect(cores).toBe(2);
});

test('provider role compatibility retry yields its request slot and checks foreground again',async({page})=>{
 await isolatedApp(page,'automation-role-fallback-'+crypto.randomUUID());const result=await page.evaluate(async()=>{
  const {requestAutomationReply}=await import('/src/automationRequests.ts'),{trackForeground}=await import('/src/automationActivity.ts');const config:any={id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:1000,temperature:0,enabled:true};let entered!:()=>void,release!:()=>void,releaseChat!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);const order:string[]=[];
  const transport={send:async(_url:string,init:any)=>{const body=JSON.parse(init.body),label=body.messages[0].role==='system'?'a-initial':body.messages[0].content==='other'?'other':'a-fallback';order.push(label);if(label==='a-initial'){entered();await gate;releaseChat=trackForeground(config,'synthetic');return new Response(JSON.stringify({error:{code:'unsupported_role'}}),{status:400,headers:{'Content-Type':'application/json'}})}return new Response(JSON.stringify({choices:[{message:{content:'完整正文'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})}};
  const a=requestAutomationReply(config,'synthetic',[{role:'system',content:'角色'}],new AbortController().signal,transport,true);await started;const b=requestAutomationReply(config,'synthetic',[{role:'user',content:'other'}],new AbortController().signal,transport,true);release();await new Promise(r=>setTimeout(r,150));const before=order.slice();releaseChat();await Promise.all([a,b]);return {before,order};
 });expect(result.before).toEqual(['a-initial']);expect(result.order).toEqual(['a-initial','other','a-fallback']);
});

test('provider timeout starts at request admission, never while ordinary chat owns API',async({page})=>{
 await isolatedApp(page,'automation-timeout-admission-'+crypto.randomUUID());await page.clock.install();
 await page.evaluate(async()=>{
  const {requestAutomationReply,armAutomationTimeout}=await import('/src/automationRequests.ts'),{trackForeground}=await import('/src/automationActivity.ts');const config:any={id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:1000,temperature:0,enabled:true};const w=window as any;w.__release=trackForeground(config,'synthetic');const controller=new AbortController();w.__controller=controller;w.__calls=0;w.__stop=armAutomationTimeout(controller,100);
  w.__pending=requestAutomationReply(config,'synthetic',[{role:'user',content:'等待普通聊天'}],controller.signal,{send:async()=>{w.__calls++;return new Response(JSON.stringify({choices:[{message:{content:'完成'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})}});
 });await page.clock.runFor(300);expect(await page.evaluate(()=>(window as any).__controller.signal.aborted)).toBe(false);expect(await page.evaluate(()=>(window as any).__calls)).toBe(0);await page.evaluate(()=>(window as any).__release());await page.clock.runFor(600);expect(await page.evaluate(async()=>await(window as any).__pending)).toBe('完成');expect(await page.evaluate(()=>(window as any).__controller.signal.aborted)).toBe(false);await page.evaluate(()=>(window as any).__stop());
});
test('primary summary waiting beyond old lease resumes with verified source, no false timeout',async({page})=>{
 await isolatedApp(page,'automation-summary-wait-'+crypto.randomUUID());await page.clock.install();let calls=0;await page.route('https://audit.test/**',r=>{calls++;return r.fulfill({json:{choices:[{message:{content:'{"memories":[]}'},finish_reason:'stop'}]}})});
 const id=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'waiting',name:'角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('waiting');await db.messages.bulkPut([{id:'wait-u',conversationId:c.id,role:'user',content:'今天一起散步。',createdAt:1},{id:'wait-a',conversationId:c.id,role:'assistant',content:'记下了。',createdAt:2}]);const value={provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',apiKey:'synthetic',maxTokens:3000,temperature:0,enabled:true};await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi(value);const api=await(await import('/src/dedicatedSummaryApi.ts')).getSummaryApi(await(await import('/src/memoryStore.ts')).getMemoryScope(c.id));(window as any).__releaseChat=(await import('/src/automationActivity.ts')).trackForeground(api.config,api.key);const scope=await(await import('/src/memoryStore.ts')).getMemoryScope(c.id),m=await import('/src/memorySummary.ts');await m.saveSummarySettings(scope,false,1);(window as any).__waitingSummary=m.runMemorySummary(scope);return c.id;
 });await expect.poll(()=>page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.memorySummary?.checkpoint?.inflight,id)).toBe(0);await page.clock.fastForward(240000);expect(calls).toBe(0);expect(await page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.memorySummary?.job?.status,id)).toBe('running');await page.evaluate(()=>(window as any).__releaseChat());await page.clock.runFor(1000);await page.evaluate(async()=>await(window as any).__waitingSummary);expect(calls).toBe(1);expect(await page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.memorySummary?.receipts.length,id)).toBe(1);
});

test('ordinary saving phase owns API priority before sendingUntil is persisted',async({page})=>{
 await isolatedApp(page,'automation-saving-priority-'+crypto.randomUUID());
 await page.route('https://audit.test/**',r=>r.fulfill({json:{choices:[{message:{content:'普通回复'},finish_reason:'stop'}]}}));
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts'),{getConversation}=await import('/src/chatService.ts');await db.characters.put({id:'saving',name:'角色',persona:''});const c=await getConversation('saving');const config:any={id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:1000,temperature:0,enabled:true,isDefault:true,createdAt:1,updatedAt:1};await db.apiConfigs.put(config);await db.apiCredentials.put({configId:'a',apiKey:'synthetic'});
  const {getTimelineRevision}=await import('/src/timelines.ts'),path=await getTimelineRevision(c.id),current=(await db.conversations.get(c.id))!;
  const {startGenerationTask,getGenerationTask}=await import('/src/generationTasks.ts'),{requestAutomationReply}=await import('/src/automationRequests.ts');
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);const transaction=db.transaction.bind(db);let blocked=false;
  (db as any).transaction=(...args:any[])=>{if(!blocked&&args[0]==='rw'){blocked=true;entered();return gate.then(()=>transaction(...args as Parameters<typeof transaction>))}return transaction(...args as Parameters<typeof transaction>)};
  const ordinary=startGenerationTask({conversation:current,expectedPath:{timelineId:path.timelineId,epoch:path.epoch},text:'先处理我的消息',retry:false,images:[]});
  try{await started;const status=getGenerationTask(c.id)?.status;let automatic=0;const pending=requestAutomationReply(config,'synthetic',[{role:'user',content:'automatic'}],new AbortController().signal,{send:async()=>{automatic++;return new Response(JSON.stringify({choices:[{message:{content:'完成'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})}});await new Promise(r=>setTimeout(r,150));const before=automatic;release();await ordinary.done;await pending;return {status,before,automatic};}finally{release();(db as any).transaction=transaction;}
 });expect(result).toEqual({status:'saving',before:0,automatic:1});
});

test('failed summary cooldown checks metadata without reconstructing source history',async({page})=>{
 await isolatedApp(page,'automation-cooldown-read-'+crypto.randomUUID());await page.route('https://audit.test/**',r=>r.fulfill({status:503,json:{error:{code:'unavailable'}}}));
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'cooldown',name:'角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('cooldown');await db.messages.bulkPut([{id:'cu',conversationId:c.id,role:'user',content:'我长期喜欢蓝色茶杯。',createdAt:1},{id:'ca',conversationId:c.id,role:'assistant',content:'记住了。',createdAt:2}]);await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi({provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',apiKey:'synthetic',maxTokens:3000,temperature:0,enabled:true});const scope=await(await import('/src/memoryStore.ts')).getMemoryScope(c.id),m=await import('/src/memorySummary.ts');await m.saveSummarySettings(scope,false,1);await m.runMemorySummary(scope);const failed=(await db.conversations.get(c.id))!.memorySummary!;failed.enabled=true;await db.conversations.update(c.id,{memorySummary:failed});
  // Count both source materialization and metadata-only path reads. Cached data
  // must not be needed merely to determine that this failed job is cooling.
  const methods=['get','getAll','openCursor'] as const,originals=methods.map(k=>IDBObjectStore.prototype[k]);let sourceReads=0;
  methods.forEach((k,i)=>{(IDBObjectStore.prototype as any)[k]=function(...args:any[]){if(['messages','pathNodes','timelines'].includes(this.name))sourceReads++;return(originals[i] as Function).apply(this,args)}});
  try{await m.tryAutoSummary(c.id);await new Promise(r=>setTimeout(r,100));return {sourceReads,job:(await db.conversations.get(c.id))?.memorySummary?.job?.status,receipts:(await db.conversations.get(c.id))?.memorySummary?.receipts.length}}finally{methods.forEach((k,i)=>(IDBObjectStore.prototype as any)[k]=originals[i])}
 });expect(result).toEqual({sourceReads:0,job:'failed',receipts:0});
});

for(const condition of [false,true])test(`partial citation cannot remove original ${condition?'condition':'negation'} or advance receipt`,async({page})=>{
 await isolatedApp(page,'automation-citation-boundary-'+condition+'-'+crypto.randomUUID());
 await page.route('https://audit.test/**',r=>r.fulfill({json:{choices:[{message:{content:JSON.stringify({memories:[{type:'fact',content:condition?'角色以后一直叫用户小舟。':'角色喜欢咖啡。',evidence:[{turn:1,role:'assistant',quote:condition?'我以后一直叫你小舟':'喜欢咖啡'}]}]})},finish_reason:'stop'}]}}));
 const result=await page.evaluate(async condition=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'source-boundary',name:'角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('source-boundary');await db.messages.bulkPut([{id:'boundary-u',conversationId:c.id,role:'user',content:'请记住已明确的态度。',createdAt:1},{id:'boundary-a',conversationId:c.id,role:'assistant',content:condition?'只有你同意，我以后一直叫你小舟。':'我不喜欢咖啡。',createdAt:2}]);await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi({provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',apiKey:'synthetic',maxTokens:3000,temperature:0,enabled:true});const m=await import('/src/memorySummary.ts'),scope=await(await import('/src/memoryStore.ts')).getMemoryScope(c.id);await m.saveSummarySettings(scope,false,1);await m.runMemorySummary(scope);return {status:await m.summaryStatus(scope),entries:(await(await import('/src/memoryStore.ts')).listMemories(scope)).entries};
 },condition);expect(result.status.job?.status).toBe('failed');expect(result.status.pending).toBe(1);expect(result.status.receipts).toBe(0);expect(result.entries).toEqual([]);
});

test('fragmented source still retains an earlier condition without rejecting a separate grounded fact',async({page})=>{
 await isolatedApp(page,'automation-fragment-boundary-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {buildSummaryInputs}=await import('/src/memorySummaryChunks.ts'),{reviewIntervalSummary}=await import('/src/memorySummaryPlan.ts');const content='如果你同意，'+'需要先征求你的意见，'.repeat(1000)+'我每天早起跑步。';const original=[{messages:[{role:'assistant',content,images:0}]}];const inputs=buildSummaryInputs(original,'说明',6000),input=inputs.find(s=>JSON.parse(s).flat().some((m:any)=>m.content.includes('我每天早起跑步')))!;const turn=JSON.parse(input).findIndex((rows:any[])=>rows.some(m=>m.content.includes('我每天早起跑步')))+1;
  let error='';try{reviewIntervalSummary(JSON.stringify({memories:[{content:'角色每天早起跑步。',type:'fact',evidence:[{turn,role:'assistant',quote:'我每天早起跑步'}]}]}),input,original)}catch(e){error=(e as any).diagnostic?.code}
  const mixedInput=JSON.stringify([[{role:'assistant',content:'我不喜欢咖啡。'},{role:'user',content:'我长期喜欢蓝色茶杯。'}]]);const mixed=reviewIntervalSummary(JSON.stringify({memories:[{content:'角色喜欢咖啡。',type:'fact',evidence:[{turn:1,role:'assistant',quote:'喜欢咖啡'}]},{content:'用户长期喜欢蓝色茶杯。',type:'fact',evidence:[{turn:1,role:'user',quote:'我长期喜欢蓝色茶杯'}]}]}),mixedInput);return {error,fragments:inputs.length,facts:mixed.facts.map(f=>f.content),rejected:mixed.rejected.length};
 });expect(result.fragments).toBeGreaterThan(1);expect(result.error).toBe('invalid-quality');expect(result.facts).toEqual(['用户长期喜欢蓝色茶杯。']);expect(result.rejected).toBe(1);
});

test('incomplete earlier core source group cannot block a later complete five-receipt group',async({page})=>{
 await isolatedApp(page,'automation-core-eligible-'+crypto.randomUUID());let coreCalls=0;
 await page.route('https://audit.test/**',r=>{const input=JSON.parse(r.request().postDataJSON().messages[1].content);let content:string;if(Array.isArray(input)){const quote=input[0].find((m:any)=>m.role==='user').content;content=JSON.stringify({memories:[{type:'fact',kind:'long',content:'用户'+quote.replace(/^我/,''),evidence:[{turn:1,role:'user',quote}]}]});}else{coreCalls++;content='角色应记住有来源的明确偏好与约定。';}return r.fulfill({json:{choices:[{message:{content},finish_reason:'stop'}]}})});
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'core-eligible',name:'角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('core-eligible');const rows=[];for(let i=0;i<10;i++){rows.push({id:'eu'+i,conversationId:c.id,role:'user',content:i<5?'我长期喜欢蓝色茶杯。':'我长期喜欢茶杯款式'+i+'。',createdAt:i*2+1},{id:'ea'+i,conversationId:c.id,role:'assistant',content:'我记得。',createdAt:i*2+2});}await db.messages.bulkPut(rows);await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi({provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',apiKey:'synthetic',maxTokens:3000,temperature:0,enabled:true});const scope=await(await import('/src/memoryStore.ts')).getMemoryScope(c.id),m=await import('/src/memorySummary.ts');await m.saveSummarySettings(scope,false,1);await m.catchUpMemorySummaries(scope);const saved=(await db.conversations.get(c.id))!,entries=(await(await import('/src/memoryStore.ts')).listMemories(scope)).entries;return {receipts:saved.memorySummary?.receipts.length,core:entries.filter(e=>e.kind==='core'),long:entries.filter(e=>e.kind==='long').length,secondAnchor:saved.memorySummary?.receipts[9].id,duplicates:saved.memorySummary?.receipts.slice(0,5).reduce((n,r)=>n+(r.duplicates??0),0),messages:await db.messages.count()};
 });expect(result.receipts).toBe(10);expect(result.duplicates).toBe(4);expect(result.long).toBe(6);expect(result.messages).toBe(20);expect(result.core).toHaveLength(1);expect(result.core[0].sourceReceiptId).toBe(result.secondAnchor);expect(coreCalls).toBe(1);
});

test('disabling automatic dreams while waiting prevents a new paid request',async({page})=>{
 await isolatedApp(page,'automation-dream-disabled-'+crypto.randomUUID());let calls=0;
 await page.route('https://audit.test/**',r=>{calls++;return r.fulfill({json:{choices:[{message:{content:JSON.stringify({title:'梦境',body:'梦中的风景与角色主观感受。'.repeat(40)})},finish_reason:'stop'}]}})});
 await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'dream-disabled',name:'角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('dream-disabled');const config:any={id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:3000,temperature:0,enabled:true,isDefault:true,createdAt:1,updatedAt:1};await db.apiConfigs.put(config);await db.apiCredentials.put({configId:'a',apiKey:'synthetic'});await(await import('/src/privateNotesArchive.ts')).saveNoteSchedule({mode:'important',intervalMinutes:60,dreamEnabled:true});const w=window as any;w.__releaseDreamChat=(await import('/src/automationActivity.ts')).trackForeground(config,'synthetic');w.__dreamPending=(await import('/src/privateNotesGeneration.ts')).generatePrivateNote(c.characterId,false,'梦境').then(()=>'',e=>e.message);
 });
 await expect.poll(()=>page.evaluate(async()=>(await(await import('/src/store.ts')).db.themes.get('private-notes-task:dream-disabled:dream') as any)?.privateNotesTask?.until??0)).toBeGreaterThan(0);expect(calls).toBe(0);
 await page.evaluate(async()=>{await(await import('/src/privateNotesArchive.ts')).saveNoteSchedule({mode:'important',intervalMinutes:60,dreamEnabled:false});(window as any).__releaseDreamChat()});
 const result=await page.evaluate(async()=>{const error=await(window as any).__dreamPending;const archive=await import('/src/privateNotesArchive.ts');return {error,notes:(await archive.readCharacterNotes('dream-disabled')).length,status:await archive.privateNotesTaskStatus('dream-disabled')}});expect(calls).toBe(0);expect(result.notes).toBe(0);expect(result.error).not.toBe('');expect(result.status?.failed).toBe(true);
});

test('live life task renews its owner while waiting beyond the old three-minute claim',async({page})=>{
 await isolatedApp(page,'automation-life-wait-'+crypto.randomUUID());await page.clock.install();let calls=0;await page.route('https://audit.test/**',r=>{calls++;return r.fulfill({json:{choices:[{message:{content:JSON.stringify({focus:'整理工作',mood:'平静',events:[],updates:[]})},finish_reason:'stop'}]}})});
 await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'life-wait',name:'角色',persona:''});await(await import('/src/chatService.ts')).getConversation('life-wait');const config:any={id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:3000,temperature:0,enabled:true,isDefault:true,createdAt:1,updatedAt:1};await db.apiConfigs.put(config);await db.apiCredentials.put({configId:'a',apiKey:'synthetic'});await(await import('/src/characterLife.ts')).changeCharacterLife('life-wait',s=>{s.enabled=true;s.lastAdvancedAt=Date.now()-2*86400000});const w=window as any;w.__releaseLifeChat=(await import('/src/automationActivity.ts')).trackForeground(config,'synthetic');w.__lifeWait=(await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-wait').then(()=>'',e=>e.message);
 });await expect.poll(()=>page.evaluate(async()=>(await(await import('/src/characterLife.ts')).readCharacterLife('life-wait')).attempt?.status)).toBe('running');await page.clock.fastForward(240001);await page.clock.runFor(20);expect(calls).toBe(0);
 const before=await page.evaluate(async()=>{await(await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-wait');const s=await(await import('/src/characterLife.ts')).readCharacterLife('life-wait');(window as any).__releaseLifeChat();return s.attempt?.status});await page.clock.runFor(1000);const result=await page.evaluate(async()=>{const error=await(window as any).__lifeWait;return {error,status:(await(await import('/src/characterLife.ts')).readCharacterLife('life-wait')).attempt?.status}});expect(before).toBe('running');expect(result).toEqual({error:'',status:'succeeded'});expect(calls).toBe(1);
});

test('independent scheduler runs dream after an ineligible diary check for the same role',async({page})=>{
 await isolatedApp(page,'automation-dream-lane-'+crypto.randomUUID());let calls=0;await page.route('https://audit.test/**',r=>{calls++;return r.fulfill({json:{choices:[{message:{content:JSON.stringify({title:'独立梦境',body:'梦中的风景与主观感受。'.repeat(40)})},finish_reason:'stop'}]}})});
 await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');await db.characters.put({id:'dream-lane',name:'角色',persona:''});await(await import('/src/chatService.ts')).getConversation('dream-lane');await db.apiConfigs.put({id:'a',name:'fixture',provider:'openai-compatible',baseUrl:'https://audit.test/v1',model:'mock',maxTokens:3000,temperature:0,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'a',apiKey:'synthetic'});const a=await import('/src/privateNotesArchive.ts');await a.saveNoteSchedule({mode:'interval',intervalMinutes:60,dreamEnabled:true});await a.appendPrivateNote('dream-lane',{id:'current-diary',characterId:'dream-lane',kind:'日记',createdAt:Date.now(),title:'保留的今日日记',body:'原记录不能被覆盖。',comments:[],sourceLastMessageAt:0});(window as any).__stopDreamLane=(await import('/src/privateNotesScheduler.ts')).installPrivateNotesScheduler();
 });
 try{await expect.poll(()=>page.evaluate(async()=>(await(await import('/src/privateNotesArchive.ts')).readCharacterNotes('dream-lane')).filter(n=>n.kind==='梦境').length)).toBe(1);const rows=await page.evaluate(async()=>await(await import('/src/privateNotesArchive.ts')).readCharacterNotes('dream-lane'));expect(rows.filter(n=>n.kind!=='梦境')).toHaveLength(1);expect(rows.find(n=>n.id==='current-diary')?.body).toBe('原记录不能被覆盖。');expect(calls).toBe(1);}finally{await page.evaluate(()=>(window as any).__stopDreamLane())}
});
