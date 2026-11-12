import {test,expect} from '@playwright/test';
import {storySeed} from './storyFixture';

test('HTTP200非JSON外层响应不能误报网络错误，显示响应阶段诊断',async({page})=>{
 await storySeed(page);await page.route('https://story.test/**',r=>r.fulfill({status:200,contentType:'application/json',body:'PRIVATE_INVALID_ENVELOPE'}));
 const r=await page.evaluate(async()=>{const {generateStory}=await import('/src/storyGeneration.ts');const {describeReplyFailure}=await import('/src/replyFailure.ts');const {db}=await import('/src/store.ts');try{await generateStory('story');throw Error('unexpected success');}catch(e){return {failure:describeReplyFailure(e),session:await db.storySessions.where('worldId').equals('story').first()};}});
 expect(r.failure.kind).not.toBe('network');expect(r.failure.reason).toBe('本次生成未完成，请稍后重试。');expect(r.session?.error).toBe('invalid');
});

const cases=[
 {name:'认证',status:401,error:{code:'invalid_api_key',message:'synthetic-story-fixture PRIVATE_ERROR_BODY'},code:'auth',stage:'response'},
 {name:'余额',status:429,error:{code:'insufficient_quota',message:'synthetic-story-fixture PRIVATE_ERROR_BODY'},code:'quota',stage:'response'},
 {name:'频率',status:429,error:{code:'rate_limit_exceeded',message:'PRIVATE_ERROR_BODY'},code:'rate',stage:'response'},
 {name:'未知429不猜余额',status:429,error:{message:'PRIVATE_ERROR_BODY'},code:'http-error',stage:'response'},
 {name:'未知403不猜安全拦截',status:403,error:{message:'PRIVATE_ERROR_BODY'},code:'http-error',stage:'response'},
 {name:'服务端异常',status:503,error:{message:'PRIVATE_ERROR_BODY'},code:'server',stage:'response'},
 {name:'网络无响应',code:'network',stage:'request',network:true},
 {name:'模型空文本',code:'empty-response',stage:'response',text:''},
 {name:'输出截断',code:'truncated',stage:'response',text:'{"body":"PRIVATE_STORY',finish:'length'},
 {name:'缺少一个选项',code:'choice-count',stage:'validation',value:{body:'PRIVATE_BODY',choices:[{id:'A',text:'甲'},{id:'B',text:'乙'},{id:'C',text:'丙'}]}},
 {name:'正文JSON未闭合不能猜截断',code:'json-incomplete',stage:'parse',text:'{"body":"PRIVATE_BODY"'},
 {name:'安全拦截',code:'blocked',stage:'response',text:'',finish:'content_filter'},
 {name:'错误响应字段类型',code:'envelope-shape',stage:'response',envelope:{choices:[{message:{content:{private:'PRIVATE_BODY'}}}]}},
];
for(const c of cases)test(`完整生成链路分类：${c.name}，失败不推进也不重试`,async({page})=>{
 await storySeed(page);let calls=0;const logs:string[]=[];page.on('console',m=>logs.push(m.text()));
 await page.route('https://story.test/**',r=>{calls++;if(c.network)return r.abort();return r.fulfill({status:c.status??200,json:c.error?{error:c.error}:c.envelope??{choices:[{finish_reason:c.finish??'stop',message:{content:c.text??JSON.stringify(c.value)}}]}});});
 const r=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');let message='';try{await(await import('/src/storyGeneration.ts')).generateStory('story');}catch(e){message=(e as Error).message;}const s=(await db.storySessions.toArray())[0];await(await import('/src/storyValidation.ts')).validateStorySession(s);return {message,s,nodes:await db.storyNodes.count(),version:db.verno};});
 expect(r.s.status).toBe('failed');expect(r.s.revision).toBe(0);expect(r.nodes).toBe(0);expect(r.version).toBe(7);expect(r.s.failureDetails).toMatchObject({code:c.code,stage:c.stage,attempted:true});if(c.status)expect(r.s.failureDetails!.httpStatus).toBe(c.status);expect(r.message).toContain(['choice-count','json-incomplete'].includes(c.code)?'原进度已保留':'原进度未改变');expect(calls).toBe(1);
 expect(JSON.stringify(r.s.failureDetails)+r.message+logs.join('\n')).not.toMatch(/PRIVATE_|synthetic-story-fixture|Authorization|Bearer/);if(c.code==='http-error')expect(r.message).toContain('暂时无法确定');if(c.code==='choice-count')expect(r.s.failureDetails!.choiceCount).toBe(3);if(c.code==='json-incomplete')expect(r.message).not.toContain('输出被截断');await page.reload();expect(calls).toBe(1);
});

