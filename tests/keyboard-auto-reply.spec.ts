import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

async function setup(page:Page){
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{const vv=new EventTarget();Object.assign(vv,{height:844,width:390,offsetTop:0,offsetLeft:0,scale:1});Object.defineProperty(window,'visualViewport',{value:vv,configurable:true});});
  await isolatedApp(page,'keyboard-auto-'+crypto.randomUUID());
  const ids=await page.evaluate(async()=>{const {db,usePhone}=await import('/src/store.ts');await db.characters.bulkAdd([{id:'a',name:'自动角色',persona:''},{id:'b',name:'另一角色',persona:''}]);await db.apiConfigs.add({id:'api',name:'模拟',provider:'openai-compatible',baseUrl:'https://keyboard.test/v1',model:'mock',enabled:true,isDefault:true,temperature:.7,maxTokens:100,createdAt:1,updatedAt:1});await db.apiCredentials.add({configId:'api',apiKey:'synthetic-fixture-only'});await usePhone.getState().reload();const {getConversation}=await import('/src/chatService.ts');const a=await getConversation('a'),b=await getConversation('b');await(await import('/src/chatPreferences.ts')).saveChatSettings(a.id,{continuousSend:true,keyboardAutoReply:true});return {a:a.id,b:b.id};});
  const requests:any[]=[];await page.route('https://keyboard.test/**',async r=>{requests.push(r.request().postDataJSON());await r.fulfill({json:{choices:[{message:{content:'自动回复完成。'}}]}});});
  await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'自动角色 开始 / 继续聊天'}).click();
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  return {ids,requests};
}
async function viewport(page:Page,height:number,extra:Record<string,number>={}){await page.evaluate(({height,extra})=>{Object.assign(visualViewport!,{height,...extra});visualViewport!.dispatchEvent(new Event('resize'));},{height,extra});}
async function openKeyboard(page:Page){const input=page.getByLabel('聊天消息',{exact:true});await input.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',button:0});await input.focus();await viewport(page,400);await page.clock.runFor(20);}
async function send(page:Page,text='待回复消息'){await page.getByLabel('聊天消息',{exact:true}).fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.chat-history')).toContainText(text);await expect(page.getByRole('button',{name:'取消请求',exact:true})).toHaveCount(0);}

test('三条连续发送后无blur收键盘，稳定400ms只回复一次且读取三条消息',async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);
  const input=page.getByLabel('聊天消息',{exact:true});
  await input.evaluate(el=>{(window as any).__input=el;(window as any).__blurs=0;el.addEventListener('blur',()=>{(window as any).__blurs++;});});
  for(const text of ['第一条','第二条','第三条']){
    await send(page,text);await expect(input).toBeFocused();await expect(input).toBeEnabled();await expect(input).toHaveValue('');
    expect(await input.evaluate(el=>el===(window as any).__input&&(window as any).__blurs===0)).toBe(true);
    await page.clock.runFor(700);expect(requests).toHaveLength(0);
  }
  expect(requests).toHaveLength(0);await page.clock.runFor(700);await viewport(page,844);await page.clock.runFor(399);expect(requests).toHaveLength(0);await page.clock.runFor(1);
  await expect.poll(()=>requests.length).toBe(1);await expect(page.locator('.chat-history')).toContainText('自动回复完成。');expect(requests[0].messages.filter((m:any)=>m.role==='user').map((m:any)=>m.content)).toEqual(['第一条','第二条','第三条']);
  for(let i=0;i<3;i++){await viewport(page,844);await page.clock.runFor(500);}expect(requests).toHaveLength(1);
});

test('开关依赖、默认关闭、角色隔离及重新打开后持久化；关闭连续模式不清偏好',async({page})=>{
  const {ids}=await setup(page);await page.getByRole('button',{name:'会话管理',exact:true}).click();
  const continuous=page.getByRole('switch',{name:'连续发送模式',exact:true}),auto=page.getByRole('switch',{name:'收起键盘自动回复',exact:true});
  await expect(auto).toBeChecked();await continuous.click();await expect(continuous).not.toBeChecked();await expect(auto).toBeChecked();await expect(auto).toBeDisabled();await continuous.click();await expect(auto).toBeEnabled();await expect(auto).toBeChecked();
  await page.reload();await expect(page.locator('.desktop')).toBeVisible();await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'自动角色 开始 / 继续聊天'}).click();await page.getByRole('button',{name:'会话管理',exact:true}).click();await expect(auto).toBeChecked();
  await page.getByRole('button',{name:'返回聊天',exact:true}).click();await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.getByRole('button',{name:'另一角色 开始 / 继续聊天'}).click();await page.getByRole('button',{name:'会话管理',exact:true}).click();await expect(auto).not.toBeChecked();await expect(auto).toBeDisabled();
  const saved=await page.evaluate(async({a,b})=>{const {db}=await import('/src/store.ts');return [(await db.conversations.get(a))?.chatSettings?.keyboardAutoReply,(await db.conversations.get(b))?.chatSettings?.keyboardAutoReply];},ids);expect(saved).toEqual([true,undefined]);
});

