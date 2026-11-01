import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
async function setup(page:Page,debug:boolean){
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{const vv=new EventTarget();Object.assign(vv,{height:844,width:390,offsetTop:0,offsetLeft:0,scale:1});Object.defineProperty(window,'visualViewport',{value:vv,configurable:true});});
  await isolatedApp(page,'keyboard-diagnostics-'+crypto.randomUUID());
  if(debug){await page.goto('/?keyboardDebug=1');await expect(page.locator('.desktop')).toBeVisible();}
  await expect(page.getByLabel('键盘开发诊断',{exact:true})).toHaveCount(0);
  await page.evaluate(async()=>{const {db,usePhone}=await import('/src/store.ts');await db.characters.add({id:'private-role-id',name:'私密角色名',persona:'私密人设'});await db.apiConfigs.add({id:'api-private-id',name:'私密配置',provider:'openai-compatible',baseUrl:'https://keyboard-debug.test/v1',model:'mock',enabled:true,isDefault:true,temperature:.7,maxTokens:100,createdAt:1,updatedAt:1});await db.apiCredentials.add({configId:'api-private-id',apiKey:'synthetic-private-credential'});const c=await(await import('/src/chatService.ts')).getConversation('private-role-id');await(await import('/src/chatPreferences.ts')).saveChatSettings(c.id,{continuousSend:true,keyboardAutoReply:true});await usePhone.getState().reload();});
  let calls=0;await page.route('https://keyboard-debug.test/**',async r=>{calls++;await r.fulfill({json:{choices:[{message:{content:'私密AI正文'}}]}});});
  await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'私密角色名 开始 / 继续聊天'}).click();
  return ()=>calls;
}
async function logs(page:Page){return page.evaluate(async()=>[...(await import('/src/keyboardDebug.ts')).getKeyboardDebugRecords()]);}
async function height(page:Page,value:number){await page.evaluate(h=>{Object.assign(visualViewport!,{height:h});visualViewport!.dispatchEvent(new Event('resize'));},value);}
async function prepareSend(page:Page){
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  const input=page.getByLabel('聊天消息',{exact:true});await input.focus();await height(page,400);await page.clock.runFor(20);await input.fill('私密用户正文');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('button',{name:'取消请求',exact:true})).toHaveCount(0);await page.clock.runFor(700);
}
test('默认无面板、无日志；诊断关闭时不记录',async({page})=>{
  await setup(page,false);await prepareSend(page);await expect(page.getByLabel('键盘开发诊断',{exact:true})).toHaveCount(0);expect(await logs(page)).toEqual([]);
});
test('只读浮层不抢焦点/触摸、不占布局；成功链路日志无正文、Key或持久ID',async({page})=>{
  const calls=await setup(page,true),panel=page.getByLabel('键盘开发诊断',{exact:true});await expect(panel).toBeVisible();await expect(panel).toHaveCSS('position','fixed');await expect(panel).toHaveCSS('pointer-events','none');await expect(panel).toHaveAttribute('inert','');await expect(panel.locator('button,input,textarea,a,[tabindex]')).toHaveCount(0);
  const same=await panel.evaluate(el=>{const geometry=()=>['.chat-compose','.chat-compose textarea','.chat-send','.chat-history'].map(s=>{const r=document.querySelector(s)!.getBoundingClientRect();return [r.x,r.y,r.width,r.height];});const before=geometry(),scroll=scrollY;el.setAttribute('hidden','');const after=geometry();el.removeAttribute('hidden');return JSON.stringify(before)===JSON.stringify(after)&&scroll===scrollY;});expect(same).toBe(true);
  await prepareSend(page);await expect(page.getByLabel('聊天消息',{exact:true})).toBeFocused();await height(page,844);await page.clock.runFor(400);await expect.poll(calls).toBe(1);await expect(page.locator('.chat-history')).toContainText('私密AI正文');
  const rows=await logs(page),events=rows.map(r=>r.event);for(const event of ['mounted','keyboardOpen','keyboardClosed','candidate-created','candidate-timer','save-finished','reply-check','reply-requested','send-true','generation-entered'])expect(events).toContain(event);
  expect(rows.some(r=>r.fields.pathTimeline===true&&r.fields.pathEpoch===true&&r.fields.pendingUser===true)).toBe(true);
  const text=JSON.stringify(rows);for(const secret of ['私密','synthetic-private-credential','private-role-id','api-private-id','https://keyboard-debug.test'])expect(text).not.toContain(secret);
});
test('失焦阻止和未挂载原因可见；缓冲200条、白名单过滤且重载不保留',async({page})=>{
  const calls=await setup(page,true);await prepareSend(page);await page.getByLabel('聊天消息',{exact:true}).blur();await height(page,844);await page.clock.runFor(700);expect(calls()).toBe(0);
  await expect(page.getByLabel('键盘开发诊断',{exact:true})).toContainText('blur-rejected');const rows=await logs(page);expect(rows.some(r=>r.event==='blur'&&r.fields.relatedTarget==='none')).toBe(true);expect(rows.some(r=>r.event==='reset'&&r.fields.reason==='blur-rejected'&&r.fields.armed===false)).toBe(true);expect(rows.some(r=>r.event==='not-mounted'&&r.fields.reason==='disabled')).toBe(true);
  const capped=await page.evaluate(async()=>{const d=await import('/src/keyboardDebug.ts');for(let i=0;i<205;i++)d.recordKeyboardDebug('viewport',{height:i,reason:'raw-private-error',target:'private-user-id',text:'private-chat',apiKey:'private-key'} as any);return d.getKeyboardDebugRecords();});expect(capped).toHaveLength(200);expect(capped[0].fields.height).toBe(5);expect(capped.at(-1)?.fields).toEqual({height:204});expect(JSON.stringify(capped)).not.toContain('private');
  await page.reload();await expect(page.locator('.desktop')).toBeVisible();expect(await logs(page)).toEqual([]);
});

