import {test,expect} from '@playwright/test';
import {storySeed,reply} from './storyFixture';
import {isolatedApp} from './backupBrowser';
const envelope=(provider:string,value:any)=>provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]}:{choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]};
for(const provider of ['openai-compatible','gemini'])test(`${provider} 单次指导失败保留，成功才消耗，不重复请求`,async({page})=>{
 await storySeed(page,provider);let fail=false;const requests:any[]=[];await page.route('https://story.test/**',r=>{requests.push(r.request().postDataJSON());return r.fulfill({json:envelope(provider,fail?{body:'不完整',choices:[]}:reply(requests.length))});});
 const root=await page.evaluate(async()=>await(await import('/src/storyGeneration.ts')).generateStory('story'));
 await page.evaluate(async()=>{await(await import('/src/storyStore.ts')).saveStoryGuidance('story',{text:'通过对白缓慢揭示线索，不代替主控选择。',mode:'once',enabled:true},0);});
 fail=true;const before=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');try{await(await import('/src/storyGeneration.ts')).generateStory('story',{kind:'custom',text:'先观察周围。'});}catch{}return {g:(await db.worlds.get('story'))!.storyPreferences!.guidance,s:(await db.storySessions.toArray())[0],nodes:await db.storyNodes.count()};});
 expect(before.g).toMatchObject({enabled:true,revision:1});expect(before.nodes).toBe(1);expect(before.s.headNodeId).toBe(root.id);expect(before.s.actionDraft?.customText).toBe('先观察周围。');
 fail=false;const after=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');await(await import('/src/storyGeneration.ts')).generateStory('story',{kind:'custom',text:'先观察周围。'});return {g:(await db.worlds.get('story'))!.storyPreferences!.guidance,s:(await db.storySessions.toArray())[0],nodes:await db.storyNodes.count()};});
 expect(after.g).toMatchObject({enabled:false,revision:2});expect(after.nodes).toBe(2);expect(after.s.revision).toBe(2);expect(requests).toHaveLength(3);
 for(const request of requests.slice(1)){const input=JSON.parse(provider==='gemini'?request.contents[0].parts[0].text:request.messages[1].content);expect(input.directionGuidance).toEqual({text:'通过对白缓慢揭示线索，不代替主控选择。',mode:'once'});expect(input.selectedAction.text).toBe('先观察周围。');const system=provider==='gemini'?request.systemInstruction.parts[0].text:request.messages[0].content;expect(system).toContain('玩家输入优先协议');expect(system).toContain('selectedAction');expect(system).toContain('必须执行其中关于叙事人称');}
 await page.reload();expect(requests).toHaveLength(3);
});

test('持续指导可编辑停用，篇幅设置保留指导，世界及普通聊天隔离',async({page})=>{
 await storySeed(page);const requests:any[]=[];await page.route('https://story.test/**',r=>{requests.push(r.request().postDataJSON());return r.fulfill({json:envelope('openai-compatible',reply())});});
 const result=await page.evaluate(async()=>{const {db}=await import('/src/store.ts'),{saveStoryGuidance,saveStoryLength}=await import('/src/storyStore.ts'),{generateStory}=await import('/src/storyGeneration.ts');const w=(await db.worlds.get('story'))!;await db.worlds.add({...w,id:'other'});
 await saveStoryGuidance('story',{text:'GUIDANCE_SCOPE_ONLY_以动机推进悬念',mode:'persistent',enabled:true},0);await saveStoryLength('story','detailed');const a=await generateStory('story');const b=await generateStory('story',a.choices[0].id);await generateStory('other');
 const persisted=(await db.worlds.get('story'))!.storyPreferences!.guidance!;
 await saveStoryGuidance('story',{text:'GUIDANCE_SCOPE_ONLY_新方向',mode:'persistent',enabled:false},persisted.revision);await generateStory('story',b.choices[0].id);
 await db.characters.add({id:'c',name:'测试角色',persona:'原始设定'});await db.worldProfiles.add({id:'guidance-profile',worldId:'story',characterId:'c',setting:'当前世界角色'});const {getConversation}=await import('/src/chatService.ts'),{buildContext}=await import('/src/chatContext.ts');const daily=await buildContext(await getConversation('c'));const world=await buildContext(await getConversation('c','story'));
 return {persisted,current:(await db.worlds.get('story'))!.storyPreferences,other:(await db.worlds.get('other'))!.storyPreferences,chat:JSON.stringify([daily,world])};});
 expect(result.persisted.enabled).toBe(true);expect(result.current!.length).toBe('detailed');expect(result.current!.guidance).toMatchObject({enabled:false,revision:2});expect(result.other?.guidance).toBeUndefined();expect(result.chat).not.toContain('GUIDANCE_SCOPE_ONLY');
 const inputs=requests.map(r=>JSON.parse(r.messages[1].content));expect(inputs[0].directionGuidance.text).toContain('GUIDANCE_SCOPE_ONLY');expect(inputs[1].directionGuidance).toEqual(inputs[0].directionGuidance);expect(inputs[2].directionGuidance).toBeUndefined();expect(inputs[3].directionGuidance).toBeUndefined();
});

