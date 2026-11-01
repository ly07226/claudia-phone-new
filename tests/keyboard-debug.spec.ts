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
  const calls=await setup(page,true),panel=page.getByLabel('键盘开发诊断',{exact:true});await expect(panel).toBeVisible();await expect(panel).toHaveCSS('position','fixed');await expect(panel).toHaveCSS('pointer-events','none');await expect(panel.locator('[data-debug-readonly]')).toHaveAttribute('inert','');await expect(panel.locator('[data-debug-readonly] button,input,textarea,a,[tabindex]')).toHaveCount(0);await expect(panel.getByRole('button',{name:'复制完整日志'})).toHaveCount(1);
  const same=await panel.evaluate(el=>{const geometry=()=>['.chat-compose','.chat-compose textarea','.chat-send','.chat-history'].map(s=>{const r=document.querySelector(s)!.getBoundingClientRect();return [r.x,r.y,r.width,r.height];});const before=geometry(),scroll=scrollY;el.setAttribute('hidden','');const after=geometry();el.removeAttribute('hidden');return JSON.stringify(before)===JSON.stringify(after)&&scroll===scrollY;});expect(same).toBe(true);
  await prepareSend(page);await expect(page.getByLabel('聊天消息',{exact:true})).toBeFocused();await height(page,844);await page.clock.runFor(400);await expect.poll(calls).toBe(1);await expect(page.locator('.chat-history')).toContainText('私密AI正文');
  const rows=await logs(page),events=rows.map(r=>r.event);for(const event of ['mounted','keyboardOpen','keyboardClosed','candidate-created','candidate-timer','save-finished','reply-check','reply-requested','send-true','generation-entered'])expect(events).toContain(event);
  expect(rows.some(r=>r.fields.pathTimeline===true&&r.fields.pathEpoch===true&&r.fields.pendingUser===true)).toBe(true);
  const text=JSON.stringify(rows);for(const secret of ['私密','synthetic-private-credential','private-role-id','api-private-id','https://keyboard-debug.test'])expect(text).not.toContain(secret);
});
test('失焦阻止和未挂载原因可见；缓冲200条、白名单过滤且重载不保留',async({page})=>{
  const calls=await setup(page,true);await prepareSend(page);await page.locator('.chat-nav button').first().focus();await height(page,844);await page.clock.runFor(700);expect(calls()).toBe(0);
  await expect(page.getByLabel('键盘开发诊断',{exact:true})).toContainText('focus-other');const rows=await logs(page);expect(rows.some(r=>r.event==='blur'&&r.fields.relatedTarget==='control')).toBe(true);expect(rows.some(r=>r.event==='reset'&&r.fields.reason==='blur-rejected'&&r.fields.armed===false)).toBe(true);expect(rows.some(r=>r.event==='not-mounted'&&r.fields.reason==='disabled')).toBe(true);
  const capped=await page.evaluate(async()=>{const d=await import('/src/keyboardDebug.ts');for(let i=0;i<205;i++)d.recordKeyboardDebug('viewport',{height:i,reason:'raw-private-error',target:'private-user-id',text:'private-chat',apiKey:'private-key'} as any);return d.getKeyboardDebugRecords();});expect(capped).toHaveLength(200);expect(capped[0].fields.height).toBe(5);expect(capped.at(-1)?.fields).toEqual({height:204});expect(JSON.stringify(capped)).not.toContain('private');
  await page.reload();await expect(page.locator('.desktop')).toBeVisible();expect(await logs(page)).toEqual([]);
});

test('回复失败仅记录固定分类，不记录Provider原始错误',async({page})=>{
  await setup(page,true);await page.route('https://keyboard-debug.test/**',r=>r.fulfill({status:401,json:{error:{message:'private-provider-error'}}}));
  await prepareSend(page);await height(page,844);await page.clock.runFor(400);
  await expect.poll(async()=>(await logs(page)).some(r=>r.event==='reply-returned'&&r.fields.success===false&&r.fields.reason==='generation-failed')).toBe(true);
  expect(JSON.stringify(await logs(page))).not.toContain('private-provider-error');
});

test('诊断保留系统blur的armed与超时状态，视口关闭后记录实际回复入口',async({page})=>{
  const calls=await setup(page,true);await prepareSend(page);await page.getByLabel('聊天消息',{exact:true}).blur();
  const preserved=(await logs(page)).find(r=>r.event==='blur'&&r.fields.reason==='blur-preserved');expect(preserved?.fields.armed).toBe(true);expect(preserved?.fields.suppressionRemaining).toBe(0);
  await height(page,844);await page.clock.runFor(400);await expect.poll(calls).toBe(1);expect((await logs(page)).some(r=>r.event==='send-true')).toBe(true);
});

