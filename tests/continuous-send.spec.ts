import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
async function setup(page:Page){
  await isolatedApp(page,'continuous-test-'+crypto.randomUUID());
  return page.evaluate(async()=>{
    const {db,usePhone}=await import('/src/store.ts');
    await db.characters.bulkAdd([{id:'a',name:'连续角色',persona:''},{id:'b',name:'其他角色',persona:''}]);
    await db.apiConfigs.add({id:'api',name:'模拟配置',provider:'openai-compatible',baseUrl:'https://continuous.test/v1',model:'mock',enabled:true,isDefault:true,temperature:.7,maxTokens:100,createdAt:1,updatedAt:1});
    await db.apiCredentials.add({configId:'api',apiKey:'synthetic-fixture-only'});
    await usePhone.getState().reload();
    const {getConversation}=await import('/src/chatService.ts');return {a:await getConversation('a'),b:await getConversation('b')};
  });
}
test('设置独立持久化；三条即时保存零请求，手动回复一次读取全部；失焦不误触',async({page})=>{
  const {a,b}=await setup(page);let requests:any[]=[];
  await page.route('https://continuous.test/**',async r=>{requests.push(r.request().postDataJSON());await r.fulfill({json:{choices:[{message:{content:'收到全部消息'}}]}});});
  await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'连续角色 开始 / 继续聊天'}).click();
  await page.getByRole('button',{name:'会话管理',exact:true}).click();await page.getByRole('switch',{name:'连续发送模式'}).click();await expect(page.getByRole('switch',{name:'连续发送模式'})).toBeChecked();await page.getByRole('button',{name:'返回聊天',exact:true}).click();
  for(const text of ['第一条','第二条','第三条']){await page.getByLabel('聊天消息',{exact:true}).fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByLabel('聊天消息',{exact:true})).toBeEnabled();await expect(page.locator('.chat-history')).toContainText(text);}
  await page.getByLabel('聊天消息',{exact:true}).blur();expect(requests).toHaveLength(0);
  await page.getByRole('button',{name:'AI 回复',exact:true}).evaluate(el=>{(el as HTMLButtonElement).click();(el as HTMLButtonElement).click();});
  await expect(page.locator('.chat-history')).toContainText('收到全部消息');expect(requests).toHaveLength(1);
  expect(requests[0].messages.filter((m:any)=>m.role==='user').map((m:any)=>m.content)).toEqual(['第一条','第二条','第三条']);await expect(page.getByRole('button',{name:'AI 回复',exact:true})).toBeDisabled();
  await page.reload();const state=await page.evaluate(async({a,b})=>{const {db}=await import('/src/store.ts');return {a:(await db.conversations.get(a.id))?.chatSettings?.continuousSend,b:(await db.conversations.get(b.id))?.chatSettings?.continuousSend,m:await db.messages.where('conversationId').equals(a.id).count()};},{a,b});expect(state).toEqual({a:true,b:undefined,m:4});
});
test('关闭保持发送即回复；跨会话隔离，失败可重试且并发仅一轮',async({page})=>{
  const {a,b}=await setup(page);let requests:any[]=[];
  await page.route('https://continuous.test/**',async r=>{requests.push(r.request().postDataJSON());await r.fulfill({json:{choices:[{message:{content:'正常回复'}}]}});});
  await page.evaluate(async({a,b})=>{const {saveChatSettings}=await import('/src/chatPreferences.ts');const {queueUserMessage,sendMessage}=await import('/src/chatService.ts');await saveChatSettings(a.id,{continuousSend:true});await queueUserMessage(a.id,'A私有');await sendMessage(b.id,'B私有');},{a,b});expect(requests).toHaveLength(1);expect(JSON.stringify(requests[0])).not.toContain('A私有');
  const result=await page.evaluate(async({a})=>{const {sendMessage}=await import('/src/chatService.ts');const results=await Promise.allSettled([sendMessage(a.id,'',undefined,true),sendMessage(a.id,'',undefined,true)]);return results.map(r=>r.status);},{a});expect(result.sort()).toEqual(['fulfilled','rejected']);expect(requests).toHaveLength(2);expect(JSON.stringify(requests[1])).toContain('A私有');expect(JSON.stringify(requests[1])).not.toContain('B私有');
  await page.route('https://continuous.test/**',r=>r.abort());
  const failed=await page.evaluate(async({a})=>{const {queueUserMessage,sendMessage}=await import('/src/chatService.ts');await queueUserMessage(a.id,'失败后保留');let error=false;try{await sendMessage(a.id,'',undefined,true);}catch{error=true;}const rows=await(await import('/src/messagePath.ts')).activeMessages(a.id);return {error,last:rows.at(-1)?.content};},{a});expect(failed).toEqual({error:true,last:'失败后保留'});
});
test('超过30条待回复不静默截断，超过字符预算拒绝生成且原文保留',async({page})=>{
  const {a}=await setup(page);
  const result=await page.evaluate(async({a})=>{const {db}=await import('/src/store.ts');const {saveChatSettings}=await import('/src/chatPreferences.ts');const {queueUserMessage}=await import('/src/chatService.ts');const {buildContext}=await import('/src/chatContext.ts');await saveChatSettings(a.id,{continuousSend:true});for(let i=0;i<31;i++)await queueUserMessage(a.id,'待回复'+i);const context=await buildContext((await db.conversations.get(a.id))!);for(let i=0;i<4;i++)await queueUserMessage(a.id,'长'.repeat(7000));let error='';try{await buildContext((await db.conversations.get(a.id))!);}catch(e){error=(e as Error).message;}return {users:context.filter(m=>m.role==='user').length,error,count:await db.messages.where('conversationId').equals(a.id).count()};},{a});expect(result.users).toBe(31);expect(result.error).toContain('待回复消息超过');expect(result.count).toBe(35);
});