test('事务写入失败回滚单次消耗，指导保存不推进主线',async({page})=>{
 await storySeed(page);let calls=0;await page.route('https://story.test/**',r=>{calls++;return r.fulfill({json:envelope('openai-compatible',reply())});});
 const result=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');await(await import('/src/storyStore.ts')).saveStoryGuidance('story',{text:'保留指导',mode:'once',enabled:true},0);const sessions=await db.storySessions.count();const fail=()=>{throw Error('synthetic-store-failure');};db.storyNodes.hook('creating',fail);try{await(await import('/src/storyGeneration.ts')).generateStory('story');}catch{}finally{db.storyNodes.hook('creating').unsubscribe(fail);}return {sessions,g:(await db.worlds.get('story'))!.storyPreferences!.guidance,nodes:await db.storyNodes.count()};});
 expect(result.sessions).toBe(0);expect(result.nodes).toBe(0);expect(result.g).toMatchObject({enabled:true,revision:1});expect(calls).toBe(1);
});

test('生成租约期间阻止编辑，强制变更使旧响应失效且不消耗新指导',async({page})=>{
 await storySeed(page);let held:any,calls=0;await page.route('https://story.test/**',r=>{calls++;held=r;});
 await page.evaluate(async()=>{const {saveStoryGuidance}=await import('/src/storyStore.ts');await saveStoryGuidance('story',{text:'原指导',mode:'once',enabled:true},0);(window as any).guidanceJob=(await import('/src/storyGeneration.ts')).generateStory('story').then(()=>true,()=>false);});await expect.poll(()=>calls).toBe(1);
 const blocked=await page.evaluate(async()=>{try{await(await import('/src/storyStore.ts')).saveStoryGuidance('story',{text:'冲突编辑',mode:'persistent',enabled:true},1);return false;}catch{return true;}});expect(blocked).toBe(true);
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts');await db.worlds.update('story',{'storyPreferences.guidance':{text:'其他窗口的新指导',mode:'once',enabled:true,revision:2}});});await held.fulfill({json:envelope('openai-compatible',reply())});
 const state=await page.evaluate(async()=>{const ok=await(window as any).guidanceJob;const {db}=await import('/src/store.ts');return {ok,nodes:await db.storyNodes.count(),g:(await db.worlds.get('story'))!.storyPreferences!.guidance};});expect(state.ok).toBe(false);expect(state.nodes).toBe(0);expect(state.g).toMatchObject({text:'其他窗口的新指导',enabled:true,revision:2});expect(calls).toBe(1);
});