for(const missing of [true,false])test(`全局API${missing?'未配置':'无效'}时不发出请求、不修改世界或草稿`,async({page})=>{
 await storySeed(page);let calls=0;await page.route('https://story.test/**',r=>{calls++;return r.abort();});
 const r=await page.evaluate(async missing=>{const {db}=await import('/src/store.ts');if(missing){await db.apiConfigs.clear();await db.apiCredentials.clear();}else await db.apiConfigs.update('story-api',{model:''});const before=await db.worlds.toArray();try{await(await import('/src/storyGeneration.ts')).generateStory('story');}catch{}return {before,after:await db.worlds.toArray(),s:(await db.storySessions.toArray())[0]};},missing);
 expect(calls).toBe(0);expect(r.after).toEqual(r.before);expect(r.s.failureDetails).toMatchObject({code:missing?'config-missing':'config-invalid',stage:'configuration',attempted:false});
});

for(const provider of ['openai-compatible','gemini'])test(`${provider}错误详情在第五步及刷新后可见，手动确认才重试，成功清除旧错误`,async({page},info)=>{
 const {seedWizardAI,openingNode,wizardResponse}=await import('./wizardAIFixture');await page.setViewportSize({width:390,height:844});const {worldId}=await seedWizardAI(page,provider);let valid=false,calls=0;
 await page.route('https://wizard.test/**',r=>{calls++;return r.fulfill({json:wizardResponse(provider,valid?openingNode:{...openingNode,choices:openingNode.choices.slice(0,3)})});});
 await page.getByRole('button',{name:'确认开局',exact:true}).click();await expect(page.getByRole('button',{name:'重试生成开场',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toContainText('本回合生成未完成');await page.getByText('查看错误详情',{exact:true}).click();await expect(page.locator('.story-failure-details')).toContainText('choice-count');await expect(page.locator('.story-failure-details')).toContainText('正文及选项校验');await expect(page.locator('.story-failure-details')).toContainText('200');expect(calls).toBe(1);await page.screenshot({path:info.outputPath(`wizard-error-${provider}-390.png`)});
 const before=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');return {world:await db.worlds.get(id),s:await db.storySessions.where('worldId').equals(id).first()};},worldId);
 await page.reload();await expect(page.getByRole('alert')).toContainText('本回合生成未完成');await page.getByText('查看错误详情',{exact:true}).click();await expect(page.locator('.story-failure-details')).toContainText('choice-count');expect(calls).toBe(1);page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'重试生成开场',exact:true}).click();expect(calls).toBe(1);
 valid=true;page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'重试生成开场',exact:true}).click();await expect(page.getByRole('button',{name:'进入故事',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.locator('.story-failure-details')).toHaveCount(0);expect(calls).toBe(2);
 const after=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');return {world:await db.worlds.get(id),s:await db.storySessions.where('worldId').equals(id).first(),nodes:await db.storyNodes.count()};},worldId);expect(after.world).toEqual(before.world);expect(after.nodes).toBe(1);expect(after.s?.failureDetails).toBeUndefined();
});

test('第五步API认证失败不显示原始服务错误/密钥，HTTP与固定服务代码可查看',async({page})=>{
 const {seedWizardAI}=await import('./wizardAIFixture');await seedWizardAI(page);await page.route('https://wizard.test/**',r=>r.fulfill({status:401,json:{error:{code:'invalid_api_key',message:'synthetic-fixture-only PRIVATE_CHAT_BODY Authorization: Bearer sensitive-secret'}}}));await page.getByRole('button',{name:'确认开局',exact:true}).click();await expect(page.getByRole('alert')).toContainText('API 密钥无效');await page.getByText('查看错误详情',{exact:true}).click();await expect(page.locator('.story-failure-details')).toContainText('401');await expect(page.locator('.story-failure-details')).toContainText('invalid_api_key');expect(await page.locator('body').innerText()).not.toMatch(/PRIVATE_CHAT|synthetic-fixture|sensitive-secret|Authorization/);
});

test('Story只使用已选全局默认，不误用角色/会话绑定；切换后的开场使用完整新配置',async({page})=>{
 const {seedWizardAI,openingNode,wizardResponse}=await import('./wizardAIFixture');const {worldId}=await seedWizardAI(page);let calls=0,request:any,url='',headers:any;
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const a=(await db.apiConfigs.get('wizard-api'))!;await db.apiConfigs.put({...a,id:'global-b',provider:'gemini',baseUrl:'https://global-story.test/v1beta',model:'new-model',temperature:.3,maxTokens:2400,isDefault:false});await db.apiCredentials.put({configId:'global-b',apiKey:'synthetic-global-b'});await db.characters.update('base',{apiConfigId:'wizard-api'});const c=(await db.conversations.toArray())[0];await db.conversations.update(c.id,{apiConfigId:'wizard-api'});await(await import('/src/apiSelection.ts')).selectApiDefault('global-b');});
 await page.route('https://global-story.test/**',r=>{calls++;request=r.request().postDataJSON();url=r.request().url();headers=r.request().headers();return r.fulfill({json:wizardResponse('gemini',openingNode)});});
 await page.getByRole('button',{name:'确认开局',exact:true}).click();await expect(page.getByRole('button',{name:'进入故事',exact:true})).toBeVisible();expect(calls).toBe(1);expect(url).toBe('https://global-story.test/v1beta/models/new-model:generateContent');expect(headers['x-goog-api-key']).toBe('synthetic-global-b');expect(request.generationConfig).toMatchObject({temperature:.3,maxOutputTokens:11000});expect(JSON.stringify(request)).not.toContain('DAILY_PRIVATE_CHAT');expect(await page.evaluate(async id=>(await(await import('/src/store.ts')).db.storySessions.where('worldId').equals(id).first())?.revision,worldId)).toBe(1);
});

