import { test, expect, type Page } from "@playwright/test";
async function ready(page:Page){await page.waitForFunction(async()=>{const {useSpaces}=await import("/src/spaces.ts");const {usePhone}=await import("/src/store.ts");return usePhone.getState().ready&&useSpaces.getState().booted&&!useSpaces.getState().transitioning;});}
async function data(page:Page) {
 await page.goto('/');await ready(page);await page.evaluate(async()=>{
  const {db,usePhone}=await import('/src/store.ts');const {getConversation}=await import('/src/chatService.ts');
  await db.characters.bulkPut([{id:'alpha',name:'Alpha 角色',persona:''},{id:'beta',name:'Beta 角色',persona:''},{id:'empty',name:'没有记录角色',persona:''}]);
  await db.worlds.put({id:'identity-world',name:'用户自建世界',description:'',createdAt:1});await db.worldProfiles.put({id:'identity-profile',worldId:'identity-world',characterId:'alpha',setting:''});
  const a=await getConversation('alpha'),b=await getConversation('beta'),w=await getConversation('alpha','identity-world');
  await db.messages.bulkPut([{id:'u-alpha',conversationId:a.id,role:'user',content:'用户原文',createdAt:1},{id:'a-alpha',conversationId:a.id,role:'assistant',content:'OriginalHidden',activeVariantId:'selected',createdAt:2},{id:'archived',conversationId:a.id,role:'assistant',content:'ArchiveSecret',archived:true,createdAt:99},{id:'u-beta',conversationId:b.id,role:'user',content:'Beta last preview',createdAt:3},{id:'u-world',conversationId:w.id,role:'user',content:'WorldOnlyNeedle',createdAt:4}]);
  await db.messageVariants.put({id:'selected',messageId:'a-alpha',conversationId:a.id,content:'LastNeedle reply。',createdAt:2});
  await usePhone.getState().reload();
 });
}
async function settings(page:Page){await ready(page);await page.getByRole('button',{name:'设置',exact:true}).click();}
async function chat(page:Page){await ready(page);await page.evaluate(async()=>(await import('/src/store.ts')).usePhone.getState().set({activeApp:'聊天'}));}
async function picture(page:Page,w:number,h:number){const png=await page.evaluate(({w,h})=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d')!;x.fillStyle='#adbea5';x.fillRect(0,0,w,h);x.fillStyle='#fff7e5';x.beginPath();x.arc(w/2,h/2,Math.min(w,h)*.3,0,Math.PI*2);x.fill();return c.toDataURL().split(',')[1];},{w,h});return {name:'identity.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};}
for(const width of [375,390,430]) {
 test(`用户身份 ${width}px：旧字段、头像、取消、刷新、聊天同步与世界隔离`,async({page})=>{
  await page.setViewportSize({width,height:844});await data(page);
  await page.evaluate(async()=>{const {db,usePhone}=await import('/src/store.ts');await db.themes.update('global',{userIdentities:{daily:{name:'旧用户',bio:'旧简介',customSetting:'旧设定',gender:'女',age:28,occupation:'研究员',extra:{keep:true}}}});await usePhone.getState().reload();});
  await settings(page);await expect(page.locator('.identity-card')).toContainText('旧用户');
  await page.getByRole('button',{name:'编辑用户身份',exact:true}).click();await expect(page.getByLabel('用户自定义设定',{exact:true})).toHaveValue('旧设定');
  await page.getByText('更多资料',{exact:true}).click();await expect(page.getByLabel('用户年龄',{exact:true})).toHaveValue('28');
  await page.getByLabel('用户名字',{exact:true}).fill('新的名字');await page.getByLabel('用户简介',{exact:true}).fill('长简介\n'.repeat(30));await page.getByLabel('用户自定义设定',{exact:true}).fill('用户自定义设定\n'.repeat(50));
  for(const [shape,w,h] of [['portrait',80,320],['landscape',320,80]] as const){
   await page.getByLabel('用户头像文件',{exact:true}).setInputFiles(await picture(page,w,h));await expect(page.getByRole('button',{name:'保存用户身份',exact:true})).toBeEnabled();
   const bounds=await page.locator('.identity-picker .identity-avatar').evaluate(el=>{const r=el.getBoundingClientRect(),i=el.querySelector('img')!.getBoundingClientRect();return {w:r.width,h:r.height,inside:i.left>=r.left&&i.right<=r.right&&i.top>=r.top&&i.bottom<=r.bottom};});
   expect(Math.abs(bounds.w-96)).toBeLessThan(1);expect(Math.abs(bounds.h-96)).toBeLessThan(1);expect(bounds.inside).toBe(true);
   await page.screenshot({animations:"disabled",path:`artifacts/identity-${width}-${shape}.png`});
  }
  await page.setViewportSize({width,height:460});await page.getByRole('button',{name:'保存用户身份',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'保存用户身份',exact:true})).toBeInViewport();await page.setViewportSize({width,height:844});
  await page.getByRole('button',{name:'保存用户身份',exact:true}).click();await expect(page.locator('.identity-card')).toContainText('新的名字');
  const saved=await page.evaluate(async()=>((await(await import('/src/store.ts')).db.themes.get('global'))!.userIdentities!.daily));expect(saved).toMatchObject({name:'新的名字',bio:'长简介\n'.repeat(30),customSetting:'用户自定义设定\n'.repeat(50),gender:'女',age:28,occupation:'研究员',extra:{keep:true}});
  const cardAvatar=await page.locator('.identity-card .identity-avatar').boundingBox();expect(Math.abs(cardAvatar!.width-60)).toBeLessThan(1);expect(Math.abs(cardAvatar!.height-60)).toBeLessThan(1);
  expect(await page.locator('.identity-card-info > span').evaluate(el=>el.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)*2+1)).toBe(true);
  await page.screenshot({animations:"disabled",path:`artifacts/identity-card-${width}.png`});
  await page.getByRole('button',{name:'编辑用户身份',exact:true}).click();await page.getByLabel('用户名字',{exact:true}).fill('取消的名字');await page.getByRole('button',{name:'移除头像',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.identity-card img')).toHaveCount(1);
  await page.reload();await settings(page);await expect(page.locator('.identity-card')).toContainText('新的名字');
  const before=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return {messages:await db.messages.toArray(),variants:await db.messageVariants.toArray()};});
  await chat(page);await page.locator('.chat-list-row').first().click();await expect(page.locator('.chat-avatar-user img')).toHaveCount(1);
  await page.screenshot({animations:"disabled",path:`artifacts/identity-chat-${width}.png`});
  await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {saveIdentity,identityFor}=await import('/src/userIdentity.ts');await saveIdentity('daily',{...identityFor((await db.themes.get('global'))!,'daily'),avatar:undefined});});
  await expect(page.locator('.chat-avatar-user img')).toHaveCount(0);
  await page.evaluate(async()=>{const {useSpaces}=await import('/src/spaces.ts');const {usePhone}=await import('/src/store.ts');await useSpaces.getState().enterSpace('world:identity-world');usePhone.getState().set({activeApp:'聊天'});});
  await page.locator('.chat-list-row').first().click();await expect(page.locator('.chat-avatar-user img')).toHaveCount(0);await expect(page.locator('.chat-avatar-user')).toHaveAttribute('aria-label','你头像');
  expect(await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return {messages:await db.messages.toArray(),variants:await db.messageVariants.toArray()};})).toEqual(before);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
 test(`聊天搜索 ${width}px：姓名、当前版本预览、清空、无结果、不跨世界`,async({page})=>{
  await page.setViewportSize({width,height:844});await data(page);await chat(page);
  await expect(page.locator('.chat-list-row')).toHaveCount(3);await expect(page.locator('.chat-space')).toHaveCount(0);
  await expect(page.locator('.chat-list-title')).toHaveCSS('font-size','32px');
  const input=page.getByRole('searchbox',{name:'搜索聊天',exact:true});
  await expect(page.locator('.chat-list-row').first()).toContainText('LastNeedle');
  await expect(page.locator('.chat-list-row').nth(1)).toContainText('Beta last preview');
  const original=await page.locator('.chat-list-row').allTextContents();
  await page.screenshot({animations:"disabled",path:`artifacts/chat-search-${width}.png`});
  await input.fill('ALPHA');await expect(page.locator('.chat-list-row')).toHaveCount(1);
  await input.fill('lastneedle');await expect(page.locator('.chat-list-row')).toHaveCount(1);await page.screenshot({animations:"disabled",path:`artifacts/chat-search-result-${width}.png`});
  for(const query of ['WorldOnlyNeedle','ArchiveSecret','OriginalHidden']){await input.fill(query);await expect(page.locator('.chat-list-row')).toHaveCount(0);await expect(page.getByText('没有匹配的聊天',{exact:true})).toBeVisible();}
  await page.screenshot({animations:"disabled",path:`artifacts/chat-search-empty-${width}.png`});
  await page.getByRole('button',{name:'清空聊天搜索',exact:true}).click();await expect(page.locator('.chat-list-row')).toHaveCount(3);expect(await page.locator('.chat-list-row').allTextContents()).toEqual(original);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
test('身份备份候选无损、主题保存保留身份、未知旧字段及空间独立，v6/18表',async({page})=>{
 await data(page);
 const result=await page.evaluate(async()=>{
  const {db,usePhone}=await import('/src/store.ts');const {saveIdentity,identityFor}=await import('/src/userIdentity.ts');const {createBackup,readBackup}=await import('/src/backupService.ts');
  const stale={...usePhone.getState().theme};await db.assets.put({id:'identity-backup',type:'avatar',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',createdAt:1});await saveIdentity('daily',{avatar:'identity-backup',name:'日常身份',bio:'简介',customSetting:'设定',gender:'女',age:30,occupation:'作者',extra:{keep:true}});await saveIdentity('world:identity-world',{name:'剧本身份',bio:'世界简介',customSetting:'世界设定'});
  await usePhone.getState().saveTheme({...stale,color:'#aabbcc'});const expected=(await db.themes.get('global'))!.userIdentities;
  const exported=await createBackup({closedOtherClients:true});const m=exported.manifest;const files=[new File([JSON.stringify(m)],`${m.backupId}.manifest.json`,{type:'application/json'})];for(const part of m.parts)files.push(new File([await exported.readPart(part.index)],part.name));
  const restored=await readBackup(files,{mode:'rehearse'});const D=Object.getPrototypeOf(db.constructor),candidate=new D(restored.report.candidateName!);candidate.version(7).stores(Object.fromEntries(db.tables.map(t=>[t.name,[t.schema.primKey.src,...t.schema.indexes.map(i=>i.src)].join(',')])));await candidate.open();const actual=(await candidate.table('themes').get('global')).userIdentities;const restoredAvatar=await candidate.table('assets').get('identity-backup');const sourceAvatar=await db.assets.get('identity-backup');candidate.close();await restored.dispose();await exported.dispose();
  return {expected,actual,restoredAvatar,sourceAvatar,version:db.verno,tables:db.tables.length,daily:identityFor((await db.themes.get('global'))!,'daily').name,world:identityFor((await db.themes.get('global'))!,'world:identity-world').name,report:restored.report.status};
 });
 expect(result.actual).toEqual(result.expected);expect(result.restoredAvatar).toEqual(result.sourceAvatar);expect(result.version).toBe(7);expect(result.tables).toBe(20);expect(result.daily).toBe('日常身份');expect(result.world).toBe('剧本身份');expect(result.report).toBe('rehearsed');
});
test('Enter组合状态纯函数：Safari尾随Enter、229、候选确认、独立按键及Shift',async({page})=>{
 await page.goto('/');const results=await page.evaluate(async()=>{const {createEnterSendGuard}=await import('/src/enterSend.ts');let clock=0;const g=createEnterSendGuard(()=>clock),out=[];g.start();out.push(g.key({key:'Enter',isComposing:true}));g.end();out.push(g.key({key:'Enter'}));g.up('Enter');out.push(g.key({key:'Enter'}));out.push(g.key({key:'Enter',shiftKey:true}));g.reset();g.end();out.push(g.key({key:'Enter'}));clock+=100;out.push(g.key({key:'Enter'}));out.push(g.key({key:'Enter',keyCode:229}));out.push(g.key({key:'Enter',repeat:true}));g.reset();g.start();g.key({key:'Enter',isComposing:true});g.end();clock+=100;out.push(g.key({key:'Enter'}));return out;});expect(results).toEqual(['compose','block','send','normal','block','send','compose','block','send']);
});
test('Enter与按钮复用发送、Shift换行、IME确认不误发、空白与并发不重复',async({page})=>{
 await data(page);await page.evaluate(async()=>{const {db}=await import('/src/store.ts');await db.apiConfigs.put({id:'typing-api',name:'模拟',provider:'openai-compatible',baseUrl:'https://typing.example.test/v1',model:'mock',temperature:.7,maxTokens:100,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'typing-api',apiKey:'synthetic-typing-fixture'});});
 let count=0,release:()=>void=()=>{};await page.route('https://typing.example.test/**',async r=>{count++;if(count===1)await new Promise<void>(resolve=>{release=resolve;});await r.fulfill({json:{choices:[{message:{content:'模拟回复。'}}]}});});
 await chat(page);await page.locator('.chat-list-row').first().click();const input=page.getByLabel('聊天消息',{exact:true});await input.fill('   ');await input.press('Enter');expect(count).toBe(0);
 await input.fill('第一行');await input.press('Shift+Enter');await expect(input).toHaveValue('第一行\n');expect(count).toBe(0);
 await input.fill('中文候选确认');await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});await input.dispatchEvent('compositionend');await input.dispatchEvent('keydown',{key:'Enter',isComposing:false});await input.dispatchEvent('keyup',{key:'Enter'});expect(count).toBe(0);
 await input.press('Enter');await expect.poll(()=>count).toBe(1);await input.dispatchEvent('keydown',{key:'Enter'});expect(count).toBe(1);release();await expect(input).toBeEnabled();
 await input.fill('按钮发送');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>count).toBe(2);await expect(input).toBeEnabled();
 const users=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return (await db.messages.toArray()).filter(m=>m.role==='user').map(m=>m.content);});expect(users.filter(t=>t==='中文候选确认')).toHaveLength(1);expect(users.filter(t=>t==='按钮发送')).toHaveLength(1);
});
