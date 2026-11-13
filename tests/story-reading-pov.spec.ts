import {isolatedApp} from './backupBrowser';
import {test,expect} from '@playwright/test';
import {seedWizardAI,wizardResponse,openingNode} from './wizardAIFixture';
import {storySeed,reply} from './storyFixture';

for(const perspective of ['first','second','third'] as const)test(`人称 ${perspective} 按世界保存，开场及后续请求使用相同设置`,async({page})=>{
 const {draft}=await seedWizardAI(page);const requests:any[]=[];await page.route('https://wizard.test/**',r=>{requests.push(r.request().postDataJSON());return r.fulfill({json:wizardResponse('openai-compatible',{...openingNode,body:perspective==='first'?'我停在车站出口。':perspective==='third'?'主控停在车站出口。':openingNode.body})});});
 const result=await page.evaluate(async({draft,perspective})=>{
  const {db}=await import('/src/store.ts');const {createWizardWorld}=await import('/src/scriptWizardCreation.ts');const {generateStory}=await import('/src/storyGeneration.ts');
  const w=await createWizardWorld({...draft,perspective});const other=await createWizardWorld({...draft,creationToken:crypto.randomUUID(),perspective:perspective==='first'?'third':'first'});
  const node=await generateStory(w.id);await generateStory(w.id,{kind:'custom',text:'留在原地观察，不替其他人决定。'});db.close();await db.open();
  return {pov:(await db.worlds.get(w.id))!.script!.perspective,other:(await db.worlds.get(other.id))!.script!.perspective,snapshot:(await db.storySessions.where('worldId').equals(w.id).first())!.definition.script.perspective,body:(await db.storyNodes.get(node.id))!.body};
 },{draft,perspective});
 expect(result.pov).toBe(perspective);expect(result.other).not.toBe(perspective);expect(result.snapshot).toBe(perspective);expect(result.body).toBe(perspective==='first'?'我停在车站出口。':perspective==='third'?'主控停在车站出口。':openingNode.body);expect(requests).toHaveLength(2);
 for(const request of requests){const system=request.messages[0].content,input=JSON.parse(request.messages[1].content);expect(input.narration.perspective).toBe(perspective);expect(input.definition.script.perspective).toBe(perspective);expect(system).toContain('中文小说叙事');expect(system).toContain('潜台词');expect(system).toContain('不机械替换对白');expect(system).toContain('不代替用户作出新选择');}
});

test('旧世界及旧草稿默认第二人称，非法字段拒绝，显式默认不增加定义版本',async({page})=>{
 await storySeed(page);const requests:any[]=[];await page.route('https://story.test/**',r=>{requests.push(r.request().postDataJSON());return r.fulfill({json:{choices:[{message:{content:JSON.stringify(reply())}}]}});});
 const result=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {saveScriptWorld}=await import('/src/scriptWorlds.ts');const {validateScriptConfig}=await import('/src/scriptValidation.ts');const {newWizardDraft,validateWizardDraft}=await import('/src/scriptWizardDraft.ts');
  const w=(await db.worlds.get('story'))!;const revision=w.script!.definitionRevision;const updated=await saveScriptWorld({...w,script:{...w.script!,perspective:'second'}});const old={...updated.script};delete old.perspective;await db.worlds.update(w.id,{script:old as any});
  const d=newWizardDraft();const defaultPov=d.perspective;delete d.perspective;validateWizardDraft(d);let bad=0;try{validateScriptConfig({...old,perspective:'invalid'});}catch{bad++;}try{validateWizardDraft({...d,perspective:'invalid'});}catch{bad++;}
  await(await import('/src/storyGeneration.ts')).generateStory('story');return {revision,updated:updated.script!.definitionRevision,defaultPov,bad};
 });expect(result.updated).toBe(result.revision);expect(result.defaultPov).toBe('second');expect(result.bad).toBe(2);expect(JSON.parse(requests[0].messages[1].content).narration.perspective).toBe('second');
});

