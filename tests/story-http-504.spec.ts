import {test,expect} from '@playwright/test';
import {storySeed,reply} from './storyFixture';
const response=(provider:string,body=reply().body)=>provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...reply(),body})}]}}]}:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({...reply(),body})}}]};
async function prepare(page:any,provider='openai-compatible'){
 await storySeed(page,provider);await page.route('https://story.test/**',(r:any)=>r.fulfill({json:response(provider)}));
 const before=await page.evaluate(async()=>{const g=await import('/src/storyGeneration.ts'),store=await import('/src/storyStore.ts');await g.generateStory('story');await store.saveStoryDraft('story',{headNodeId:(await store.readStory('story')).session!.headNodeId!,mode:'custom',customText:'尝试查看旧信，但不进入房间。'});await store.saveStoryGuidance('story',{text:'保持第二人称，正文约1000字',enabled:true,mode:'once'},0);return store.readStory('story');});await page.unroute('https://story.test/**');return before;
}
for(const provider of ['openai-compatible','openai','gemini'])for(const format of ['html','json','empty'])test(`${provider} ${format} HTTP504：明确超时、保留节点/输入/指导、只请求一次`,async({page})=>{
 const before=await prepare(page,provider);let calls=0;const requests:any[]=[],logs:string[]=[];page.on('console',m=>logs.push(m.text()));
 await page.route('https://story.test/**',r=>{calls++;requests.push(r.request().postDataJSON());return r.fulfill({status:504,contentType:format==='json'?'application/json':'text/html',body:format==='html'?'<h1>Gateway Timeout PRIVATE_GATEWAY synthetic-story-fixture</h1>':format==='json'?JSON.stringify({error:{code:'gateway_timeout',message:'PRIVATE_GATEWAY synthetic-story-fixture'}}):''});});
 const result=await page.evaluate(async()=>{const {generateStory}=await import('/src/storyGeneration.ts');let message='',reason='';try{await generateStory('story',{kind:'custom',text:'尝试查看旧信，但不进入房间。'});}catch(e){message=(e as Error).message;reason=(await import('/src/replyFailure.ts')).describeReplyFailure(e).reason;}return {message,reason,data:await(await import('/src/storyStore.ts')).readStory('story')};});
 expect(calls).toBe(1);expect(result.reason).toContain('服务响应超时（HTTP 504）');expect(result.message).toContain('不会自动重试');expect(result.message).toContain('计费');expect(result.message).not.toMatch(/未扣费|不会扣费|7000.*导致|风格|人称/);
 expect(result.data.path).toEqual(before.path);expect(result.data.session?.headNodeId).toBe(before.session?.headNodeId);expect(result.data.session?.revision).toBe(1);expect(result.data.session?.pending).toBeUndefined();expect(result.data.session?.actionDraft).toEqual(before.session?.actionDraft);expect(result.data.world).toEqual(before.world);expect(result.data.session?.failureDetails).toMatchObject({code:'server',httpStatus:504,stage:'response',attempted:true,outputTokenLimit:7000});
 const payload=requests[0];expect(provider==='gemini'?payload.generationConfig.maxOutputTokens:provider==='openai'?payload.max_completion_tokens:payload.max_tokens).toBe(7000);if(provider!=='gemini')expect(payload.stream).toBe(false);
 expect(JSON.stringify(result.data.session?.failureDetails)+result.message+logs.join('\n')).not.toMatch(/PRIVATE_|synthetic-story-fixture|Authorization|Bearer/);await page.reload();expect(calls).toBe(1);
});

test('HTTP504不被不一致的上游正文错误代码误报为密钥失效',async({page})=>{
 await prepare(page);await page.route('https://story.test/**',r=>r.fulfill({status:504,json:{error:{code:'invalid_api_key'}}}));const f=await page.evaluate(async()=>{try{await(await import('/src/storyGeneration.ts')).generateStory('story',{kind:'custom',text:'等待。'});}catch{}return(await(await import('/src/storyStore.ts')).readStory('story')).session!.failureDetails;});expect(f).toMatchObject({code:'server',httpStatus:504,serviceCode:'invalid_api_key'});
});

for(const width of [390,430])test(`${width}px 504详情、刷新、手动重试一次，单次指导只在成功时消耗`,async({page},info)=>{
 await page.setViewportSize({width,height:844});const before=await prepare(page);let calls=0,ok=false;
 await page.route('https://story.test/**',r=>{calls++;return ok?r.fulfill({json:response('openai-compatible','我停在门外，守卫没有允许通行。')}):r.fulfill({status:504,contentType:'text/html',body:'Gateway Timeout'});});
 await page.getByRole('button',{name:'剧本',exact:true}).click();await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('尝试查看旧信，但不进入房间。');await page.getByRole('button',{name:'确认选择',exact:true}).click();await expect(page.locator('.story-reply-failure')).toBeVisible();await expect(page.getByRole('status',{name:'剧情书写状态'})).toContainText('本段');
 await page.getByText('查看错误详情',{exact:true}).click();await expect(page.locator('.story-failure-details')).toContainText('504');await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('尝试查看旧信，但不进入房间。');expect(calls).toBe(1);await page.screenshot({path:info.outputPath(`http504-${width}.png`)});
 await page.reload();await page.getByRole('button',{name:'剧本',exact:true}).click();await expect(page.locator('.story-reply-failure')).toBeVisible();expect(calls).toBe(1);ok=true;await page.getByRole('button',{name:'确认选择',exact:true}).click();await expect(page.locator('.story-prose').last()).toContainText('我停在门外');await expect(page.locator('.story-reply-failure')).toHaveCount(0);expect(calls).toBe(2);
 const after=await page.evaluate(async()=>(await import('/src/storyStore.ts')).readStory('story'));expect(after.path).toHaveLength(2);expect(after.path[0]).toEqual(before.path[0]);expect(after.world.storyPreferences?.guidance).toMatchObject({enabled:false,revision:2});
});

