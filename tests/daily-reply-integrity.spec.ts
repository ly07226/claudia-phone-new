import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
const action='（看你连名带姓地喊我，我轻笑了一声，伸手握住你的手腕）';
const speech='连名带姓喊这么大声，刚才怎么没见你这么害羞？';
const last='（我抓着你的手腕按在沙发垫上，低头凑过去）';
async function setup(page:Page){
 await isolatedApp(page,'daily-integrity-'+crypto.randomUUID());
 return page.evaluate(async()=>{
  const {db,usePhone}=await import('/src/store.ts');
  await db.characters.add({id:'actor',name:'离线角色',persona:'完整人格；条件未发生不能触发条件台词。',speakingStyle:'保留我的个性'});
  await db.worlds.add({id:'world',name:'隔离世界',description:'独立设定',createdAt:1});
  await db.worldProfiles.add({id:'profile',worldId:'world',characterId:'actor',setting:'独立角色设定'});
  await db.apiConfigs.add({id:'api',name:'模拟',provider:'openai-compatible',baseUrl:'https://daily.test/v1',model:'mock',temperature:.7,maxTokens:2000,enabled:true,isDefault:true,createdAt:1,updatedAt:1});
  await db.apiCredentials.add({configId:'api',apiKey:'synthetic-integrity-only'});
  const {getConversation}=await import('/src/chatService.ts');const daily=await getConversation('actor'),world=await getConversation('actor','world');await usePhone.getState().reload();return {daily:daily.id,world:world.id};
 });
}
async function rows(page:Page,id:string){return page.evaluate(async id=>(await import('/src/messagePath.ts')).activeMessages(id),id);}
async function send(page:Page,id:string,text='你好'){return page.evaluate(async({id,text})=>{await(await import('/src/chatService.ts')).sendMessage(id,text);},{id,text});}
for(const separator of ['', '\n', '\n\n\n'])test(`AI 动作边界逐字保留，用户同文不拆 ${JSON.stringify(separator)}`,async({page})=>{
 await setup(page);const text=action+separator+speech+separator+last;
 const result=await page.evaluate(async text=>{
  const {messageBubbles}=await import('/src/messageBubbles.ts');
  const base={id:'m',conversationId:'c',content:text,createdAt:1};
  return {ai:messageBubbles({...base,role:'assistant'}),user:messageBubbles({...base,role:'user'})};
 },text);
 expect(result.ai.map(p=>p.kind==='text'?p.text.trim():'')).toEqual([action,speech,last]);
 expect(result.ai.map(p=>p.kind==='text'?p.text:'').join('')).toBe(text);expect(result.user).toEqual([{kind:'text',start:0,end:text.length,text}]);
});
test('英文动作、普通括号、跨 chunk 与旧删除引用兼容',async({page})=>{
 await setup(page);
 const result=await page.evaluate(async()=>{
  const {splitAssistantBubbles,legacyAssistantBubbles}=await import('/src/splitAssistantBubbles.ts');const {messageBubbles,hasVisiblePart}=await import('/src/messageBubbles.ts');
  const content='（他轻轻笑了）你好（我点头）',old=legacyAssistantBubbles(content)[0];
  const base={id:'m',conversationId:'c',role:'assistant' as const,content,createdAt:1};
  const legacyPart={kind:'text' as const,start:0,end:old.length,text:old};
  return {english:splitAssistantBubbles('(He smiles)Hello.(I nod)'),ordinary:splitAssistantBubbles('这个选择（比如明天一起走）也可以'),chunk:splitAssistantBubbles('（他看着你，轻轻'+'笑了）你怎么了？'),legacyQuote:hasVisiblePart(base,legacyPart),deleted:messageBubbles({...base,bubbleDeletion:{text:[legacyPart],images:[]}})};
 });
 expect(result.english).toEqual(['(He smiles)','Hello.','(I nod)']);expect(result.ordinary).toEqual(['这个选择（比如明天一起走）也可以']);expect(result.chunk).toEqual(['（他看着你，轻轻笑了）','你怎么了？']);expect(result.legacyQuote).toBe(true);expect(result.deleted).toEqual([]);
});
test('实际页面 AI 三泡、用户一泡、刷新保持一条完整原文及图片关联',async({page})=>{
 const {daily}=await setup(page),content=action+'\n\n'+speech+'\n\n'+last;
 await page.route('https://daily.test/**',route=>route.fulfill({json:{choices:[{message:{content},finish_reason:'stop'}]}}));
 await send(page,daily,content);
 await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'离线角色 开始 / 继续聊天',exact:true}).click();
 await expect(page.locator('.chat-message-row-assistant .chat-bubble-surface')).toHaveCount(3);await expect(page.locator('.chat-message-row-user .chat-bubble-surface')).toHaveCount(1);
 const before=await rows(page,daily);expect(before.map(m=>m.content)).toEqual([content,content]);
 await page.reload();await expect(page.locator('.desktop')).toBeVisible();await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'离线角色 开始 / 继续聊天',exact:true}).click();
 await expect(page.locator('.chat-message-row-assistant .chat-bubble-surface')).toHaveCount(3);expect(await rows(page,daily)).toEqual(before);
 const user=await page.evaluate(async()=>{const {messageBubbles}=await import('/src/messageBubbles.ts');const content='（用户动作）\n长文本！'.repeat(80);return {content,bubbles:messageBubbles({id:'user',conversationId:'c',role:'user',content,attachments:[{assetId:'image'}],createdAt:1})};});
 expect(user.bubbles).toEqual([{kind:'image',assetId:'image'},{kind:'text',start:0,end:user.content.length,text:user.content}]);
});
for(const provider of ['openai-compatible','gemini'])test(`${provider} 实际请求结束原因、手动续接同消息、保持原始版本和用户草稿`,async({page})=>{
 const {daily}=await setup(page);await page.evaluate(async provider=>{const {db}=await import('/src/store.ts');await db.apiConfigs.update('api',{provider:provider as 'gemini'});},provider);
 const bodies:any[]=[];let count=0;
 await page.route('https://daily.test/**',route=>{bodies.push(route.request().postDataJSON());count++;const text=count===1?'（他看着你，轻轻':'笑了）你怎么了？';return route.fulfill({json:provider==='gemini'?{candidates:[{content:{parts:[{text}]},finishReason:count===1?'MAX_TOKENS':'STOP'}]}:{choices:[{message:{content:text},finish_reason:count===1?'length':'stop'}]}});});
 await send(page,daily);const first=(await rows(page,daily)).at(-1)!;expect(first.replyInterruption).toBe('length');expect(count).toBe(1);
 await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'离线角色 开始 / 继续聊天',exact:true}).click();await expect(page.getByRole('button',{name:'继续生成',exact:true})).toBeVisible();
 await page.getByLabel('聊天消息',{exact:true}).fill('不应被续接发送的草稿');await page.getByRole('button',{name:'继续生成',exact:true}).click();
 await expect.poll(async()=>(await rows(page,daily)).at(-1)?.content).toBe('（他看着你，轻轻笑了）你怎么了？');
 await expect(page.getByRole('button',{name:'继续生成',exact:true})).toHaveCount(0);await expect(page.getByLabel('聊天消息',{exact:true})).toHaveValue('不应被续接发送的草稿');
 const after=await rows(page,daily);expect(after).toHaveLength(2);expect(after[1].id).toBe(first.id);expect(after[1].createdAt).toBe(first.createdAt);expect(after[1].replyInterruption).toBeUndefined();expect(count).toBe(2);
 expect(JSON.stringify(bodies[1])).toContain('断点继续');expect(JSON.stringify(bodies[1])).not.toContain('不应被续接发送的草稿');
 expect(provider==='gemini'?bodies[0].generationConfig.maxOutputTokens:bodies[0].max_tokens).toBe(2000);
 const variants=await page.evaluate(async id=>(await import('/src/store.ts')).db.messageVariants.where('messageId').equals(id).toArray(),first.id);expect(variants.map(v=>v.content)).toContain(first.content);
});
test('续接失败、重复点击、分支改变及不完整文本不冒充成功',async({page})=>{
 const {daily}=await setup(page);let calls=0;
 await page.route('https://daily.test/**',route=>{calls++;return calls===1?route.fulfill({json:{choices:[{message:{content:'（我还没说完'},finish_reason:'length'}]}}):route.abort();});
 await send(page,daily);const before=await rows(page,daily);
 const error=await page.evaluate(async id=>{try{const {continueMessage}=await import('/src/chatService.ts');await continueMessage(id,(await(await import('/src/messagePath.ts')).activeMessages(id)).at(-1)!.id);return '';}catch(e){return (e as Error).message;}},daily);expect(error).toContain('网络');expect(await rows(page,daily)).toEqual(before);expect(calls).toBe(2);
 await page.route('https://daily.test/**',route=>route.fulfill({json:{choices:[{message:{content:'续接新文字。'},finish_reason:'stop'}]}}));
 const result=await page.evaluate(async id=>{const {db}=await import('/src/store.ts'),{startGenerationTask}=await import('/src/generationTasks.ts');const c=(await db.conversations.get(id))!,rows=await(await import('/src/messagePath.ts')).activeMessages(id);const req={conversation:c,expectedPath:{timelineId:c.activeTimelineId,epoch:c.timelineEpoch??0},text:'',retry:false,continuationId:rows.at(-1)!.id,images:[]};const t=startGenerationTask(req);let rejected=false;try{startGenerationTask(req);}catch{rejected=true;}await t.done;return rejected;},daily);expect(result).toBe(true);
});
test('SSE 跨 UTF8/括号边界、网络中断、未确认结束及输出限制保留所有增量',async({page})=>{
 await setup(page);
 const result=await page.evaluate(async()=>{
  const {requestChatReply}=await import('/src/chatProvider.ts');const {db}=await import('/src/store.ts');const c=(await db.apiConfigs.get('api'))!,messages=[{role:'system' as const,content:'系统'},{role:'user' as const,content:'你好'}];
  async function call(mode:string){let n=0;const chunks=['data: '+JSON.stringify({choices:[{index:0,delta:{content:'（他看着你，轻轻'}}]})+'\n\n','data: '+JSON.stringify({choices:[{index:0,delta:{content:'笑了）你怎么了？'},finish_reason:mode==='length'?'length':null}]})+'\n\n',...(mode==='stop'?['data: [DONE]\n\n']:[])];const bytes=new TextEncoder().encode(chunks.join(''));const stream=new ReadableStream<Uint8Array>({pull(ctrl){if(n<bytes.length){ctrl.enqueue(bytes.slice(n,n+7));n+=7;}else if(mode==='network')ctrl.error(new TypeError('simulated network loss'));else ctrl.close();}});return requestChatReply(c,'synthetic',messages,new AbortController().signal,{send:async()=>new Response(stream,{headers:{'content-type':'text/event-stream'}})});}
  return Promise.all(['stop','length','network','unknown'].map(call));
 });
 for(const value of result)expect(value.text).toBe('（他看着你，轻轻笑了）你怎么了？');expect(result.map(v=>v.interruption)).toEqual([undefined,'length','network','stream']);
});
test('日常默认节奏只进入 Daily、明确长内容请求保留、World/Story 不受新指令影响',async({page})=>{
 const {daily,world}=await setup(page),requests:any[]=[];
 await page.route('https://daily.test/**',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{choices:[{message:{content:'完整的详细说明。'.repeat(500)},finish_reason:'stop'}]}});});
 await send(page,daily,'请详细解释并写长篇内容，不要省略。');await send(page,world,'继续世界内的事情');
 expect(requests[0].messages[0].content).toContain('即时通讯');expect(requests[0].messages[0].content).toContain('不设固定字数');expect(requests[0].messages[0].content).toContain('完整人格');expect(requests[0].messages.at(-1).content).toBe('请详细解释并写长篇内容，不要省略。');expect(requests[1].messages[0].content).not.toContain('即时通讯');
 expect(requests.every(b=>b.max_tokens===2000&&b.stream===false)).toBe(true);expect((await rows(page,daily)).at(-1)?.content).toHaveLength('完整的详细说明。'.length*500);
});
test('正常未闭合括号不推断中断；HTTP/网络失败保留用户消息且不自动重试',async({page})=>{
 const {daily}=await setup(page);let count=0;
 await page.route('https://daily.test/**',route=>{count++;return route.fulfill({json:{choices:[{message:{content:'（故意保留开放格式'},finish_reason:'stop'}]}});});await send(page,daily);expect((await rows(page,daily)).at(-1)?.replyInterruption).toBeUndefined();
 await page.route('https://daily.test/**',route=>{count++;return route.fulfill({status:503,json:{error:{message:'server unavailable'}}});});
 const error=await page.evaluate(async id=>{try{await(await import('/src/chatService.ts')).sendMessage(id,'新消息保留');return '';}catch(e){return (e as Error).message;}},daily);expect(error).toContain('503');expect((await rows(page,daily)).at(-1)?.content).toBe('新消息保留');expect(count).toBe(2);
});
test('中断标记及原文完整 ZIP 往返，不改变数据库版本或用户历史',async({page})=>{
 const {daily}=await setup(page);
 await page.route('https://daily.test/**',route=>route.fulfill({json:{choices:[{message:{content:'（他看着你，轻轻'},finish_reason:'length'}]}}));await send(page,daily,'我已发送的原文');
 const check=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const before=await(await import('/src/messagePath.ts')).activeMessages(id);
  const {createZipBackup,readBackupZip}=await import('/src/backupZip.ts');const {readBackup}=await import('/src/backupService.ts');const blob=await createZipBackup({closedOtherClients:true});const files=await readBackupZip(new File([blob],'fixture.zip'));const result=await readBackup(files,{mode:'verify'});
  return {before,after:await(await import('/src/messagePath.ts')).activeMessages(id),valid:result.report.status==='verified',version:db.verno};
 },daily);
 expect(check.valid).toBe(true);expect(check.version).toBe(7);expect(check.before).toEqual(check.after);expect(check.after.at(-1)?.replyInterruption).toBe('length');
});
test('续接精确去重与无新内容拒绝；不擅自补括号或改写前文',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{const {appendContinuation}=await import('/src/chatCompletion.ts');const original='这是原文，必须逐字保留的尾段';let error='';try{appendContinuation(original,original);}catch(e){error=(e as Error).message;}return {value:appendContinuation(original,'必须逐字保留的尾段，接着说完。'),open:appendContinuation('（未闭合','继续'),error};});
 expect(result.value).toBe('这是原文，必须逐字保留的尾段，接着说完。');expect(result.open).toBe('（未闭合继续');expect(result.error).toContain('未返回新的内容');
});
test('SSE 传输未结束的真实服务保存部分原文，不伪报正常完成',async({page})=>{
 const {daily}=await setup(page);let calls=0;
 await page.route('https://daily.test/**',route=>{calls++;return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{index:0,delta:{content:'（他看着你，轻轻'}}]})+'\n\n'});});
 await send(page,daily);const saved=(await rows(page,daily)).at(-1)!;expect(saved.content).toBe('（他看着你，轻轻');expect(saved.replyInterruption).toBe('stream');expect(calls).toBe(1);
 await page.reload();await expect(page.locator('.desktop')).toBeVisible();expect((await rows(page,daily)).at(-1)).toEqual(saved);expect(calls).toBe(1);
});
test('传输收到部分文本后超时，通过服务层保留断点并标为中断',async({page})=>{
 const {daily}=await setup(page);await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
 await page.evaluate(id=>{
  const originalFetch=window.fetch.bind(window);(window as any).__received=false;
  window.fetch=async(input,init)=>{
   if(!String(input).startsWith('https://daily.test/'))return originalFetch(input,init);
   return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'（他继续说到一半'}}]})+'\n\n'));(window as any).__received=true;init?.signal?.addEventListener('abort',()=>controller.error(new DOMException('timeout','AbortError')),{once:true});}}),{headers:{'content-type':'text/event-stream'}});
  };
  void import('/src/chatService.ts').then(m=>m.sendMessage(id,'超时前原文')).then(()=>{(window as any).__finished=true;}).catch(e=>{(window as any).__failure=e.message;});
 },daily);
 await expect.poll(()=>page.evaluate(()=>(window as any).__received)).toBe(true);await page.clock.runFor(60001);
 await expect.poll(()=>page.evaluate(()=>(window as any).__finished)).toBe(true);expect((await rows(page,daily)).at(-1)).toMatchObject({content:'（他继续说到一半',replyInterruption:'timeout'});
 expect(await page.evaluate(()=>(window as any).__failure)).toBeUndefined();
});
test('续接期间路径改变，迟到结果不能覆盖任何分支',async({page})=>{
 const {daily}=await setup(page);await page.route('https://daily.test/**',route=>route.fulfill({json:{choices:[{message:{content:'原有部分回复'},finish_reason:'length'}]}}));await send(page,daily,'原有用户内容');
 const before=await rows(page,daily);let release!:()=>void;let started=false;await page.route('https://daily.test/**',async route=>{started=true;await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({json:{choices:[{message:{content:'迟到续接'},finish_reason:'stop'}]}}).catch(()=>{});});
 await page.evaluate(id=>{void import('/src/chatService.ts').then(async m=>{const rows=await(await import('/src/messagePath.ts')).activeMessages(id);try{await m.continueMessage(id,rows.at(-1)!.id);}catch(e){(window as any).__staleError=(e as Error).message;}});},daily);
 await expect.poll(()=>started).toBe(true);await page.evaluate(async({id,user})=>{await(await import('/src/messageOperations.ts')).editMessage(id,user,'只属于新路径',true);},{id:daily,user:before[0].id});release();
 await expect.poll(()=>page.evaluate(()=>(window as any).__staleError)).toBeTruthy();const after=await rows(page,daily);expect(after.map(m=>m.content)).toEqual(['只属于新路径']);
 expect(await page.evaluate(async mid=>(await import('/src/store.ts')).db.messageVariants.where('messageId').equals(mid).toArray(),before[1].id)).not.toContainEqual(expect.objectContaining({content:expect.stringContaining('迟到续接')}));
});
test('动作之间的纯标点、环境和心理片段逐字保留；说明括号不误拆',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{const {splitAssistantBubbles}=await import('/src/splitAssistantBubbles.ts');const values=['（他笑了）——（我点头）','（窗外传来雨声）你带伞了吗？（心里有些担心）','这本书（我看过这本书）值得推荐','他说：“（我笑了）只是括号示例。”'];return values.map(text=>({text,pieces:splitAssistantBubbles(text)}));});
 for(const r of result){expect(r.pieces.join('')).toBe(r.text);expect(r.pieces.every(t=>t.trim())).toBe(true);}expect(result[0].pieces).toEqual(['（他笑了）——','（我点头）']);expect(result[1].pieces).toHaveLength(3);expect(result[2].pieces).toEqual([result[2].text]);expect(result[3].pieces).toEqual([result[3].text]);
});
test('默认简洁指导不挤掉接近预算上限的原有人设、记忆或当前消息',async({page})=>{
 const {daily}=await setup(page);const result=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');const persona='必要设定'.repeat(5950);await db.characters.update('actor',{persona});await db.messages.add({id:'budget-user',conversationId:id,role:'user',content:'当前消息不能丢失',createdAt:1});const context=await(await import('/src/chatContext.ts')).buildContext((await db.conversations.get(id))!);return {persona,context};},daily);
 expect(result.context[0].content).toContain(result.persona);expect(result.context[0].content.length).toBeLessThanOrEqual(24000);expect(result.context[0].content).not.toContain('日常交流默认采用即时通讯');expect(result.context.at(-1)?.content).toBe('当前消息不能丢失');
});
test('手动续接保留未发送的图片与文字，图片不误入续接请求',async({page})=>{
 const {daily}=await setup(page);let count=0;const bodies:any[]=[];
 await page.route('https://daily.test/**',route=>{count++;bodies.push(route.request().postDataJSON());return route.fulfill({json:{choices:[{message:{content:count===1?'这条消息还没':'说完。'},finish_reason:count===1?'length':'stop'}]}});});
 await send(page,daily);await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:'离线角色 开始 / 继续聊天',exact:true}).click();
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=8;return c.toDataURL().split(',')[1];});await page.getByRole('button',{name:'图片附件',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'相册',exact:true}).click();await(await chooser).setFiles({name:'unsent.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
 await expect(page.locator('.chat-pending-images img')).toHaveCount(1);await page.getByLabel('聊天消息',{exact:true}).fill('我的未发送图片说明');await page.getByRole('button',{name:'继续生成',exact:true}).click();
 await expect.poll(async()=>(await rows(page,daily)).at(-1)?.content).toBe('这条消息还没说完。');await expect(page.locator('.chat-pending-images img')).toHaveCount(1);await expect(page.getByLabel('聊天消息',{exact:true})).toHaveValue('我的未发送图片说明');expect(JSON.stringify(bodies[1])).not.toContain('image_url');expect(JSON.stringify(bodies[1])).not.toContain('我的未发送图片说明');expect(count).toBe(2);
});
