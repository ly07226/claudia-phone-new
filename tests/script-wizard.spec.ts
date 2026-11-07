import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
async function open(page:Page){await isolatedApp(page,'wizard-'+crypto.randomUUID());await page.evaluate(async()=>{
 const {db,usePhone}=await import('/src/store.ts');await db.characters.put({id:'existing',name:'已有角色',persona:'静态人设'});
 const theme=(await db.themes.get('global'))!;await db.themes.update('global',{userIdentities:{...theme.userIdentities,daily:{name:'原主控',bio:'身份简介',customSetting:'静态设定',gender:'女',age:26,occupation:'医生'}}});
 await usePhone.getState().reload();await(await import('/src/spaces.ts')).useSpaces.getState().openWorldEditor('create');
 });await page.getByRole('button',{name:'AI 生成',exact:true}).click();await expect(page.getByRole('heading',{name:'剧情设定',exact:true})).toBeVisible();}
async function step1(page:Page){await page.getByLabel('故事标题',{exact:true}).fill('新的旅途');await page.getByLabel('整体剧情梗概',{exact:true}).fill('一个寻找真相的故事');await page.getByRole('button',{name:'下一步',exact:true}).click();}
async function step2(page:Page){await page.getByLabel('主控资料来源').selectOption('daily');await page.getByRole('button',{name:'下一步',exact:true}).click();}
async function step3(page:Page){await page.locator('.wizard-character input').check();await page.getByRole('button',{name:'下一步',exact:true}).click();}
test('五步导航、返回、刷新、真实创建及身份静态复制；无模型调用',async({page})=>{
 let calls=0;await page.route('https://story.test/**',r=>{calls++;return r.abort();});await open(page);
 const before=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return Promise.all(db.tables.map(async t=>[t.name,await t.count()]));});
 await page.getByRole('button',{name:'下一步',exact:true}).click();await expect(page.getByRole('alert')).toContainText('标题');await step1(page);
 await page.getByLabel('主控资料来源').selectOption('daily');await expect(page.getByLabel('主控年龄')).toHaveValue('26');await page.getByLabel('主控姓名').fill('新剧本主控');
 await page.getByRole('button',{name:'下一步',exact:true}).click();await step3(page);await page.getByLabel('开场场景').fill('清晨抵达陌生城市。');
 await page.getByRole('button',{name:'上一步',exact:true}).click();await expect(page.locator('.wizard-character input')).toBeChecked();await page.getByRole('button',{name:'下一步',exact:true}).click();await expect(page.getByLabel('开场场景')).toHaveValue('清晨抵达陌生城市。');
 await page.reload();await expect(page.getByLabel('开场场景')).toHaveValue('清晨抵达陌生城市。');await page.getByRole('button',{name:'确认开局'}).click();await expect(page.getByRole('button',{name:'重试生成开场'})).toBeVisible();await expect(page.getByText(/生成失败或请求状态待确认/)).toBeVisible();
 const after=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return {counts:await Promise.all(db.tables.map(async t=>[t.name,await t.count()])),name:(await db.themes.get('global'))!.userIdentities!.daily.name,version:db.verno};});for(const [name,count] of before){const next=after.counts.find(([n])=>n===name)?.[1] as number;if(name==='worlds'||name==='worldProfiles'||name==='storySessions')expect(next).toBe(Number(count)+1);else expect(next).toBe(count);}expect(after.name).toBe('原主控');expect(after.version).toBe(7);expect(calls).toBe(0);
});
test('本地文件导入校验，不覆盖世界；无效文件保持草稿',async({page})=>{
 await open(page);await page.getByLabel('整体剧情梗概',{exact:true}).fill('原草稿');page.on('dialog',d=>d.accept());
 await page.getByLabel('剧情文件').setInputFiles({name:'story.md',mimeType:'text/markdown',buffer:Buffer.from('导入的剧情梗概')});await expect(page.getByLabel('整体剧情梗概',{exact:true})).toHaveValue('导入的剧情梗概');
 await page.getByLabel('剧情文件').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":1,"synopsis":"新内容","worlds":[]}')});await expect(page.getByRole('alert')).toContainText('JSON');await expect(page.getByLabel('整体剧情梗概',{exact:true})).toHaveValue('导入的剧情梗概');
 expect(await page.evaluate(async()=>await(await import('/src/store.ts')).db.worlds.count())).toBe(0);
});
test('跨标签页草稿冲突保留输入，不静默覆盖；损坏草稿不覆盖',async({page})=>{
 await open(page);await page.getByLabel('故事标题',{exact:true}).fill('本页标题');
 const remote=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {wizardDraftKey}=await import('/src/scriptWizardDraft.ts');const key=wizardDraftKey(db.name),draft=JSON.parse(localStorage.getItem(key)!);draft.title='其他页面标题';const raw=JSON.stringify(draft);localStorage.setItem(key,raw);return raw;});
 await page.getByLabel('故事标题',{exact:true}).fill('本页保留输入');await expect(page.getByRole('alert')).toContainText('另一页面');await expect(page.getByLabel('故事标题',{exact:true})).toHaveValue('本页保留输入');
 expect(await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return localStorage.getItem((await import('/src/scriptWizardDraft.ts')).wizardDraftKey(db.name));})).toBe(remote);
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts');localStorage.setItem((await import('/src/scriptWizardDraft.ts')).wizardDraftKey(db.name),'broken');});await page.reload();await expect(page.getByRole('alert')).toContainText('无法读取草稿');
});
test('草稿校验、JSON 文件协议与静态身份字段白名单',async({page})=>{
 await open(page);const result=await page.evaluate(async()=>{const m=await import('/src/scriptWizardDraft.ts');let rejected=0;for(const value of [{}, {...m.newWizardDraft(),step:99},{...m.newWizardDraft(),characterIds:['c','c']}])try{m.validateWizardDraft(value);}catch{rejected++;}
 const copy=m.copyWizardIdentity({name:'名字',bio:'简介',customSetting:'设定',chat:'不复制',apiKey:'不复制',memory:'不复制'} as any);
 const parsed=m.parseWizardFile('story.json',JSON.stringify({version:1,title:'标题',synopsis:'梗概',rules:'规则'}));return {rejected,copy,parsed};});expect(result.rejected).toBe(3);expect(result.copy).not.toHaveProperty('chat');expect(result.copy).not.toHaveProperty('apiKey');expect(result.copy).not.toHaveProperty('memory');expect(result.parsed).toEqual({title:'标题',synopsis:'梗概',rules:'规则'});
});
for(const width of [375,390,430])test(`移动向导输入与局部滚动 ${width}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:844});await open(page);await page.screenshot({path:testInfo.outputPath(`wizard-${width}-settings.png`)});for(const el of await page.locator('.script-wizard input:not([hidden]),.script-wizard textarea,.script-wizard select').all())expect(await el.evaluate(n=>parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(16);
 await step1(page);await step2(page);await step3(page);await page.getByLabel('开场场景').fill('待确认开场');await page.setViewportSize({width,height:440});await page.getByLabel('开场场景').focus();await expect(page.getByLabel('开场场景')).toBeFocused();await expect(page.getByLabel('开场场景')).toHaveValue('待确认开场');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width,height:844});await expect(page.getByRole('button',{name:'确认开局'})).toBeInViewport();await page.screenshot({path:testInfo.outputPath(`wizard-${width}-review.png`)});
});
test('自定义主控与角色草稿不创建实体；已失效角色引用阻止确认',async({page})=>{
 await open(page);await step1(page);await expect(page.getByLabel('主控姓名')).toHaveValue('');await page.getByLabel('主控姓名').fill('自定义主控');await page.getByRole('button',{name:'下一步',exact:true}).click();
 await page.getByRole('button',{name:'＋ 自定义角色',exact:true}).click();await page.getByLabel('角色1姓名').fill('草稿角色');await page.getByLabel('角色1人设').fill('独立人设');await page.getByRole('button',{name:'下一步',exact:true}).click();await expect(page.locator('.wizard-summary')).toContainText('草稿角色');
 expect(await page.evaluate(async()=>await(await import('/src/store.ts')).db.characters.count())).toBe(1);
 await page.getByRole('button',{name:'上一步',exact:true}).click();await page.locator('.wizard-character input').check();await page.evaluate(async()=>{const {db,usePhone}=await import('/src/store.ts');await db.characters.delete('existing');await usePhone.getState().reload();});
 await page.getByRole('button',{name:'下一步',exact:true}).click();await expect(page.getByRole('alert')).toContainText('已被移除');await page.getByRole('button',{name:'移除已失效的角色引用'}).click();await page.getByRole('button',{name:'下一步',exact:true}).click();await expect(page.getByLabel('开场场景')).toBeVisible();
});
test('World 身份仅复制静态字段，Daily/World 聊天及旧世界数据不变',async({page})=>{
 await open(page);await step1(page);
 const before=await page.evaluate(async()=>{const {db,usePhone}=await import('/src/store.ts');await db.worlds.put({id:'source',name:'来源世界',description:'旧世界',createdAt:1});await db.worldProfiles.put({id:'profile',worldId:'source',characterId:'existing',setting:'世界角色设定'});
 const {getConversation}=await import('/src/chatService.ts');const daily=await getConversation('existing'),world=await getConversation('existing','source');await db.messages.bulkPut([{id:'daily-msg',conversationId:daily.id,role:'user',content:'不复制的日常聊天',createdAt:1},{id:'world-msg',conversationId:world.id,role:'user',content:'不复制的世界聊天',createdAt:2}]);
 const theme=(await db.themes.get('global'))!;await db.themes.update('global',{userIdentities:{...theme.userIdentities,'world:source':{name:'世界主控',bio:'静态简介',customSetting:'静态补充'}}});await usePhone.getState().reload();
 return JSON.stringify(await Promise.all(db.tables.map(async t=>[t.name,await t.toArray()])));
 });
 await page.getByLabel('主控资料来源').selectOption('world:source');await expect(page.getByLabel('主控姓名')).toHaveValue('世界主控');await page.getByLabel('主控姓名').fill('新草稿身份');
 const after=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return {snapshot:JSON.stringify(await Promise.all(db.tables.map(async t=>[t.name,await t.toArray()]))),draft:localStorage.getItem((await import('/src/scriptWizardDraft.ts')).wizardDraftKey(db.name))!};});
 expect(after.snapshot).toBe(before);expect(after.draft).not.toContain('不复制的日常聊天');expect(after.draft).not.toContain('不复制的世界聊天');expect(after.draft).not.toContain('世界角色设定');
});