for(const guard of ['auto-off','continuous-off','no-pending'] as const)test(`未满足条件不回复：${guard}`,async({page})=>{
  const {ids,requests}=await setup(page);await openKeyboard(page);if(guard!=='no-pending')await send(page);
  if(guard!=='no-pending')await page.evaluate(async({id,guard})=>{await(await import('/src/chatPreferences.ts')).saveChatSettings(id,guard==='auto-off'?{keyboardAutoReply:false}:{continuousSend:false});},{id:ids.a,guard});
  await page.clock.runFor(700);await viewport(page,844);await page.clock.runFor(600);expect(requests).toHaveLength(0);
});

test('普通发送保持键盘不触发；手动按钮与快速收键盘候选竞争仅一次',async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);await send(page);await page.clock.runFor(100);expect(requests).toHaveLength(0);
  await viewport(page,844);await page.clock.runFor(200);await page.getByRole('button',{name:'AI 回复',exact:true}).click();await page.clock.runFor(700);await expect.poll(()=>requests.length).toBe(1);await expect(page.locator('.chat-history')).toContainText('自动回复完成。');
  await viewport(page,844);await page.clock.runFor(700);expect(requests).toHaveLength(1);
});

for(const blur of [false,true])test(`发送后立即收键盘不丢周期，延后稳定确认且只生成一次：blur=${blur}`,async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);await send(page);await page.clock.runFor(1);
  if(blur)await page.getByLabel('聊天消息',{exact:true}).blur();
  await viewport(page,844);await page.clock.runFor(400);expect(requests).toHaveLength(0);
  await page.clock.runFor(210);await expect.poll(()=>requests.length).toBe(1);await expect(page.locator('.chat-history')).toContainText('自动回复完成。');
  for(let i=0;i<3;i++){await viewport(page,844);await page.clock.runFor(500);}expect(requests).toHaveLength(1);
});

for(const order of ['before-viewport','after-viewport'] as const)test(`iPhone无目标blur超过600ms仍保留周期，完整关闭后只回复一次：${order}`,async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);await send(page);await page.clock.runFor(700);
  if(order==='before-viewport'){await page.getByLabel('聊天消息',{exact:true}).blur();await page.clock.runFor(500);expect(requests).toHaveLength(0);}
  await viewport(page,844);
  if(order==='after-viewport'){await page.clock.runFor(100);await page.getByLabel('聊天消息',{exact:true}).blur();}
  await page.clock.runFor(500);await expect.poll(()=>requests.length).toBe(1);await expect(page.locator('.chat-history')).toContainText('自动回复完成。');
  for(let i=0;i<3;i++){await viewport(page,844);await page.clock.runFor(500);}expect(requests).toHaveLength(1);
});

test('保留无目标blur不等于放宽视口阈值，恢复不足仍不回复',async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);await send(page);await page.clock.runFor(700);await page.getByLabel('聊天消息',{exact:true}).blur();
  await viewport(page,700);await page.clock.runFor(700);expect(requests).toHaveLength(0);
  await viewport(page,844);await page.clock.runFor(400);await expect.poll(()=>requests.length).toBe(1);
});

test('空白Enter不是发送过程，不能使后续系统blur被永久标为发送失焦',async({page})=>{
  const {ids,requests}=await setup(page);await openKeyboard(page);await send(page);await page.clock.runFor(700);
  await page.getByLabel('聊天消息',{exact:true}).fill(' ');await page.getByLabel('聊天消息',{exact:true}).press('Enter');await page.getByLabel('聊天消息',{exact:true}).blur();
  await viewport(page,844);await page.clock.runFor(400);await expect.poll(()=>requests.length).toBe(1);
  const users=await page.evaluate(async id=>(await(await import('/src/messagePath.ts')).activeMessages(id)).filter(m=>m.role==='user').map(m=>m.content),ids.a);expect(users).toEqual(['待回复消息']);
});