test('回复失败仅记录固定分类，不记录Provider原始错误',async({page})=>{
  await setup(page,true);await page.route('https://keyboard-debug.test/**',r=>r.fulfill({status:401,json:{error:{message:'private-provider-error'}}}));
  await prepareSend(page);await height(page,844);await page.clock.runFor(400);
  await expect.poll(async()=>(await logs(page)).some(r=>r.event==='reply-returned'&&r.fields.success===false&&r.fields.reason==='generation-failed')).toBe(true);
  expect(JSON.stringify(await logs(page))).not.toContain('private-provider-error');
});

test('375px小屏与键盘小视口中挂载状态、armed、原因和三条事件不被裁切',async({page})=>{
  await setup(page,true);await prepareSend(page);await page.getByLabel('聊天消息',{exact:true}).blur();await height(page,844);await page.clock.runFor(700);
  for(const [width,height] of [[375,667],[375,400],[390,844]]){
    await page.setViewportSize({width,height});const panel=page.getByLabel('键盘开发诊断',{exact:true});
    await expect(panel.locator('[data-debug-summary]')).toContainText('检测器：已挂载');await expect(panel.locator('[data-debug-summary]')).toContainText('armed=false');await expect(panel.locator('[data-debug-reason]')).toContainText('blur-rejected');await expect(panel.locator('[data-debug-event]')).toHaveCount(3);
    const visible=await panel.evaluate(el=>{const p=el.getBoundingClientRect();return [...el.querySelectorAll('[data-debug-summary],[data-debug-reason],[data-debug-event]')].every(c=>{const r=c.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom&&r.left>=p.left&&r.right<=p.right;})&&p.right<=innerWidth&&p.bottom<=innerHeight;});expect(visible).toBe(true);
    await panel.screenshot({animations:'disabled',path:`/tmp/claudia-keyboard-debug-${width}-${height}.png`});
  }
});
