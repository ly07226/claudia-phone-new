import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
async function setup(page:Page){
 await isolatedApp(page,'generation-task-'+crypto.randomUUID());
 const ids=await page.evaluate(async()=>{
  const {db,usePhone}=await import('/src/store.ts');
  await db.characters.bulkAdd([{id:'a',name:'任务甲',persona:''},{id:'b',name:'任务乙',persona:''}]);
  await db.worlds.add({id:'w',name:'任务世界',description:'',createdAt:1});await db.worldProfiles.add({id:'wp',worldId:'w',characterId:'a',setting:''});
  await db.apiConfigs.add({id:'api',name:'模拟',provider:'openai-compatible',baseUrl:'https://tasks.test/v1',model:'fixture',enabled:true,isDefault:true,temperature:.7,maxTokens:100,createdAt:1,updatedAt:1});await db.apiCredentials.add({configId:'api',apiKey:'synthetic-fixture-only'});
  const {getConversation}=await import('/src/chatService.ts');const a=await getConversation('a'),b=await getConversation('b'),w=await getConversation('a','w');await usePhone.getState().reload();return {a:a.id,b:b.id,w:w.id};
 });
 const calls:{body:any;release:(reply?:string,fail?:boolean)=>void}[]=[];
 await page.route('https://tasks.test/**',async route=>{
  const response=await new Promise<{reply:string;fail:boolean}>(resolve=>calls.push({body:route.request().postDataJSON(),release:(reply='完成回复。',fail=false)=>resolve({reply,fail})}));
  try{if(response.fail)await route.abort();else await route.fulfill({json:{choices:[{message:{content:response.reply}}]}});}catch{/* Intentionally stopped or reloaded requests cannot receive a late response. */}
 });
 await page.getByRole('button',{name:'聊天',exact:true}).click();await open(page,'任务甲');
 return {ids,calls};
}
async function open(page:Page,name:string){await page.getByRole('button',{name:`${name} 开始 / 继续聊天`,exact:true}).click();}
async function send(page:Page,text:string){await page.getByLabel('聊天消息',{exact:true}).fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();}
async function messages(page:Page,id:string){return page.evaluate(async id=>await(await import('/src/messagePath.ts')).activeMessages(id),id);}

test('返回列表、进入另一聊天及重进原聊天不取消或重复请求；两份结果分别保存',async({page})=>{
 const {ids,calls}=await setup(page);await send(page,'甲的消息');await expect.poll(()=>calls.length).toBe(1);
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await open(page,'任务乙');await send(page,'乙的消息');await expect.poll(()=>calls.length).toBe(2);
 calls[1].release('乙的回复。');await expect(page.locator('.chat-history')).toContainText('乙的回复。');
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await open(page,'任务甲');await expect(page.getByRole('button',{name:'取消请求',exact:true})).toBeVisible();expect(calls.length).toBe(2);
 calls[0].release('甲的完整回复。');await expect(page.locator('.chat-history')).toContainText('甲的完整回复。');await expect(page.getByRole('button',{name:'取消请求',exact:true})).toHaveCount(0);
 expect((await messages(page,ids.a)).map(m=>m.content)).toEqual(['甲的消息','甲的完整回复。']);expect((await messages(page,ids.b)).map(m=>m.content)).toEqual(['乙的消息','乙的回复。']);
 await page.reload();await expect(page.locator('.desktop')).toBeVisible();await page.getByRole('button',{name:'聊天',exact:true}).click();await open(page,'任务甲');await expect(page.locator('.chat-history')).toContainText('甲的完整回复。');expect(calls.length).toBe(2);
});