test('保存后blur但没有关闭几何信号不触发；发送按钮目标失焦即使高度恢复也不触发',async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);await send(page);await page.clock.runFor(1);await page.getByLabel('聊天消息',{exact:true}).blur();await page.clock.runFor(700);expect(requests).toHaveLength(0);
  await openKeyboard(page);await send(page,'第二条');
  await page.getByLabel('聊天消息',{exact:true}).evaluate(el=>{el.dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:document.querySelector('.chat-send')}));});
  await viewport(page,844);await page.clock.runFor(900);expect(requests).toHaveLength(0);
});

test('普通发送引起的短暂视口恢复再打开不触发；后续真正关闭仍可回复',async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);await send(page);await viewport(page,844);await page.clock.runFor(100);await viewport(page,400);await page.clock.runFor(800);expect(requests).toHaveLength(0);
  await viewport(page,844);await page.clock.runFor(400);await expect.poll(()=>requests.length).toBe(1);
});

test('发送过程中无目标系统失焦不丢周期，保存完成及视口恢复后回复',async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);await page.getByLabel('聊天消息',{exact:true}).fill('保存期间失焦');
  await page.getByRole('button',{name:'发送',exact:true}).evaluate(el=>{(el as HTMLButtonElement).click();(document.querySelector('.chat-compose textarea') as HTMLTextAreaElement).blur();});
  await expect(page.locator('.chat-history')).toContainText('保存期间失焦');await expect(page.getByRole('button',{name:'取消请求',exact:true})).toHaveCount(0);
  await viewport(page,844);await page.clock.runFor(1000);await expect.poll(()=>requests.length).toBe(1);
});

for(const reason of ['control-blur','details','popup','background','window-blur','composition','rotation','zoom','invalid','leave','unmount'] as const)test(`候选期间取消：${reason}`,async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);await send(page);await page.clock.runFor(700);await viewport(page,844);await page.clock.runFor(100);
  if(reason==='control-blur')await page.locator('.chat-nav button').first().focus();
  if(reason==='details')await page.getByRole('button',{name:'会话管理',exact:true}).click();
  if(reason==='popup')await page.evaluate(()=>{const d=document.createElement('div');d.setAttribute('role','dialog');document.body.append(d);});
  if(reason==='background')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  if(reason==='window-blur')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});window.dispatchEvent(new Event('blur'));});
  if(reason==='composition')await page.getByLabel('聊天消息',{exact:true}).dispatchEvent('compositionstart');
  if(reason==='rotation')await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));
  if(reason==='zoom')await viewport(page,844,{scale:1.2});
  if(reason==='invalid')await viewport(page,0);
  if(reason==='leave'){await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.getByRole('button',{name:'另一角色 开始 / 继续聊天'}).click();}
  if(reason==='unmount')await page.evaluate(async()=>{(await import('/src/store.ts')).usePhone.getState().set({activeApp:null});});
  await page.clock.runFor(900);expect(requests).toHaveLength(0);
});

test('没有输入焦点及已确认的键盘打开周期，单纯高度变化不回复',async({page})=>{
  const {ids,requests}=await setup(page);
  await page.evaluate(async id=>{await(await import('/src/chatService.ts')).queueUserMessage(id,'尚未打开键盘');},ids.a);
  await viewport(page,400);await page.clock.runFor(700);await viewport(page,844);await page.clock.runFor(700);expect(requests).toHaveLength(0);
});

test('键盘仍打开时切换路径，旧视口事件不得给新时间线重新布防',async({page})=>{
  const {ids,requests}=await setup(page);await openKeyboard(page);await send(page);
  await page.evaluate(async id=>{const m=(await(await import('/src/messagePath.ts')).activeMessages(id))[0];await(await import('/src/messageOperations.ts')).editMessage(id,m.id,'新分支待回复');},ids.a);
  await expect.poll(async()=>{await page.clock.runFor(1);return page.locator('.chat-history').textContent();}).toContain('新分支待回复');
  await viewport(page,400);await page.clock.runFor(700);await viewport(page,844);await page.clock.runFor(700);expect(requests).toHaveLength(0);
});

