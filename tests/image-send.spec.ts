import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
async function seed(page:Page,provider='openai-compatible'){
 await isolatedApp(page,'image-chat-'+crypto.randomUUID());
 return page.evaluate(async provider=>{
  const {db,usePhone}=await import('/src/store.ts');const {getConversation}=await import('/src/chatService.ts');
  await db.characters.bulkAdd([{id:'image-a',name:'图片角色',persona:''},{id:'image-b',name:'另一图片角色',persona:''}]);await db.worlds.add({id:'image-w',name:'图片世界',description:'',createdAt:1});await db.worldProfiles.add({id:'image-p',worldId:'image-w',characterId:'image-a',setting:''});
  await db.apiConfigs.add({id:'image-api',name:'模拟',provider,baseUrl:'https://image-model.test/v1',model:'vision-fixture',enabled:true,isDefault:true,temperature:.7,maxTokens:100,createdAt:1,updatedAt:1});await db.apiCredentials.add({configId:'image-api',apiKey:'synthetic-fixture-only'});const a=await getConversation('image-a'),b=await getConversation('image-b'),w=await getConversation('image-a','image-w');await usePhone.getState().reload();return {a:a.id,b:b.id,w:w.id};
 },provider);
}
async function image(page:Page,mime='image/png',width=100,height=80){return page.evaluate(({mime,width,height})=>{const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d')!;ctx.fillStyle='#87a88b';ctx.fillRect(0,0,width,height);return c.toDataURL(mime);},{mime,width,height});}
async function stored(page:Page,count=1){const src=await image(page);return page.evaluate(async({src,count})=>{const {db}=await import('/src/store.ts');const ids=Array.from({length:count},()=>crypto.randomUUID());await db.assets.bulkAdd(ids.map(id=>({id,type:'chat-image',data:src,createdAt:1})));return ids;},{src,count});}
async function open(page:Page){await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'图片角色 开始 / 继续聊天',exact:true}).click();}

for(const width of [375,390,430])test(`附件菜单、选择移除、图片草稿刷新、图片加文字发送持久化及大图：${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});const ids=await seed(page);let calls=0;await page.route('https://image-model.test/**',async r=>{calls++;await r.fulfill({json:{choices:[{message:{content:'图片回复'}}]}});});await open(page);
 const plus=page.getByRole('button',{name:'图片附件',exact:true});await expect(plus).toBeEnabled();await plus.click();await expect(plus).toHaveAttribute('aria-expanded','true');await expect(page.getByRole('menuitem')).toHaveText(['相册','拍照','文件']);await plus.click();await expect(page.getByRole('menu',{name:'添加图片'})).toHaveCount(0);
 await plus.click();await page.locator('.chat-history').click();await expect(plus).toHaveAttribute('aria-expanded','false');
 await expect(page.getByLabel('拍照图片',{exact:true})).toHaveAttribute('capture','environment');
 const src=await image(page);await page.getByLabel('相册图片',{exact:true}).setInputFiles([1,2,3].map(n=>({name:`photo${n}.png`,mimeType:'image/png',buffer:Buffer.from(src.split(',')[1],'base64')})));
 await expect(page.locator('.chat-pending-images img')).toHaveCount(3);await page.getByRole('button',{name:'移除待发送图片'}).first().click();await expect(page.locator('.chat-pending-images img')).toHaveCount(2);
 const input=page.getByLabel('聊天消息',{exact:true});await input.fill('看看这两张图片');
 await expect.poll(()=>page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.imageDrafts?.['']?.text,ids.a)).toBe('看看这两张图片');
 await page.reload();await expect(page.locator('.desktop')).toBeVisible();await open(page);await expect(input).toHaveValue('看看这两张图片');await expect(page.locator('.chat-pending-images img')).toHaveCount(2);
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.chat-history')).toContainText('图片回复');await expect(page.locator('.chat-pending-images img')).toHaveCount(0);await expect(page.locator('.chat-message-images img')).toHaveCount(2);expect(calls).toBe(1);
 await page.getByRole('button',{name:'查看聊天图片'}).first().click();await expect(page.getByRole('dialog',{name:'聊天图片大图'})).toBeVisible();await page.getByRole('button',{name:'关闭图片大图'}).click();
 await page.reload();await expect(page.locator('.desktop')).toBeVisible();await open(page);await expect(page.locator('.chat-message-images img')).toHaveCount(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const r=await page.evaluate(()=>{const p=document.querySelector('.chat-attachment-control')!.getBoundingClientRect(),t=document.querySelector('.chat-compose textarea')!.getBoundingClientRect();return {inside:p.left>=t.left&&p.right<=t.right,padding:parseFloat(getComputedStyle(document.querySelector('.chat-compose textarea')!).paddingRight)};});expect(r.inside).toBe(true);expect(r.padding).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:`/tmp/claudia-images-${width}.png`,animations:'disabled'});
});

for(const provider of ['openai-compatible','gemini'])for(const text of ['', '图片与文字一起'])test(`真实发送链路多模态格式 ${provider} caption=${!!text}`,async({page})=>{
 const ids=await seed(page,provider),images=await stored(page,3);let body:any;await page.route('https://image-model.test/**',async r=>{body=r.request().postDataJSON();await r.fulfill({json:provider==='gemini'?{candidates:[{content:{parts:[{text:'看图回复'}]}}]}:{choices:[{message:{content:'看图回复'}}]}});});
 await page.evaluate(async({id,text,images})=>{await(await import('/src/chatService.ts')).sendMessage(id,text,new AbortController().signal,false,undefined,undefined,images);},{id:ids.a,text,images});
 if(provider==='gemini'){const parts=body.contents.flatMap((m:any)=>m.parts);expect(parts.filter((p:any)=>p.inlineData)).toHaveLength(3);for(const part of parts.filter((p:any)=>p.inlineData)){expect(part.inlineData.mimeType).toBe('image/png');expect(part.inlineData.data).not.toContain('data:');}}
 else{const user=body.messages.find((m:any)=>m.role==='user');expect(user.content.filter((p:any)=>p.type==='image_url')).toHaveLength(3);expect(user.images).toBeUndefined();expect(user.content.filter((p:any)=>p.type==='text').map((p:any)=>p.text)).toEqual(text?[text]:[]);}
 const result=await page.evaluate(async({a,b,w})=>{const {activeMessages}=await import('/src/messagePath.ts');const rows=await activeMessages(a);const ctx=await(await import('/src/chatContext.ts')).buildContext((await(await import('/src/store.ts')).db.conversations.get(a))!);return {rows,b:await activeMessages(b),w:await activeMessages(w),texts:ctx.map(m=>m.content)};},ids);
 expect(result.rows).toHaveLength(2);expect(result.rows[0].content).toBe(text);expect(result.rows[0].attachments).toEqual(images.map(assetId=>({assetId})));expect(result.b).toHaveLength(0);expect(result.w).toHaveLength(0);expect(result.texts.join('')).not.toContain('data:image');
});

test('不支持模型预检与服务拒绝、网络失败保留图片；连续发送图片不自动生成',async({page})=>{
 const ids=await seed(page),images=await stored(page);let calls=0;
 await page.route('https://image-model.test/**',async r=>{calls++;await r.fulfill({status:400,json:{error:{message:'model does not support image input synthetic-fixture-only'}}});});
 const invoke=()=>page.evaluate(async({id,images})=>{try{await(await import('/src/chatService.ts')).sendMessage(id,'图片说明',new AbortController().signal,false,undefined,undefined,images);return '';}catch(e){return(e as Error).message;}},{id:ids.a,images});
 await page.evaluate(async()=>{await(await import('/src/store.ts')).db.apiConfigs.update('image-api',{model:'gpt-3.5-turbo'});});expect(await invoke()).toContain('不支持图片');expect(calls).toBe(0);
 await page.evaluate(async()=>{await(await import('/src/store.ts')).db.apiConfigs.update('image-api',{model:'vision-fixture'});});expect(await invoke()).toContain('拒绝图片输入');expect(calls).toBe(1);
 const saved=await page.evaluate(async id=>(await(await import('/src/messagePath.ts')).activeMessages(id)),ids.a);expect(saved).toHaveLength(1);expect(saved[0].attachments).toHaveLength(1);
 await page.evaluate(async({id,images})=>{await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{continuousSend:true});await(await import('/src/chatService.ts')).queueUserMessage(id,'',undefined,images);},{id:ids.b,images});expect(calls).toBe(1);
 await page.route('https://image-model.test/**',r=>r.abort());expect(await invoke()).toContain('网络请求失败');expect((await page.evaluate(async id=>(await(await import('/src/messagePath.ts')).activeMessages(id)),ids.a)).at(-1)!.attachments).toHaveLength(1);
});

test('格式/读取/超限拒绝，JPEG PNG WebP均可用，大图明确压缩',async({page})=>{
 await seed(page);
 for(const mime of ['image/jpeg','image/png','image/webp']){
  const src=await image(page,mime);const result=await page.evaluate(async src=>{const blob=await(await fetch(src)).blob();return(await import('/src/imageAttachments.ts')).prepareImage(new File([blob],'fixture',{type:blob.type}));},src);expect(result.data.startsWith(`data:${mime};base64,`)).toBe(true);
 }
 const large=await image(page,'image/png',3200,2400);const compressed=await page.evaluate(async src=>{const blob=await(await fetch(src)).blob();return(await import('/src/imageAttachments.ts')).prepareImage(new File([blob],'large.png',{type:blob.type}));},large);expect(compressed.width).toBe(1600);expect(compressed.height).toBe(1200);expect(compressed.notice).toContain('质量85%');
 const errors=await page.evaluate(async()=>{const {prepareImage}=await import('/src/imageAttachments.ts');const files=[new File(['heic'],'photo.heic',{type:'image/heic'}),new File([new Uint8Array(16*1024*1024)],'huge.jpg',{type:'image/jpeg'}),new File([new Uint8Array([255,216,255,0])],'broken.jpg',{type:'image/jpeg'})];return Promise.all(files.map(async file=>{try{await prepareImage(file);return '';}catch(e){return(e as Error).message;}}));});expect(errors[0]).toContain('HEIC');expect(errors[1]).toContain('15MB');expect(errors[2]).toContain('无法读取');
});

test('图片编辑、撤回、快照及分支共享资源；ZIP覆盖恢复到空手机后图片和时间线完整',async({page,browser})=>{
 const ids=await seed(page),images=await stored(page);
 const exported=await page.evaluate(async({id,images})=>{
  const {db}=await import('/src/store.ts');const {queueUserMessage}=await import('/src/chatService.ts');const {saveChatSettings}=await import('/src/chatPreferences.ts');const {getCurrentTimeline,switchTimeline}=await import('/src/timelines.ts');const {editMessage,removeMessage,restoreSnapshot}=await import('/src/messageOperations.ts');const {activeMessages}=await import('/src/messagePath.ts');
  await saveChatSettings(id,{continuousSend:true});await queueUserMessage(id,'原图注释',undefined,images);const root=await getCurrentTimeline(id),m=(await activeMessages(id))[0];
  await editMessage(id,m.id,'新注释',true);const child=await getCurrentTimeline(id);await switchTimeline(id,root.id);if((await activeMessages(id))[0].content!=='原图注释')throw Error('原分支受影响');await switchTimeline(id,child.id);
  await editMessage(id,m.id,'',true);await removeMessage(id,m.id,'withdraw',true);if((await activeMessages(id)).length)throw Error('撤回失败');if(!await db.assets.get(images[0]))throw Error('误删共享资源');
  const snap=(await db.conversationSnapshots.where('conversationId').equals(id).toArray()).find(s=>s.reason==='withdraw')!;await restoreSnapshot(id,snap.id);if((await activeMessages(id))[0].attachments?.[0].assetId!==images[0])throw Error('快照附件丢失');
  const file=await(await import('/src/backupZip.ts')).createZipBackup({closedOtherClients:true});return Array.from(new Uint8Array(await file.arrayBuffer()));
 },{id:ids.a,images});
 const context=await browser.newContext(),target=await context.newPage();
 try{
  await isolatedApp(target,'image-restore-'+crypto.randomUUID());
  const result=await target.evaluate(async bytes=>{
   const {db}=await import('/src/store.ts');const files=await(await import('/src/backupZip.ts')).readBackupZip(new File([new Uint8Array(bytes)],'image.zip'));const {prepareImport,defaultImportOptions}=await import('/src/importPlan.ts');const plan=await prepareImport(files,{...defaultImportOptions,mode:'overwrite'});try{await(await import('/src/restoreService.ts')).restoreToCurrent([],{confirmed:true,plan});}finally{await plan.dispose();}
   return {assets:await db.assets.count(),conversations:await db.conversations.toArray(),messages:await db.messages.toArray(),nodes:await db.pathNodes.toArray()};
  },exported);
  expect(result.assets).toBeGreaterThan(0);expect(result.nodes.some(n=>n.message.attachments?.length)).toBe(true);
  await target.reload();await expect(target.locator('.desktop')).toBeVisible();await open(target);await expect(target.locator('.chat-message-images img')).toHaveCount(1);await expect(target.locator('.chat-message-images img')).toHaveAttribute('src',/^data:image\/png;base64,/);
 }finally{await context.close();}
});

test('合并时图片ID冲突完整重映射、原数据保留、重复导入幂等；缺失历史图片拒绝备份',async({page,browser})=>{
 const ids=await seed(page),images=await stored(page);
 const bytes=await page.evaluate(async({id,images})=>{
  await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{continuousSend:true});await(await import('/src/chatService.ts')).queueUserMessage(id,'源图片',undefined,images);
  const file=await(await import('/src/backupZip.ts')).createZipBackup({closedOtherClients:true});return Array.from(new Uint8Array(await file.arrayBuffer()));
 },{id:ids.a,images});
 const ctx=await browser.newContext(),target=await ctx.newPage();
 try{
  await seed(target);await target.evaluate(async imageId=>{const {db}=await import('/src/store.ts');await db.characters.update('image-a',{persona:'目标手机保持'});await db.assets.put({id:imageId,type:'chat-image',data:'data:image/png;base64,aGVsbG8=',createdAt:1});},images[0]);
  const merge=()=>target.evaluate(async bytes=>{
   const files=await(await import('/src/backupZip.ts')).readBackupZip(new File([new Uint8Array(bytes)],'image.zip'));const {prepareImport,defaultImportOptions}=await import('/src/importPlan.ts');const plan=await prepareImport(files,{...defaultImportOptions,mode:'merge'});try{await(await import('/src/restoreService.ts')).restoreToCurrent([],{confirmed:true,plan});}finally{await plan.dispose();}
   const {db}=await import('/src/store.ts');const imported=(await db.messages.toArray()).find(m=>m.content==='源图片')!;const messages=await(await import('/src/messagePath.ts')).activeMessages(imported.conversationId);const asset=await db.assets.get(messages[0].attachments![0].assetId);return {count:await db.messages.count(),asset,id:messages[0].attachments![0].assetId,persona:(await db.characters.get('image-a'))!.persona};
  },bytes);
  const first=await merge();expect(first.id).not.toBe(images[0]);expect(first.asset?.data).not.toBe('data:image/png;base64,aGVsbG8=');expect(first.persona).toBe('目标手机保持');
  await target.reload();await expect(target.locator('.desktop')).toBeVisible();const second=await merge();expect(second.count).toBe(first.count);expect(second.id).toBe(first.id);
 }finally{await ctx.close();}
 const error=await page.evaluate(async imageId=>{const {db}=await import('/src/store.ts');await db.assets.delete(imageId);try{await(await import('/src/backupZip.ts')).createZipBackup({closedOtherClients:true});return '';}catch(e){return(e as Error).message;}},images[0]);expect(error).toContain('图片资源缺失');
});

test('发送前存储失败保留原始输入，取消选择无影响，附件上限和缩小视口菜单可见',async({page})=>{
 await seed(page);await open(page);const input=page.getByLabel('聊天消息',{exact:true});await input.fill('保留我输入的文字');
 await page.getByLabel('相册图片',{exact:true}).setInputFiles([]);await expect(input).toHaveValue('保留我输入的文字');
 const src=await image(page);await page.evaluate(()=>{const attach=async()=>{const {db}=await import('/src/store.ts');const original=db.assets.add.bind(db.assets);(window as any).__restoreAssetAdd=()=>{db.assets.add=original;};db.assets.add=()=>Promise.reject(new DOMException('synthetic-quota','QuotaExceededError')) as any;};return attach();});
 await page.getByLabel('相册图片',{exact:true}).setInputFiles({name:'x.png',mimeType:'image/png',buffer:Buffer.from(src.split(',')[1],'base64')});await expect(page.getByRole('alert')).toContainText('存储空间不足');await expect(input).toHaveValue('保留我输入的文字');await expect(page.locator('.chat-pending-images img')).toHaveCount(0);await page.evaluate(()=>(window as any).__restoreAssetAdd());
 await page.getByLabel('相册图片',{exact:true}).setInputFiles([1,2,3,4].map(i=>({name:`${i}.png`,mimeType:'image/png',buffer:Buffer.from(src.split(',')[1],'base64')})));await expect(page.getByRole('alert')).toContainText('最多3张');
 await page.setViewportSize({width:375,height:360});await page.getByRole('button',{name:'图片附件',exact:true}).click();const menu=page.getByRole('menu',{name:'添加图片'});await expect(menu).toBeVisible();expect(await menu.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
});

test('待发送草稿按分支恢复，切换角色不串图；图片发送后不进入另一分支或世界',async({page})=>{
 const ids=await seed(page);await page.evaluate(async id=>{await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{continuousSend:true});await(await import('/src/chatService.ts')).queueUserMessage(id,'初始路径');},ids.a);await open(page);
 const root=await page.evaluate(async id=>(await(await import('/src/timelines.ts')).getCurrentTimeline(id)).id,ids.a);
 const src=await image(page);await page.getByLabel('相册图片',{exact:true}).setInputFiles({name:'branch.png',mimeType:'image/png',buffer:Buffer.from(src.split(',')[1],'base64')});await expect(page.locator('.chat-pending-images img')).toHaveCount(1);await page.getByLabel('聊天消息',{exact:true}).fill('分支草稿');
 await expect.poll(()=>page.evaluate(async({id,root})=>(await(await import('/src/store.ts')).db.conversations.get(id))?.imageDrafts?.[root]?.text,{id:ids.a,root})).toBe('分支草稿');
 await page.evaluate(async id=>{const {activeMessages}=await import('/src/messagePath.ts');await(await import('/src/messageOperations.ts')).editMessage(id,(await activeMessages(id))[0].id,'另一条分支',true);},ids.a);
 const child=await page.evaluate(async id=>(await(await import('/src/timelines.ts')).getCurrentTimeline(id)).id,ids.a);await expect(page.locator('.chat-pending-images img')).toHaveCount(0);await expect(page.getByLabel('聊天消息',{exact:true})).toHaveValue('');
 await page.evaluate(async({id,root})=>{await(await import('/src/timelines.ts')).switchTimeline(id,root);},{id:ids.a,root});await expect(page.locator('.chat-pending-images img')).toHaveCount(1);await expect(page.getByLabel('聊天消息',{exact:true})).toHaveValue('分支草稿');
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.chat-message-images img')).toHaveCount(1);await expect(page.locator('.chat-pending-images img')).toHaveCount(0);
 await page.evaluate(async({id,child})=>{await(await import('/src/timelines.ts')).switchTimeline(id,child);},{id:ids.a,child});await expect(page.locator('.chat-message-images img')).toHaveCount(0);
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.getByRole('button',{name:'另一图片角色 开始 / 继续聊天',exact:true}).click();await expect(page.locator('.chat-pending-images img')).toHaveCount(0);await expect(page.locator('.chat-message-images img')).toHaveCount(0);
 expect(await page.evaluate(async id=>(await(await import('/src/messagePath.ts')).activeMessages(id)).length,ids.w)).toBe(0);
});

test('连续发送保存期间输入下一条文字，不复活已经发送的图片草稿',async({page})=>{
 const ids=await seed(page);await page.evaluate(async id=>{await(await import('/src/chatPreferences.ts')).saveChatSettings(id,{continuousSend:true});await(await import('/src/chatService.ts')).queueUserMessage(id,'初始路径');},ids.a);await open(page);
 const src=await image(page);await page.getByLabel('相册图片',{exact:true}).setInputFiles({name:'save.png',mimeType:'image/png',buffer:Buffer.from(src.split(',')[1],'base64')});await expect(page.locator('.chat-pending-images img')).toHaveCount(1);
 const input=page.getByLabel('聊天消息',{exact:true});await input.fill('本次图片');await expect.poll(()=>page.evaluate(async id=>{const {db}=await import('/src/store.ts');const c=(await db.conversations.get(id))!;return c.imageDrafts?.[c.activeTimelineId!]?.text;},ids.a)).toBe('本次图片');
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const D=Object.getPrototypeOf(db.constructor);await new Promise<void>(ready=>{(window as any).__saveBlock=db.transaction('rw',db.tables,async()=>{await D.waitFor(new Promise<void>(release=>{(window as any).__releaseSave=release;ready();}));});});});
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('button',{name:'取消请求',exact:true})).toBeVisible();await expect(input).toBeEnabled();await input.fill('下一条尚未发送文字');
 await page.evaluate(async()=>{(window as any).__releaseSave();await(window as any).__saveBlock;});await expect(page.locator('.chat-message-images img')).toHaveCount(1);await expect(page.locator('.chat-pending-images img')).toHaveCount(0);await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible();await expect(input).toHaveValue('下一条尚未发送文字');
 const result=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');const c=(await db.conversations.get(id))!;return {draft:c.imageDrafts?.[c.activeTimelineId!],messages:await(await import('/src/messagePath.ts')).activeMessages(id)};},ids.a);expect(result.draft).toBeUndefined();expect(result.messages.at(-1)?.content).toBe('本次图片');expect(result.messages.at(-1)?.attachments).toHaveLength(1);
});