test('组件卸载、桌面/设置切换及页面可见性变化保留任务，重挂载读取共享状态',async({page})=>{
 const {ids,calls}=await setup(page);await send(page,'离开页面继续');await expect.poll(()=>calls.length).toBe(1);
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.getByRole('button',{name:'返回桌面',exact:true}).click();await expect(page.locator('.chat-app')).toHaveCount(0);
 await page.evaluate(async()=>{const {usePhone}=await import('/src/store.ts');usePhone.getState().set({activeApp:'设置'});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 expect(await page.evaluate(async id=>(await import('/src/generationTasks.ts')).getGenerationTask(id)?.status,ids.a)).toBe('generating');
 await page.evaluate(async()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));(await import('/src/store.ts')).usePhone.getState().set({activeApp:'聊天'});});await open(page,'任务甲');await expect(page.getByRole('button',{name:'取消请求',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();calls[0].release('离开后已保存。');await expect.poll(async()=> (await messages(page,ids.a)).at(-1)?.content).toBe('离开后已保存。');await open(page,'任务甲');await expect(page.locator('.chat-history')).toContainText('离开后已保存。');expect(calls.length).toBe(1);
});

test('切换剧本世界不取消日常生成，不向当前世界串写；返回原空间读取完成回复',async({page})=>{
 const {ids,calls}=await setup(page);await send(page,'日常待回复');await expect.poll(()=>calls.length).toBe(1);
 await page.evaluate(async()=>{await(await import('/src/spaces.ts')).useSpaces.getState().enterSpace('world:w');});await expect(page.locator('.desktop')).toBeVisible();await page.getByRole('button',{name:'聊天',exact:true}).click();await open(page,'任务甲');await expect(page.locator('.chat-history')).not.toContainText('日常待回复');
 calls[0].release('日常后台完成。');await expect.poll(async()=>(await messages(page,ids.a)).at(-1)?.content).toBe('日常后台完成。');expect(await messages(page,ids.w)).toEqual([]);await expect(page.locator('.chat-history')).not.toContainText('日常后台完成。');
 await page.evaluate(async()=>{await(await import('/src/spaces.ts')).useSpaces.getState().enterSpace('daily');});await page.getByRole('button',{name:'聊天',exact:true}).click();await open(page,'任务甲');await expect(page.locator('.chat-history')).toContainText('日常后台完成。');expect(calls.length).toBe(1);
});

test('重进后主动停止取消原任务，迟到响应不保存；无自动重试',async({page})=>{
 const {ids,calls}=await setup(page);await send(page,'停止后仍保留我');await expect.poll(()=>calls.length).toBe(1);await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await open(page,'任务甲');await page.getByRole('button',{name:'取消请求',exact:true}).click();
 await expect(page.getByRole('button',{name:'取消请求',exact:true})).toHaveCount(0);calls[0].release('不应保存');await expect.poll(async()=>await page.evaluate(async id=>(await import('/src/generationTasks.ts')).getGenerationTask(id)?.status,ids.a)).toBe('stopped');
 expect((await messages(page,ids.a)).map(m=>m.content)).toEqual(['停止后仍保留我']);await expect(page.getByRole('button',{name:'重试最后一条消息',exact:true})).toBeVisible();expect(calls.length).toBe(1);
});

test('分支切换取消旧路径任务，迟到回复不能进入新路径或伪报成功',async({page})=>{
 const {ids,calls}=await setup(page);await send(page,'最初消息');await expect.poll(()=>calls.length).toBe(1);calls[0].release('第一版。');await expect(page.locator('.chat-history')).toContainText('第一版。');
 const root=await page.evaluate(async id=>{const {getCurrentTimeline}=await import('/src/timelines.ts');const root=(await getCurrentTimeline(id)).id;const m=(await(await import('/src/messagePath.ts')).activeMessages(id))[0];await(await import('/src/messageOperations.ts')).editMessage(id,m.id,'分支消息',true);return root;},ids.a);
 await expect(page.locator('.chat-history')).toContainText('分支消息');await send(page,'子分支待回复');await expect.poll(()=>calls.length).toBe(2);
 await page.evaluate(async({id,root})=>{await(await import('/src/timelines.ts')).switchTimeline(id,root);},{id:ids.a,root});calls[1].release('迟到子分支');await expect(page.locator('.chat-history')).toContainText('最初消息');await expect(page.getByRole('button',{name:'取消请求',exact:true})).toHaveCount(0);
 expect((await messages(page,ids.a)).map(m=>m.content)).toEqual(['最初消息','第一版。']);expect(await page.evaluate(async id=>(await import('/src/generationTasks.ts')).getGenerationTask(id)?.status,ids.a)).not.toBe('completed');expect(calls.length).toBe(2);
});

test('离开页面时网络失败保留已存消息，返回显示失败并仅手动重试',async({page})=>{
 const {ids,calls}=await setup(page);await send(page,'网络失败仍保留');await expect.poll(()=>calls.length).toBe(1);await page.getByRole('button',{name:'返回角色列表',exact:true}).click();calls[0].release('',true);
 await expect.poll(async()=>page.evaluate(async id=>(await import('/src/generationTasks.ts')).getGenerationTask(id)?.status,ids.a)).toBe('failed');await open(page,'任务甲');await expect(page.locator('.chat-history')).toContainText('网络请求失败');expect((await messages(page,ids.a)).map(m=>m.content)).toEqual(['网络失败仍保留']);expect(calls.length).toBe(1);
 await page.getByRole('button',{name:'重试最后一条消息',exact:true}).click();await expect.poll(()=>calls.length).toBe(2);calls[1].release('用户确认重试后完成。');await expect(page.locator('.chat-history')).toContainText('用户确认重试后完成。');expect((await messages(page,ids.a)).filter(m=>m.role==='user')).toHaveLength(1);
});

test('刷新丢失运行进程时显示未确认状态，不重发；明确停止后才能手动恢复',async({page})=>{
 const {ids,calls}=await setup(page);await send(page,'刷新前消息');await expect.poll(()=>calls.length).toBe(1);await page.reload();calls[0].release('旧进程结果');await expect(page.locator('.desktop')).toBeVisible();await page.getByRole('button',{name:'聊天',exact:true}).click();await open(page,'任务甲');await expect(page.locator('.chat-history')).toContainText('请求状态待确认');expect(calls.length).toBe(1);
 await page.getByRole('button',{name:'取消请求',exact:true}).click();await expect(page.getByRole('button',{name:'重试最后一条消息',exact:true})).toBeVisible();expect((await messages(page,ids.a)).map(m=>m.content)).toEqual(['刷新前消息']);expect(calls.length).toBe(1);
});

test('应用级重复启动守卫及历史重新生成仍只保存一个新版本，预览不重复调用',async({page})=>{
 const {ids,calls}=await setup(page);await send(page,'一次请求');await expect.poll(()=>calls.length).toBe(1);
 const error=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');const c=(await db.conversations.get(id))!;try{(await import('/src/generationTasks.ts')).startGenerationTask({conversation:c,expectedPath:{timelineId:c.activeTimelineId,epoch:c.timelineEpoch??0},text:'重复',retry:false,images:[]});return '';}catch(e){return(e as Error).message;}},ids.a);expect(error).toContain('正在回复');expect(calls.length).toBe(1);calls[0].release('原版。');await expect(page.locator('.chat-history')).toContainText('原版。');
 await page.evaluate(async id=>{const {db}=await import('/src/store.ts');const c=(await db.conversations.get(id))!;const rows=await(await import('/src/messagePath.ts')).activeMessages(id);const task=(await import('/src/generationTasks.ts')).startGenerationTask({conversation:c,expectedPath:{timelineId:c.activeTimelineId,epoch:c.timelineEpoch??0},text:'',retry:true,messageId:rows.at(-1)!.id,images:[]});void task.done.catch(()=>{});},ids.a);await expect.poll(()=>calls.length).toBe(2);await page.getByRole('button',{name:'返回角色列表',exact:true}).click();calls[1].release('新版。');await expect.poll(async()=>(await messages(page,ids.a)).at(-1)?.content).toBe('新版。');await open(page,'任务甲');await expect(page.locator('.chat-history')).toContainText('新版。');expect(calls.length).toBe(2);expect(await page.evaluate(async id=>(await import('/src/store.ts')).db.messageVariants.where('conversationId').equals(id).count(),ids.a)).toBe(2);
});

test('遗留请求租约到期后明确显示中断可能性，保持消息且不自动调用API',async({page})=>{
 const {ids,calls}=await setup(page);
 // Build the orphaned-request fixture through the actual message-saving service.
 await page.evaluate(async id=>{const {saveChatSettings}=await import('/src/chatPreferences.ts');await saveChatSettings(id,{continuousSend:true});await(await import('/src/chatService.ts')).queueUserMessage(id,'遗留用户消息');await saveChatSettings(id,{continuousSend:false});},ids.a);
 await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
 await page.evaluate(async id=>{await(await import('/src/store.ts')).db.conversations.update(id,{sendingToken:'isolated-expired-fixture',sendingUntil:Date.now()+1000});},ids.a);
 await expect(page.locator('.chat-history')).toContainText('请求状态待确认');await page.clock.runFor(1100);await expect(page.locator('.chat-history')).toContainText('上次请求尚未确认完成');await expect(page.getByRole('button',{name:'取消请求',exact:true})).toHaveCount(0);expect((await messages(page,ids.a)).map(m=>m.content)).toEqual(['遗留用户消息']);expect(calls.length).toBe(0);
});

test('保存事务交出的路径身份稳定；后台超时保留用户消息且不重试、不伪报完成',async({page})=>{
 const {ids,calls}=await setup(page);await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));await send(page,'超时请求');await expect.poll(()=>calls.length).toBe(1);
 const scope=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');const c=(await db.conversations.get(id))!,task=(await import('/src/generationTasks.ts')).getGenerationTask(id)!;return {same:task.timelineId===c.activeTimelineId&&task.epoch===c.timelineEpoch,worldId:task.worldId,characterId:task.characterId};},ids.a);expect(scope).toEqual({same:true,worldId:undefined,characterId:'a'});
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.clock.runFor(60001);await expect.poll(async()=>page.evaluate(async id=>(await import('/src/generationTasks.ts')).getGenerationTask(id)?.status,ids.a)).toBe('failed');calls[0].release('超时后迟到结果');await open(page,'任务甲');await expect(page.locator('.chat-history')).toContainText('已取消或超时');expect((await messages(page,ids.a)).map(m=>m.content)).toEqual(['超时请求']);expect(calls.length).toBe(1);
});