test('375px小屏与键盘小视口中挂载状态、armed、原因和三条事件不被裁切',async({page})=>{
  await setup(page,true);await prepareSend(page);await page.locator('.chat-nav button').first().focus();await height(page,844);await page.clock.runFor(700);
  for(const [width,height] of [[375,667],[375,400],[390,844]]){
    await page.setViewportSize({width,height});const panel=page.getByLabel('键盘开发诊断',{exact:true});
    await expect(panel.locator('[data-debug-summary]')).toContainText('检测器：已挂载');await expect(panel.locator('[data-debug-summary]')).toContainText('armed=false');await expect(panel.locator('[data-debug-reason]')).toContainText('focus-other');await expect(panel.locator('[data-debug-event]')).toHaveCount(3);
    const visible=await panel.evaluate(el=>{const p=el.getBoundingClientRect();return [...el.querySelectorAll('[data-debug-summary],[data-debug-reason],[data-debug-event]')].every(c=>{const r=c.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom&&r.left>=p.left&&r.right<=p.right;})&&p.right<=innerWidth&&p.bottom<=innerHeight;});expect(visible).toBe(true);
    await panel.screenshot({animations:'disabled',path:`/tmp/claudia-keyboard-debug-${width}-${height}.png`});
  }
});

test('单调时间线区分普通发送和自动回复，首次失焦/恢复/触发/禁用顺序可见',async({page})=>{
  const calls=await setup(page,true);await prepareSend(page);
  let rows=await logs(page);
  for(const name of ['send-pointerdown','send-pointerup','send-click','send-start','message-save-start','message-save-end','input-mounted','input-focus'])expect(rows.some(e=>e.event===name)).toBe(true);
  expect(rows.some(e=>e.event==='input-disabled'&&e.fields.disabled)).toBe(false);
  const ordinary=rows.find(e=>e.event==='send-start')!;expect(ordinary.fields.flow).toBe('ordinary');
  const saving=rows.find(e=>e.event==='message-save-start')!,saved=rows.find(e=>e.event==='message-save-end')!;
  expect(ordinary.sequence).toBeLessThan(saving.sequence);expect(saving.sequence).toBeLessThan(saved.sequence);expect(saved.fields.success).toBe(true);
  await page.getByLabel('聊天消息',{exact:true}).blur();await height(page,844);await page.clock.runFor(400);await expect.poll(calls).toBe(1);
  await expect.poll(async()=>(await logs(page)).some(e=>e.event==='input-disabled'&&e.fields.disabled)).toBe(true);
  rows=await logs(page);
  const before=(a:string,b:string)=>expect(rows.find(e=>e.event===a)!.sequence).toBeLessThan(rows.find(e=>e.event===b)!.sequence);
  before('input-blur','reply-requested');before('reply-requested','send-true');
  const automatic=rows.filter(e=>e.fields.flow==='automatic');
  const stages=['send-true','generation-entered','generation-allowed','ai-start'] as const;
  for(const event of stages)expect(automatic.filter(e=>e.event===event)).toHaveLength(1);
  const chain=stages.map(event=>automatic.find(e=>e.event===event)!);
  for(let i=1;i<chain.length;i++)expect(chain[i-1].sequence).toBeLessThan(chain[i].sequence);
  // Exactly one send(true), and no ordinary/manual generation stage inside this automatic attempt.
  expect(rows.filter(e=>e.event==='send-true')).toHaveLength(1);
  expect(rows.filter(e=>e.sequence>=chain[0].sequence&&e.sequence<=chain.at(-1)!.sequence&&stages.some(stage=>stage===e.event))).toEqual(chain);
  expect(rows.find(e=>e.event==='generation-allowed'&&e.fields.flow==='ordinary')!.sequence).toBeLessThan(saved.sequence);
  expect(chain[0].fields.flow).toBe('automatic');
  for(let i=1;i<rows.length;i++){expect(rows[i].sequence).toBeGreaterThan(rows[i-1].sequence);expect(rows[i].ms).toBeGreaterThanOrEqual(rows[i-1].ms);}
  const first=await page.evaluate(async()=>(await import('/src/keyboardDebug.ts')).getKeyboardDebugFirst());
  expect(first.blur!.sequence).toBeLessThan(first.viewport!.sequence);expect(first.viewport!.sequence).toBeLessThan(first.auto!.sequence);expect(first.auto!.sequence).toBeLessThan(first.disabled!.sequence);
  await expect(page.locator('[data-debug-first]')).toContainText('首次 disabled：#');
  // Milestones survive the bounded 200-row viewport ring without persisting to disk.
  await page.evaluate(async()=>{const d=await import('/src/keyboardDebug.ts');for(let i=0;i<205;i++)d.recordKeyboardDebug('viewport',{height:400});});
  expect(await page.evaluate(async()=>(await import('/src/keyboardDebug.ts')).getKeyboardDebugFirst())).toEqual(first);
});