for(const mode of ['cancel','timeout','concurrent','success'] as const)test(`延迟响应 ${mode}：原期限、取消和并发保护不变`,async({page})=>{
 const before=await prepare(page);if(mode==='timeout')await page.clock.install();let calls=0,held:any;await page.route('https://story.test/**',r=>{calls++;held=r;});
 await page.evaluate(()=>{(window as any).abort504=new AbortController();(window as any).job504=import('/src/storyGeneration.ts').then(g=>g.generateStory('story',{kind:'custom',text:'尝试查看旧信，但不进入房间。'},{signal:(window as any).abort504.signal})).then(()=>true,()=>false);});await expect.poll(()=>calls).toBe(1);
 if(mode==='cancel')await page.evaluate(()=>(window as any).abort504.abort());if(mode==='timeout')await page.clock.fastForward(121000);
 if(mode==='concurrent')expect(await page.evaluate(async()=>{try{await(await import('/src/storyGeneration.ts')).generateStory('story',{kind:'custom',text:'重复点击。'});return false;}catch{return true;}})).toBe(true);
 await held.fulfill(mode==='concurrent'?{status:504,body:'Gateway Timeout'}:{json:response('openai-compatible')}).catch(()=>{});
 const result=await page.evaluate(async()=>({ok:await(window as any).job504,data:await(await import('/src/storyStore.ts')).readStory('story')}));expect(calls).toBe(1);expect(result.ok).toBe(mode==='success');expect(result.data.session?.pending).toBeUndefined();
 if(mode==='success'){expect(result.data.path).toHaveLength(2);expect(result.data.world.storyPreferences?.guidance?.enabled).toBe(false);}else{expect(result.data.path).toEqual(before.path);expect(result.data.session?.actionDraft).toEqual(before.session?.actionDraft);expect(result.data.world).toEqual(before.world);expect(result.data.session?.failureDetails?.code).toBe(mode==='concurrent'?'server':mode==='timeout'?'timeout':'cancelled');}
});

test('504后的重生失败和回溯不污染旧路径，旧失败记录保持兼容',async({page})=>{
 const before=await prepare(page);await page.route('https://story.test/**',r=>r.fulfill({json:response('openai-compatible')}));await page.evaluate(async()=>await(await import('/src/storyGeneration.ts')).generateStory('story',{kind:'custom',text:'先观察信封。'}));await page.unroute('https://story.test/**');let calls=0;await page.route('https://story.test/**',r=>{calls++;return r.fulfill({status:504,body:'Gateway Timeout'});});
 const result=await page.evaluate(async()=>{const st=await import('/src/storyStore.ts'),g=await import('/src/storyGeneration.ts');const old=await st.readStory('story');try{await g.generateStory('story',undefined,{operation:'regenerate'});}catch{}const failed=await st.readStory('story');const f=await import('/src/storyFailure.ts');const reason=f.storyFailureReason({version:1,code:'server',stage:'response',attempted:true,httpStatus:504});await st.withdrawStory('story',{sessionId:failed.session!.id,headNodeId:failed.session!.headNodeId,revision:failed.session!.revision});return {old,failed,after:await st.readStory('story'),reason,valid:f.validStoryFailure(failed.session!.failureDetails)};});expect(calls).toBe(1);expect(result.failed.path).toEqual(result.old.path);expect(result.valid).toBe(true);expect(result.reason).toContain('服务响应超时（HTTP 504）');expect(result.after.path).toEqual(before.path);expect(result.after.session?.actionDraft?.customText).toBe('先观察信封。');
});

for(const mode of ['cancel','deadline'] as const)test(`已收到504响应头，错误正文延迟时 ${mode} 不丢失证据且取消优先`,async({page})=>{
 const before=await prepare(page);await page.clock.install();
 await page.evaluate(async()=>{const {browserTransport}=await import('/src/api.ts');(window as any).late504Calls=0;browserTransport.send=async(_url,init)=>{(window as any).late504Calls++;return new Response(new ReadableStream({start(c){init.signal?.addEventListener('abort',()=>c.error(new DOMException('Aborted','AbortError')),{once:true});}}),{status:504,headers:{'content-type':'text/html'}});};(window as any).late504Abort=new AbortController();(window as any).late504Job=import('/src/storyGeneration.ts').then(g=>g.generateStory('story',{kind:'custom',text:'等待。'},{signal:(window as any).late504Abort.signal})).then(()=>true,()=>false);});
 await expect.poll(()=>page.evaluate(()=>(window as any).late504Calls)).toBe(1);
 if(mode==='cancel')await page.evaluate(()=>(window as any).late504Abort.abort());else await page.clock.fastForward(121000);
 const r=await page.evaluate(async()=>({ok:await(window as any).late504Job,data:await(await import('/src/storyStore.ts')).readStory('story'),calls:(window as any).late504Calls}));expect(r.ok).toBe(false);expect(r.calls).toBe(1);expect(r.data.path).toEqual(before.path);expect(r.data.world).toEqual(before.world);expect(r.data.session?.pending).toBeUndefined();expect(r.data.session?.failureDetails).toMatchObject({code:mode==='cancel'?'cancelled':'server',httpStatus:504,stage:mode==='cancel'?'request':'response'});
});