test('连续点击及触屏发送保持同一输入框焦点；IME、换行和主动失焦不误发',async({page})=>{
  const {a}=await setup(page);let calls=0;
  await page.route('https://continuous.test/**',async r=>{calls++;await r.fulfill({json:{choices:[{message:{content:'手动回复'}}]}});});
  await page.evaluate(async id=>{await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{continuousSend:true});},a.id);
  await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'连续角色 开始 / 继续聊天'}).click();
  const input=page.getByLabel('聊天消息',{exact:true});
  await input.evaluate(el=>{(window as any).__composer=el;(window as any).__composerBlur=0;el.addEventListener('blur',()=>{(window as any).__composerBlur++;});});
  for(const [i,text] of ['一','二','三'].entries()){
    await input.fill(text);
    if(i===1)await page.getByRole('button',{name:'发送',exact:true}).tap();else await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.locator('.chat-history')).toContainText(text);await expect(input).toHaveValue('');await expect(input).toBeFocused();
    expect(await input.evaluate(el=>el===(window as any).__composer&&!el.hasAttribute('disabled')&&(window as any).__composerBlur===0)).toBe(true);
    await expect(page.getByRole('button',{name:'取消请求',exact:true})).toHaveCount(0);
  }
  expect(calls).toBe(0);
  await input.fill('中文候选');await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});await input.dispatchEvent('compositionend');await input.dispatchEvent('keydown',{key:'Enter',isComposing:false});await input.dispatchEvent('keyup',{key:'Enter'});
  await expect(input).toHaveValue('中文候选');
  expect(await page.evaluate(async id=>(await import('/src/store.ts')).db.messages.where('conversationId').equals(id).count(),a.id)).toBe(3);
  await input.press('Enter');await expect(input).toHaveValue('');await expect(input).toBeFocused();await expect(page.locator('.chat-history')).toContainText('中文候选');
  await input.fill('保留手动换行');await input.press('Shift+Enter');await expect(input).toHaveValue('保留手动换行\n');
  await input.fill(' \n');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();await input.press('Enter');await expect(input).toHaveValue(' \n');
  await input.blur();await expect(input).not.toBeFocused();expect(calls).toBe(0);
  await page.getByRole('button',{name:'AI 回复',exact:true}).click();await expect(page.locator('.chat-history')).toContainText('手动回复');expect(calls).toBe(1);
  const texts=await page.evaluate(async id=>(await import('/src/messagePath.ts')).activeMessages(id).then(rows=>rows.filter(m=>m.role==='user').map(m=>m.content)),a.id);expect(texts).toEqual(['一','二','三','中文候选']);
});