test('时间线切换取消旧候选且保留新路径消息',async({page})=>{
  const {ids,requests}=await setup(page);await openKeyboard(page);await send(page);await page.clock.runFor(700);await viewport(page,844);await page.clock.runFor(100);
  await page.evaluate(async id=>{const {activeMessages}=await import('/src/messagePath.ts');const m=(await activeMessages(id))[0];await(await import('/src/messageOperations.ts')).editMessage(id,m.id,'时间线更改');},ids.a);
  await page.clock.runFor(900);expect(requests).toHaveLength(0);
  await expect.poll(async()=>{await page.clock.runFor(1);return page.locator('.chat-history').textContent();}).toContain('时间线更改');
  const rows=await page.evaluate(async id=>(await import('/src/messagePath.ts')).activeMessages(id),ids.a);expect(rows).toHaveLength(1);expect(rows[0].content).toBe('时间线更改');
});

test('自动回复API失败后重复viewport不重试且保留用户消息',async({page})=>{
  const {ids}=await setup(page);await openKeyboard(page);await send(page,'失败待回复');await page.clock.runFor(700);
  let failures=0;await page.route('https://keyboard.test/**',r=>{failures++;return r.fulfill({status:401,json:{error:{message:'fixture denied'}}});});
  await viewport(page,844);await page.clock.runFor(500);await expect.poll(()=>failures).toBe(1);await expect(page.getByRole('alert')).toBeVisible();
  for(let i=0;i<3;i++){await viewport(page,844);await page.clock.runFor(500);}
  const rows=await page.evaluate(async id=>(await import('/src/messagePath.ts')).activeMessages(id),ids.a);expect(rows).toHaveLength(1);expect(rows[0].content).toBe('失败待回复');expect(failures).toBe(1);
});

test('Safari布局视口844但可见视口744，收起至667且offsetTop>40仍能回复',async({page})=>{
  const {requests}=await setup(page);
  await viewport(page,744);await page.clock.runFor(20);await openKeyboard(page);await send(page);
  await page.clock.runFor(700);await page.getByLabel('聊天消息',{exact:true}).blur();
  await viewport(page,667,{offsetTop:65});await page.clock.runFor(400);await expect.poll(()=>requests.length).toBe(1);
});

test('可见页面的系统窗口焦点变化不是后台，不丢失收键盘周期',async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);await send(page);await page.clock.runFor(700);
  await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});window.dispatchEvent(new Event('blur'));});
  await page.getByLabel('聊天消息',{exact:true}).blur();await viewport(page,844);await page.clock.runFor(400);await expect.poll(()=>requests.length).toBe(1);
});

test('关闭稳定时保存仍未完成，等待保存完成再尝试一次，不提前消费',async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);
  await page.evaluate(async()=>{
    const {db}=await import('/src/store.ts');const Dexie=Object.getPrototypeOf(db.constructor);
    await new Promise<void>(ready=>{(window as any).__saveBlock=db.transaction('rw',db.tables,async()=>{await Dexie.waitFor(new Promise<void>(release=>{(window as any).__releaseSave=release;ready();}));});});
  });
  await page.getByLabel('聊天消息',{exact:true}).fill('延迟保存的消息');await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.getByLabel('聊天消息',{exact:true}).blur();await viewport(page,844);await page.clock.runFor(1200);expect(requests).toHaveLength(0);
  await page.evaluate(async()=>{(window as any).__releaseSave();await (window as any).__saveBlock;});
  await expect.poll(async()=>{await page.clock.runFor(1);return requests.length;}).toBe(1);await expect(page.locator('.chat-history')).toContainText('自动回复完成。');
  for(let i=0;i<3;i++){await viewport(page,844);await page.clock.runFor(500);}expect(requests).toHaveLength(1);
});

 test('按住发送期间视口恢复不提前生成，释放后短暂恢复消退不回复，真正收起只回复一次',async({page})=>{
  const {requests}=await setup(page);await openKeyboard(page);await send(page);await page.clock.runFor(700);
  const button=page.getByRole('button',{name:'发送',exact:true});
  await page.getByLabel('聊天消息',{exact:true}).fill('下一条');
  await button.dispatchEvent('pointerdown',{pointerId:42,pointerType:'touch',button:0});
  await viewport(page,844);await page.clock.runFor(1200);expect(requests).toHaveLength(0);
  await button.dispatchEvent('pointerup',{pointerId:42,pointerType:'touch',button:0});
  await page.clock.runFor(100);await viewport(page,400);await page.clock.runFor(800);expect(requests).toHaveLength(0);
  await send(page,'下一条');await viewport(page,844);await page.clock.runFor(650);
  await expect.poll(()=>requests.length).toBe(1);
  await viewport(page,844);await page.clock.runFor(1000);expect(requests).toHaveLength(1);
 });