test('聊天UI重新生成使用共享任务，停止后仍保留未发送的图片与文字草稿',async({page})=>{
 const {calls}=await setup(page);await send(page,'原消息');await expect.poll(()=>calls.length).toBe(1);calls[0].release('原回复。');await expect(page.locator('.chat-history')).toContainText('原回复。');
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=8;return c.toDataURL().split(',')[1];});await page.getByRole('button',{name:'图片附件',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'相册',exact:true}).click();await(await chooser).setFiles({name:'pending.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});await expect(page.locator('.chat-pending-images img')).toHaveCount(1);await page.getByLabel('聊天消息',{exact:true}).fill('下一条图片草稿');
 await page.getByRole('button',{name:'AI 消息操作',exact:true}).press('Enter');await page.getByRole('button',{name:'重新生成',exact:true}).click();await expect.poll(()=>calls.length).toBe(2);await expect(page.locator('.chat-pending-images img')).toHaveCount(1);await page.getByRole('button',{name:'取消请求',exact:true}).click();await expect(page.getByRole('button',{name:'取消请求',exact:true})).toHaveCount(0);calls[1].release('不应保存');await expect(page.locator('.chat-pending-images img')).toHaveCount(1);await expect(page.getByLabel('聊天消息',{exact:true})).toHaveValue('下一条图片草稿');await expect(page.locator('.chat-history')).toContainText('原回复。');expect(calls.length).toBe(2);
});