test('390px 单一导航、长选项抽屉、指导编辑及键盘安全区域',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await storySeed(page);const node={...reply(),body:'原文第一段。\n\n“对白保持原样。”\n第三段。',choices:reply().choices.map(c=>({...c,text:c.text+'，仔细观察周围细节并等待回应。'.repeat(14)}))};let calls=0,fail=false;await page.route('https://story.test/**',r=>{calls++;return r.fulfill({json:envelope('openai-compatible',fail?{body:'不完整',choices:[]}:node)});});
 await page.evaluate(async()=>{await(await import('/src/storyGeneration.ts')).generateStory('story');});await page.getByRole('button',{name:'剧本',exact:true}).click();await expect(page.getByLabel('连续剧情',{exact:true})).toBeVisible();await expect(page.locator('.phone>.status')).toBeHidden();await expect(page.getByRole('button',{name:'剧本设置',exact:true})).toBeVisible();expect(await page.locator('.story-prose').evaluate(el=>el.textContent)).toBe(node.body);
 const reader=page.getByLabel('连续剧情',{exact:true}),height=await reader.evaluate(el=>el.clientHeight);await page.getByRole('button',{name:'收起操作',exact:true}).click();await expect.poll(()=>reader.evaluate(el=>el.clientHeight)).toBeGreaterThan(height+100);await expect(page.getByRole('button',{name:'展开操作',exact:true})).toHaveAttribute('aria-expanded','false');await expect(page.getByLabel('自定义行动',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('reader-collapsed-390.png')});
 await page.getByRole('button',{name:'展开操作',exact:true}).click();await page.getByRole('radio').first().check();await page.getByLabel('自定义行动',{exact:true}).fill('先观察现场。');await expect(page.getByRole('radio').first()).not.toBeChecked();await page.getByRole('radio').nth(1).check();await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('');await page.getByLabel('自定义行动',{exact:true}).fill('先观察现场。');
 await page.getByRole('button',{name:'剧情指导',exact:true}).click();await page.getByLabel('剧情指导内容',{exact:true}).fill('通过对白推进，不替主控决定。');await page.getByLabel('指导有效范围').selectOption('once');await page.getByRole('button',{name:'保存指导',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const confirmBox=(await page.locator('.story-submit').boundingBox())!;await page.getByRole('button',{name:'剧情指导',exact:true}).click();await page.mouse.click(confirmBox.x+confirmBox.width/2,confirmBox.y+confirmBox.height/2);await expect(page.getByRole('dialog')).toHaveCount(0);expect(calls).toBe(1);
 await page.setViewportSize({width:390,height:440});await page.getByLabel('自定义行动',{exact:true}).focus();await page.getByRole('button',{name:'确认选择',exact:true}).scrollIntoViewIfNeeded();await expect.poll(()=>page.getByRole('button',{name:'确认选择',exact:true}).evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(440);const row=await page.locator('.story-submit-row').evaluate(el=>{const a=el.children[0].getBoundingClientRect(),b=el.children[1].getBoundingClientRect();return a.right<=b.left;});expect(row).toBe(true);await expect(page.getByRole('button',{name:'确认选择',exact:true})).toBeInViewport();await page.screenshot({path:info.outputPath('reader-small-viewport-390.png')});
 await page.getByRole('button',{name:'收起操作',exact:true}).click();await expect.poll(()=>page.locator('.story-drawer-panel').evaluate(el=>el.getBoundingClientRect().height)).toBe(0);await expect.poll(()=>reader.evaluate(el=>el.clientHeight)).toBeGreaterThan(150);await page.getByRole('button',{name:'展开操作',exact:true}).click();await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('先观察现场。');
 fail=true;await page.getByRole('button',{name:'确认选择',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('先观察现场。');
 fail=false;await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'确认选择',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>{const {db}=await import('/src/store.ts');return (await db.storySessions.toArray())[0].revision;})).toBe(2);expect(calls).toBe(3);
 await page.getByRole('button',{name:'剧本设置',exact:true}).click();await page.getByLabel('剧情篇幅',{exact:true}).selectOption('detailed');await page.getByRole('button',{name:'返回剧本阅读',exact:true}).click();await page.screenshot({path:info.outputPath('reader-expanded-390.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('指导编辑捕获旧版本，不静默覆盖其他窗口的新设置',async({page})=>{
 await storySeed(page);await page.getByRole('button',{name:'剧本',exact:true}).click();await page.getByRole('button',{name:'剧情指导',exact:true}).click();await page.getByLabel('剧情指导内容',{exact:true}).fill('本页未保存输入');await page.evaluate(async()=>{await(await import('/src/storyStore.ts')).saveStoryGuidance('story',{text:'远端新指导',mode:'persistent',enabled:true},0);});await page.getByRole('button',{name:'保存指导',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('其他页面');await expect(page.getByLabel('剧情指导内容',{exact:true})).toHaveValue('本页未保存输入');
 expect(await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return (await db.worlds.get('story'))!.storyPreferences!.guidance!.text;})).toBe('远端新指导');
});

for(const mode of ['overwrite','merge'] as const)test(`指导设置 v7 ZIP ${mode} 保留且恢复不触发模型`,async({page,browser})=>{
 await storySeed(page);const bytes=await page.evaluate(async()=>{await(await import('/src/storyStore.ts')).saveStoryGuidance('story',{text:'持久化指导',mode:'persistent',enabled:true},0);const file=await(await import('/src/backupZip.ts')).createZipBackup({closedOtherClients:true});return Array.from(new Uint8Array(await file.arrayBuffer()));});
 const context=await browser.newContext(),target=await context.newPage();try{await isolatedApp(target,'guidance-import-'+crypto.randomUUID());const result=await target.evaluate(async({bytes,mode})=>{const {db}=await import('/src/store.ts');const files=await(await import('/src/backupZip.ts')).readBackupZip(new File([new Uint8Array(bytes)],'guide.zip'));const {prepareImport,defaultImportOptions}=await import('/src/importPlan.ts');const plan=await prepareImport(files,{...defaultImportOptions,mode});try{await(await import('/src/restoreService.ts')).restoreToCurrent([],{confirmed:true,plan,database:db});}finally{await plan.dispose();}db.close();await db.open();return {version:db.verno,g:(await db.worlds.toArray()).find(w=>w.name==='story')!.storyPreferences!.guidance,nodes:await db.storyNodes.count()};},{bytes,mode});expect(result).toEqual({version:8,g:{text:'持久化指导',mode:'persistent',enabled:true,revision:1},nodes:0});}finally{await context.close();}
});


test('玩家自由行动与剧情指导同时传入：指令优先于模型默认偏好',async({page})=>{
 await storySeed(page);const requests:any[]=[];
 await page.route('https://story.test/**',r=>{requests.push(r.request().postDataJSON());return r.fulfill({json:envelope('openai-compatible',requests.length===1?reply():{...reply(),body:'你'+ '景'.repeat(999)})});});
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const w=(await db.worlds.get('story'))!;await db.worlds.update('story',{script:{...w.script,perspective:'second'}});await(await import('/src/storyGeneration.ts')).generateStory('story');await(await import('/src/storyStore.ts')).saveStoryGuidance('story',{text:'保持第二人称叙述；减少对白、增加动作描写，正文目标约1000字。',mode:'persistent',enabled:true},0);await(await import('/src/storyGeneration.ts')).generateStory('story',{kind:'custom',text:'我尝试推开门，先询问守卫，不答应任何交易。'});});
 const input=JSON.parse(requests[1].messages[1].content);const system=requests[1].messages[0].content;expect(input.selectedAction.text).toBe('我尝试推开门，先询问守卫，不答应任何交易。');
 expect(input.narration.perspective).toBe('second');
 expect(input.directionGuidance.text).toContain('1000字');
 expect(system).toContain('玩家输入优先协议');
 expect(system).toContain('未要求改变时严格遵循 narration.perspective');
 expect(system).toContain('不能替玩家追加未选择的行动');
});