test('390px 第五步贴近底部、摘要独立滚动，小说排版与抽屉收起保留正文',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await seedWizardAI(page,'openai-compatible',0);await expect(page.getByLabel('叙事人称')).toHaveValue('second');await page.getByLabel('叙事人称').selectOption('third');await page.reload();await expect(page.getByLabel('叙事人称')).toHaveValue('third');
 const body='午后的风掠过窗沿，树影落在纸上。\n\n“信在这里。”她把纸页推到桌边。\n主控仍有时间决定是否拆开它。';
 let calls=0;await page.route('https://wizard.test/**',r=>{calls++;return r.fulfill({json:wizardResponse('openai-compatible',{...openingNode,body})});});
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {loadWizardDraft,wizardDraftKey}=await import('/src/scriptWizardDraft.ts');const d=loadWizardDraft(localStorage,wizardDraftKey(db.name)).draft;d.rules='不得替主控作出重大决定。\n'.repeat(100);const w=await(await import('/src/scriptWizardCreation.ts')).createWizardWorld(d);await(await import('/src/store.ts')).usePhone.getState().reload();await(await import('/src/spaces.ts')).useSpaces.getState().openWorldEditor('setup',w.id);});
 await expect(page.getByRole('button',{name:'生成开场',exact:true})).toBeVisible();expect(calls).toBe(0);
 await expect.poll(()=>page.locator('.wizard-setup').evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-((visualViewport?.height??innerHeight)+(visualViewport?.offsetTop??0)-8)))).toBeLessThan(2);
 const area=page.locator('.wizard-content');await area.evaluate(el=>el.scrollTop=el.scrollHeight);const last=await page.locator('.wizard-summary dd').last().boundingBox(),footer=await page.locator('.wizard-footer').boundingBox();expect(last!.y+last!.height).toBeLessThanOrEqual(footer!.y+1);
 const rects=await page.locator('.wizard-footer button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width};}));expect(rects).toHaveLength(3);expect(rects[0].width).toBeGreaterThan(280);expect(rects[2].bottom).toBeLessThanOrEqual(836);expect(844-rects[2].bottom).toBeLessThan(35);for(let i=1;i<rects.length;i++)expect(rects[i].top).toBeGreaterThanOrEqual(rects[i-1].bottom);
 await area.evaluate(el=>el.scrollTop=0);await page.screenshot({path:info.outputPath('step-five-390.png')});
 await page.getByRole('button',{name:'生成开场',exact:true}).click();await page.getByRole('button',{name:'进入故事',exact:true}).click();await expect(page.locator('.story-prose')).toHaveText(body);
 expect(await page.locator('.story-prose').evaluate(el=>el.textContent)).toBe(body);
 const styles=await page.locator('.story-paragraph').first().evaluate(el=>{const s=getComputedStyle(el),r=getComputedStyle(el.closest('.story-reader')!);return {font:s.fontSize,line:s.lineHeight,indent:s.textIndent,left:r.paddingLeft,right:r.paddingRight};});expect(styles).toEqual({font:'17px',line:'28.05px',indent:'0px',left:'16px',right:'16px'});
 const reader=page.getByLabel('连续剧情',{exact:true}),before=await reader.evaluate(el=>el.clientHeight);await page.getByRole('button',{name:'收起操作',exact:true}).click();await expect.poll(()=>reader.evaluate(el=>el.clientHeight)).toBeGreaterThan(before+100);expect(await page.locator('.story-prose').evaluate(el=>el.textContent)).toBe(body);expect(calls).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('reader-collapsed-390.png')});
});

for(const mode of ['overwrite','merge'] as const)test(`人称及原正文 ZIP 往返 ${mode}`,async({page,browser})=>{
 const {draft}=await seedWizardAI(page);await page.route('https://wizard.test/**',r=>r.fulfill({json:wizardResponse('openai-compatible',{...openingNode,body:'我停在出口，看见她手中的旧信。'})}));
 const bytes=await page.evaluate(async draft=>{const w=await(await import('/src/scriptWizardCreation.ts')).createWizardWorld({...draft,perspective:'first'});await(await import('/src/wizardOpening.ts')).generateWizardOpening(w.id,'confirmation');const file=await(await import('/src/backupZip.ts')).createZipBackup({closedOtherClients:true});return Array.from(new Uint8Array(await file.arrayBuffer()));},draft);
 const context=await browser.newContext(),target=await context.newPage();try{await isolatedApp(target,'pov-restore-'+crypto.randomUUID());const result=await target.evaluate(async({bytes,mode})=>{
  const {db}=await import('/src/store.ts');const files=await(await import('/src/backupZip.ts')).readBackupZip(new File([new Uint8Array(bytes)],'pov.zip'));const {prepareImport,defaultImportOptions}=await import('/src/importPlan.ts');const plan=await prepareImport(files,{...defaultImportOptions,mode});try{await(await import('/src/restoreService.ts')).restoreToCurrent([],{confirmed:true,plan,database:db});}finally{await plan.dispose();}db.close();await db.open();const w=(await db.worlds.toArray()).find(w=>w.script?.creation)!;const story=await(await import('/src/storyStore.ts')).readStory(w.id);return {version:db.verno,pov:w.script!.perspective,snapshot:story.session!.definition.script.perspective,body:story.path[0].body};
 },{bytes,mode});expect(result).toEqual({version:7,pov:'first',snapshot:'first',body:'我停在出口，看见她手中的旧信。'});}finally{await context.close();}
});