test('重新生成离开后失败只更新原任务状态，不把旧页面错误显示到另一聊天',async({page})=>{
 const {ids,calls}=await setup(page);await send(page,'原问题');await expect.poll(()=>calls.length).toBe(1);calls[0].release('原答案。');await expect(page.locator('.chat-history')).toContainText('原答案。');await page.getByRole('button',{name:'AI 消息操作',exact:true}).press('Enter');await page.getByRole('button',{name:'重新生成',exact:true}).click();await expect.poll(()=>calls.length).toBe(2);
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await open(page,'任务乙');calls[1].release('',true);await expect.poll(async()=>page.evaluate(async id=>(await import('/src/generationTasks.ts')).getGenerationTask(id)?.status,ids.a)).toBe('failed');await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.locator('.chat-history')).not.toContainText('网络请求失败');expect(await messages(page,ids.b)).toEqual([]);
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await open(page,'任务甲');await expect(page.locator('.chat-history')).toContainText('网络请求失败');await expect(page.locator('.chat-history')).toContainText('原答案。');expect(calls.length).toBe(2);
});

test('连续发送保存尚未完成时切换聊天，迟到保存回调不刷新或覆盖新聊天状态',async({page})=>{
 const {ids,calls}=await setup(page);await page.evaluate(async id=>{await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{continuousSend:true});},ids.a);await expect(page.getByRole('button',{name:'AI 回复',exact:true})).toBeVisible();
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const D=Object.getPrototypeOf(db.constructor);await new Promise<void>(ready=>{(window as any).__saveBlock=db.transaction('rw',db.tables,async()=>{await D.waitFor(new Promise<void>(release=>{(window as any).__releaseSave=release;ready();}));});});});
 await send(page,'切换前保存的消息');await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await open(page,'任务乙');await page.evaluate(async()=>{(window as any).__releaseSave();await(window as any).__saveBlock;});await expect(page.getByRole('heading',{name:'任务乙',exact:true})).toBeVisible();await expect(page.locator('.chat-history')).not.toContainText('切换前保存的消息');await expect.poll(async()=>(await messages(page,ids.a)).map(m=>m.content)).toEqual(['切换前保存的消息']);expect(await messages(page,ids.b)).toEqual([]);expect(calls.length).toBe(0);
 await send(page,'乙自己的消息');await expect.poll(()=>calls.length).toBe(1);calls[0].release('只回复乙。');await expect(page.locator('.chat-history')).toContainText('只回复乙。');expect((await messages(page,ids.a)).map(m=>m.content)).toEqual(['切换前保存的消息']);
});