test('超时明确记录且不推进、不自动重发，迟到响应不能保存',async({page})=>{
 await storySeed(page);await page.clock.install();let calls=0,held:any;
 await page.route('https://story.test/**',r=>{calls++;held=r;});
 await page.evaluate(()=>{(window as any).failedStory=(async()=>{try{await(await import('/src/storyGeneration.ts')).generateStory('story');}catch(e){return (e as Error).message;}})();});
 await expect.poll(()=>calls).toBe(1);await page.clock.fastForward(120001);
 await expect.poll(()=>page.evaluate(async()=> (await(await import('/src/store.ts')).db.storySessions.toArray())[0]?.failureDetails?.code)).toBe('timeout');
 const message=await page.evaluate(()=>(window as any).failedStory);expect(message).toContain('请求超时');expect(calls).toBe(1);
 await held.fulfill({json:{choices:[{message:{content:JSON.stringify({body:'迟到正文',choices:['A','B','C','D'].map(id=>({id,text:id}))})}}]}}).catch(()=>{});
 expect(await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return {nodes:await db.storyNodes.count(),revision:(await db.storySessions.toArray())[0].revision};})).toEqual({nodes:0,revision:0});
});

test('Gemini畸形响应字段不误报网络，诊断仅包含安全标量',async({page})=>{
 await storySeed(page,'gemini');await page.route('https://story.test/**',r=>r.fulfill({json:{candidates:[{content:{parts:[null]},finishReason:'STOP'}]}}));
 const f=await page.evaluate(async()=>{try{await(await import('/src/storyGeneration.ts')).generateStory('story');}catch{}return (await(await import('/src/store.ts')).db.storySessions.toArray())[0].failureDetails;});
 expect(f).toMatchObject({code:'envelope-shape',stage:'response',httpStatus:200,attempted:true});
});

for(const mode of ['overwrite','merge'] as const)test(`安全诊断随ZIP${mode}往返，旧会话兼容，拒绝额外敏感字段`,async({page})=>{
 await storySeed(page);await page.route('https://story.test/**',r=>r.fulfill({json:{choices:[{message:{content:'{"body":"未闭合'}}]}}));
 const result=await page.evaluate(async mode=>{
  const {db}=await import('/src/store.ts');try{await(await import('/src/storyGeneration.ts')).generateStory('story');}catch{}
  const s=(await db.storySessions.toArray())[0],{validateStorySession}=await import('/src/storyValidation.ts');
  const old={...s};delete old.failureDetails;validateStorySession(old);
  let rejected=0;for(const patch of [{raw:'PRIVATE_RESPONSE'},{serviceCode:'Bearer SECRET'},{httpStatus:999},{responseCharacters:-1}]){try{validateStorySession({...s,failureDetails:{...s.failureDetails!,...patch}});}catch{rejected++;}}
  const zip=await(await import('/src/backupZip.ts')).createZipBackup({closedOtherClients:true});const files=await(await import('/src/backupZip.ts')).readBackupZip(zip);
  const {prepareImport,defaultImportOptions,getImportPlan}=await import('/src/importPlan.ts');const target=mode==='merge'?new (db.constructor as any)('diagnostic-merge-'+crypto.randomUUID()):db;if(target!==db)await target.open();
  const plan=await prepareImport(files,{...defaultImportOptions,mode},{database:target});
  try{const candidate=getImportPlan(plan,target).database;const restored=(await candidate.table('storySessions').toArray())[0];validateStorySession(restored);return {original:s.failureDetails,restored:restored.failureDetails,rejected,version:db.verno};}finally{await plan.dispose();if(target!==db)await target.delete();}
 },mode);
 expect(result.restored).toEqual(result.original);expect(result.rejected).toBe(4);expect(result.version).toBe(7);
});
