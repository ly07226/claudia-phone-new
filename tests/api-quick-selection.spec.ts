import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
async function seed(page:Page,database='api-quick-'+crypto.randomUUID()){
 await isolatedApp(page,database);
 return page.evaluate(async()=>{
  const {db,usePhone}=await import('/src/store.ts');const {getConversation}=await import('/src/chatService.ts');
  const base={enabled:true,isDefault:false,createdAt:1,updatedAt:1};
  await db.apiConfigs.bulkPut([
   {...base,id:'a',name:'主用连接',provider:'openai',baseUrl:'https://quick-a.test/v1',model:'model-a',temperature:.8,maxTokens:1100,isDefault:true},
   {...base,id:'b',name:'备用连接',provider:'gemini',baseUrl:'https://quick-b.test/v1beta',model:'model-b',temperature:.2,maxTokens:2200,createdAt:2},
   {...base,id:'bad',name:'缺少模型',provider:'openai-compatible',baseUrl:'https://quick-invalid.test/v1',model:'',temperature:.7,maxTokens:100,createdAt:3},
   {...base,id:'disabled',name:'停用连接',provider:'openai-compatible',baseUrl:'https://quick-disabled.test/v1',model:'mock',temperature:.7,maxTokens:100,enabled:false,createdAt:4},
  ]);
  await db.apiCredentials.bulkPut([{configId:'a',apiKey:'synthetic-quick-key-a'},{configId:'b',apiKey:'synthetic-quick-key-b'},{configId:'bad',apiKey:'synthetic-quick-key-bad'},{configId:'disabled',apiKey:'synthetic-quick-key-disabled'}]);
  await db.characters.bulkPut([{id:'one',name:'默认角色甲',persona:'原有角色资料'},{id:'two',name:'默认角色乙',persona:'原有角色资料'},{id:'bound',name:'独立绑定角色',persona:'原有角色资料',apiConfigId:'a'}]);
  const cs=[await getConversation('one'),await getConversation('two'),await getConversation('bound')];
  await usePhone.getState().reload();usePhone.getState().set({activeApp:'AI / API 设置'});
  return cs.map(c=>c.id);
 });
}
const radio=(page:Page,name:string)=>page.getByRole('radio',{name:`全局默认：${name}`,exact:true});
async function snapshot(page:Page){return page.evaluate(async()=>{const {db}=await import('/src/store.ts');return {configs:await db.apiConfigs.orderBy('id').toArray(),credentials:await db.apiCredentials.orderBy('configId').toArray(),characters:await db.characters.orderBy('id').toArray(),conversations:await db.conversations.orderBy('id').toArray()};});}
for(const width of [390,430])test(`列表单选、使用中、刷新与独立绑定不变；保留编辑入口 ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await seed(page);const before=await snapshot(page);
 await expect(radio(page,'主用连接')).toBeChecked();await expect(page.locator('.api-choice-caption')).toHaveCount(1);await expect(page.locator('.api-selection-scope')).toContainText('全局默认');
 await radio(page,'备用连接').click();await expect(radio(page,'备用连接')).toBeChecked();await expect(radio(page,'主用连接')).not.toBeChecked();await expect(page.locator('input[name=current-api]:checked')).toHaveCount(1);await expect(page.locator('[data-api-id=b]')).toContainText('使用中');await expect(page.locator('.api-settings form')).toHaveCount(0);
 const after=await snapshot(page);expect(after.credentials).toEqual(before.credentials);expect(after.characters).toEqual(before.characters);expect(after.conversations).toEqual(before.conversations);expect(after.configs.map(c=>({...c,isDefault:false}))).toEqual(before.configs.map(c=>({...c,isDefault:false})));
 const box=await radio(page,'备用连接').boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('body').innerText()).not.toContain('synthetic-quick-key');await page.screenshot({path:info.outputPath(`api-quick-${width}.png`)});
 await page.reload();await expect(page.locator('.desktop')).toBeVisible();await page.evaluate(async()=>{(await import('/src/store.ts')).usePhone.getState().set({activeApp:'AI / API 设置'});});await expect(radio(page,'备用连接')).toBeChecked();await expect(page.locator('input[name=current-api]:checked')).toHaveCount(1);
 await page.getByRole('button',{name:'编辑 备用连接',exact:true}).click();await expect(page.getByLabel('API Key',{exact:true})).toHaveAttribute('type','password');await expect(page.getByLabel('Model',{exact:true})).toHaveValue('model-b');await page.getByRole('button',{name:'取消',exact:true}).click();await expect(radio(page,'备用连接')).toBeChecked();
});

test('切换后新请求完整使用Gemini配置；已发出OpenAI请求不受影响、历史不重写',async({page})=>{
 const ids=await seed(page);let oldBody:any,newBody:any,oldHeader:any,newHeader:any,oldUrl='',newUrl='',release:()=>void=()=>{},oldCalls=0,newCalls=0;
 await page.route('https://quick-a.test/**',async r=>{oldCalls++;oldUrl=r.request().url();oldBody=r.request().postDataJSON();oldHeader=r.request().headers();await new Promise<void>(resolve=>release=resolve);await r.fulfill({json:{choices:[{message:{content:'旧请求完成'}}]}});});
 await page.route('https://quick-b.test/**',r=>{newCalls++;newUrl=r.request().url();newBody=r.request().postDataJSON();newHeader=r.request().headers();return r.fulfill({json:{candidates:[{content:{parts:[{text:'新请求完成'}]}}]}});});
 await page.evaluate(async id=>{const {sendMessage}=await import('/src/chatService.ts');(window as any).__oldRequest=sendMessage(id,'旧配置发送的消息');},ids[0]);await expect.poll(()=>oldCalls).toBe(1);
 await radio(page,'备用连接').click();await expect(radio(page,'备用连接')).toBeChecked();
 await page.evaluate(async id=>{await(await import('/src/chatService.ts')).sendMessage(id,'新配置发送的消息');},ids[1]);
 expect(newCalls).toBe(1);expect(newUrl).toBe('https://quick-b.test/v1beta/models/model-b:generateContent');expect(newHeader['x-goog-api-key']).toBe('synthetic-quick-key-b');expect(newBody.generationConfig).toEqual({temperature:.2,maxOutputTokens:2200});expect(newBody.contents.at(-1).parts[0].text).toBe('新配置发送的消息');
 expect(oldUrl).toBe('https://quick-a.test/v1/chat/completions');expect(oldHeader.authorization).toBe('Bearer synthetic-quick-key-a');expect(oldBody).toMatchObject({model:'model-a',temperature:.8,max_completion_tokens:1100});expect(oldBody.messages.at(-1).content).toBe('旧配置发送的消息');release();await page.evaluate(async()=>{await(window as any).__oldRequest;});
 const messages=await page.evaluate(async ids=>{const {db}=await import('/src/store.ts');return Promise.all(ids.slice(0,2).map(id=>db.messages.where('conversationId').equals(id).sortBy('createdAt')));},ids);expect(messages[0].map(m=>m.content)).toEqual(['旧配置发送的消息','旧请求完成']);expect(messages[1].map(m=>m.content)).toEqual(['新配置发送的消息','新请求完成']);expect(oldCalls).toBe(1);
});

test('全局切换不覆盖会话/角色独立绑定，实际优先级不变',async({page})=>{
 const ids=await seed(page);const wire:string[]=[];await page.route(/^https:\/\/quick-[ab]\.test\//,r=>{const gemini=r.request().url().includes('quick-b');wire.push(gemini?'b':'a');return r.fulfill({json:gemini?{candidates:[{content:{parts:[{text:'模拟回复'}]}}]}:{choices:[{message:{content:'模拟回复'}}]}});});await radio(page,'备用连接').click();await expect(radio(page,'备用连接')).toBeChecked();
 const r=await page.evaluate(async ids=>{const {db}=await import('/src/store.ts');const {resolveApi}=await import('/src/chatService.ts');await db.conversations.update(ids[0],{apiConfigId:'a'});const values=[];for(const id of ids)values.push((await resolveApi((await db.conversations.get(id))!)).config.id);return values;},ids);
 expect(r).toEqual(['a','b','a']);await page.evaluate(async ids=>{const {sendMessage}=await import('/src/chatService.ts');for(const id of ids)await sendMessage(id,'验证独立绑定');},ids);expect(wire).toEqual(['a','b','a']);
});

for(const name of ['缺少模型','停用连接'])test(`无效配置不虚假切换、不改变密钥或当前默认：${name}`,async({page})=>{
 await seed(page);const before=await snapshot(page);await radio(page,name).click();await expect(page.getByRole('alert')).toContainText('无法切换');await expect(radio(page,'主用连接')).toBeChecked();await expect(radio(page,name)).not.toBeChecked();await expect(page.locator('input[name=current-api]:checked')).toHaveCount(1);expect(await snapshot(page)).toEqual(before);expect(await page.locator('body').innerText()).not.toContain('synthetic-quick-key');
});

test('选择事务写入失败全部回滚，多窗口并发始终只有一个默认且列表同步',async({page,context})=>{
 const database='api-quick-tabs-'+crypto.randomUUID();await seed(page,database);const failed=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {selectApiDefault}=await import('/src/apiSelection.ts');const before=await db.apiConfigs.toArray();const update=db.apiConfigs.update.bind(db.apiConfigs);(db.apiConfigs as any).update=async()=>{throw Error('synthetic-storage-error');};let rejected=false;try{await selectApiDefault('b');}catch{rejected=true;}finally{db.apiConfigs.update=update;}return {rejected,before,after:await db.apiConfigs.toArray()};});expect(failed.rejected).toBe(true);expect(failed.after).toEqual(failed.before);
 const other=await context.newPage();await other.addInitScript(name=>{const open=indexedDB.open.bind(indexedDB);indexedDB.open=(n,v)=>open(n==='claudia-phone'?name:n,v);},database);await other.goto('/');await other.waitForFunction(async()=>(await import('/src/store.ts')).usePhone.getState().ready);await other.evaluate(async()=>{(await import('/src/store.ts')).usePhone.getState().set({activeApp:'AI / API 设置'});});await expect(radio(other,'主用连接')).toBeChecked();await radio(page,'备用连接').click();await expect(radio(other,'备用连接')).toBeChecked();
 await page.evaluate(async()=>{const {selectApiDefault}=await import('/src/apiSelection.ts');await Promise.all([selectApiDefault('a'),selectApiDefault('b')]);});const defaults=await page.evaluate(async()=>(await(await import('/src/store.ts')).db.apiConfigs.toArray()).filter(c=>c.isDefault).map(c=>c.id));expect(defaults).toHaveLength(1);await expect(page.locator('input[name=current-api]:checked')).toHaveCount(1);await expect(other.locator('input[name=current-api]:checked')).toHaveCount(1);await expect(radio(page,defaults[0]==='a'?'主用连接':'备用连接')).toBeChecked();await other.close();
});

test('缺密钥、不安全URL、参数或协议无效均在事务中拒绝，保留原选择',async({page})=>{
 await seed(page);
 const results=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');const {selectApiDefault}=await import('/src/apiSelection.ts');const target=(await db.apiConfigs.get('b'))!,credential=(await db.apiCredentials.get('b'))!;const patches=[{baseUrl:'http://insecure.test/v1'},{temperature:-1},{maxTokens:0},{provider:'custom',protocol:'unsupported' as const},{provider:'not-supported'},{model:''}];const results=[];
  for(const patch of [...patches,{}]){await db.apiConfigs.put({...target,...patch});if(Object.keys(patch).length===0)await db.apiCredentials.delete('b');const before=JSON.stringify([await db.apiConfigs.toArray(),await db.apiCredentials.toArray()]);let refused=false;try{await selectApiDefault('b');}catch{refused=true;}results.push({refused,unchanged:before===JSON.stringify([await db.apiConfigs.toArray(),await db.apiCredentials.toArray()]),defaults:(await db.apiConfigs.toArray()).filter(c=>c.isDefault).map(c=>c.id)});await db.apiCredentials.put(credential);}
  return results;
 });
 expect(results).toHaveLength(7);for(const r of results)expect(r).toEqual({refused:true,unchanged:true,defaults:['a']});
});