test('禁用写入在同步blur前记录，恢复原生行为；节点替换/卸载可追踪',async({page})=>{
  await setup(page,true);const input=page.getByLabel('聊天消息',{exact:true});await input.focus();
  await input.evaluate(el=>{el.disabled=true;el.disabled=false;el.setAttribute('disabled','');el.removeAttribute('disabled');});
  let rows=await logs(page);const edges=rows.filter(e=>e.event==='input-disabled');expect(edges.map(e=>e.fields.disabled)).toEqual([true,false,true,false]);
  const blur=rows.find(e=>e.event==='input-blur');if(blur)expect(edges[0].sequence).toBeLessThan(blur.sequence);
  await input.evaluate(async el=>{const clone=el.cloneNode(true);el.replaceWith(clone);await Promise.resolve();await Promise.resolve();clone.replaceWith(el);await Promise.resolve();});
  rows=await logs(page);expect(rows.filter(e=>e.event==='input-mounted').length).toBeGreaterThanOrEqual(3);expect(rows.some(e=>e.event==='input-removed'&&!e.fields.connected)).toBe(true);
  await page.evaluate(async()=>{(await import('/src/store.ts')).usePhone.getState().set({activeApp:null});});
  expect(await input.count()).toBe(0);
});

test('导出统一有序日志、时间/flow/观测状态；截断数量准确且敏感字段被过滤',async({page})=>{
  await setup(page,true);
  const result=await page.evaluate(async()=>{
    const d=await import('/src/keyboardDebug.ts');
    d.recordKeyboardDebug('viewport',{height:400,offsetTop:21,state:'open',armed:true,inputFocused:true,disabled:false});
    d.recordKeyboardDebug('send-start',{flow:'ordinary'});
    d.recordKeyboardDebug('send-true',{flow:'manual'});
    d.recordKeyboardDebug('send-true',{flow:'automatic',text:'private-text',name:'private-name',apiKey:'private-key',token:'private-token',userId:'private-user'} as any);
    const complete=d.exportKeyboardDebugLog();
    for(let i=0;i<205;i++)d.recordKeyboardDebug('viewport',{height:i});
    return {complete,truncated:d.exportKeyboardDebugLog(),rows:d.getKeyboardDebugRecords()};
  });
  const parse=(text:string)=>text.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
  const rows=parse(result.complete);
  expect(result.complete).toContain('丢弃=0');expect(result.complete).toContain('未截断：包含本页当前全部诊断事件');
  expect(rows.filter(e=>e.event==='send-true').map(e=>e.flow)).toEqual(['manual','automatic']);
  expect(rows.find(e=>e.event==='send-start').flow).toBe('ordinary');
  expect(rows.at(-1).context).toMatchObject({height:400,offsetTop:21,state:'open',armed:true,inputFocused:true,disabled:false});
  for(let i=1;i<rows.length;i++){expect(rows[i].sequence).toBe(rows[i-1].sequence+1);expect(rows[i].ms).toBeGreaterThanOrEqual(rows[i-1].ms);}
  expect(result.truncated).toContain(`丢弃=${result.rows[0].sequence-1}`);expect(result.truncated).toContain('已截断：仅导出保留事件，并非完整历史');
  expect(parse(result.truncated)).toHaveLength(200);
  for(const secret of ['private-text','private-name','private-key','private-token','private-user','私密','synthetic-private-credential'])expect(result.complete+result.truncated).not.toContain(secret);
});

test('主动触屏复制不失焦、不取消armed、不发送；复制失败不使用抢焦点回退',async({page})=>{
  const calls=await setup(page,true);await prepareSend(page);
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__copied=text;}}});});
  const input=page.getByLabel('聊天消息',{exact:true}),copy=page.getByRole('button',{name:'复制完整日志',exact:true});
  const before=await logs(page);const geometry=await input.boundingBox();
  await copy.tap();await expect(input).toBeFocused();expect(await input.boundingBox()).toEqual(geometry);expect(calls()).toBe(0);
  const after=await logs(page);expect(after).toEqual(before);
  await expect(page.getByLabel('键盘开发诊断',{exact:true})).toContainText('已复制保留日志');
  const copied=await page.evaluate(()=>(window as any).__copied as string);expect(copied).toContain('Claudia Phone keyboard diagnostic v1');expect(copied).toContain('keyboardOpen');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('private-system-error');}}});});
  await copy.tap();await expect(input).toBeFocused();await expect(page.getByLabel('键盘开发诊断',{exact:true})).toContainText('复制失败，请允许剪贴板访问');
  expect(await logs(page)).toEqual(before);expect(calls()).toBe(0);
  await height(page,844);await page.clock.runFor(400);await expect.poll(calls).toBe(1);
});
