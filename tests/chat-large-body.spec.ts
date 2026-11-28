import {test,expect} from '@playwright/test';
import {seedPerformance} from './performanceFixture';
for(const count of [1000,5000,10000])test(`长正文与真实版本行的聊天路径 ${count}`,async({page},info)=>{
 test.setTimeout(120000);console.log('LARGE_STEP',count,'seed');const id=await seedPerformance(page,count);console.log('LARGE_STEP',count,'enrich');
 const bodyChars=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts'),{messageFingerprint}=await import('/src/timelines.ts');
  const messages=await db.messages.where('conversationId').equals(id).sortBy('createdAt');let totalChars=0;
  for(let start=0;start<messages.length;start+=64){
   const slice=messages.slice(start,start+64).map(m=>({...m,content:`第${m.id}条已保存原文。`+'保存长聊天中的原始经历和因果关系。'.repeat(64),...(m.role==='assistant'?{activeVariantId:'v'+m.id}:{})}));
   totalChars+=slice.reduce((n,m)=>n+m.content.length,0);
   const fingerprints=await Promise.all(slice.map(messageFingerprint));
   await db.transaction('rw',db.messages,db.messageVariants,db.pathNodes,async()=>{
    await db.messages.bulkPut(slice);
    await db.messageVariants.bulkPut(slice.filter(m=>m.role==='assistant').map(m=>({id:m.activeVariantId!,messageId:m.id,conversationId:id,content:m.content,createdAt:m.createdAt,source:'generated' as const})));
    const nodes=await db.pathNodes.bulkGet(slice.map((_,n)=>'n'+(start+n)));await db.pathNodes.bulkPut(nodes.map((node,n)=>({...node!,message:slice[n],variantId:slice[n].activeVariantId,fingerprint:fingerprints[n]}))); 
   });
  }
  return totalChars;
 },id);
 console.log('LARGE_STEP',count,'open');await page.getByRole('button',{name:'聊天',exact:true}).click();const started=Date.now();await page.locator('.chat-list-row').filter({hasText:'性能角色'}).click();await expect(page.locator('.chat-bubble').last()).toHaveAttribute('data-message-id','m'+(count-1));const openMs=Date.now()-started;
 await page.evaluate(()=>{const state={last:performance.now(),max:0,timer:0};state.timer=window.setInterval(()=>{const now=performance.now();state.max=Math.max(state.max,now-state.last);state.last=now;},16);(window as any).__chatPerfLag=state;});
 const input=page.getByLabel('聊天消息',{exact:true}),text='长正文数据库输入测试';let now=Date.now();await input.pressSequentially(text,{delay:0});const typingMs=Date.now()-now;
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts'),get=db.pathNodes.get.bind(db.pathNodes);(window as any).__pathGets=0;(window as any).__restorePathGet=()=>{db.pathNodes.get=get;};db.pathNodes.get=((...args:any[])=>{(window as any).__pathGets++;return (get as any)(...args);}) as any;});
 const priorError=(await page.getByRole('alert').allTextContents()).join(' ');let sendError='';
 console.log('LARGE_STEP',count,'send');now=Date.now();await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(async()=>{if((await page.locator('.chat-bubble').last().innerText()).includes(text))return 'saved';const error=(await page.getByRole('alert').allTextContents()).join(' ');if(error&&error!==priorError){sendError=error;return 'failed';}return 'pending';},{timeout:90000}).not.toBe('pending');const sendMs=sendError?null:Date.now()-now;
 const data=await page.evaluate(async id=>{const {db}=await import('/src/store.ts');return {messages:await db.messages.where('conversationId').equals(id).count(),variants:await db.messageVariants.where('conversationId').equals(id).count()};},id);
 const pathGets=await page.evaluate(()=>{(window as any).__restorePathGet();return (window as any).__pathGets;});
 const maxTimerGapMs=await page.evaluate(()=>{const state=(window as any).__chatPerfLag;clearInterval(state.timer);return state.max;});
 const metrics={count,bodyChars,openMs,typingMs,sendMs,sendError,pathGets,maxTimerGapMs,mounted:await page.locator('.chat-message-row').count(),...data};console.log('LARGE_BODY_PERFORMANCE',JSON.stringify(metrics));await info.attach('long-body-metrics',{body:JSON.stringify(metrics),contentType:'application/json'});
 expect(pathGets).toBeLessThan(200);expect(data.messages).toBe(count+1);expect(data.variants).toBe(count/2);await expect(input).toHaveValue('');expect(metrics.mounted).toBeLessThanOrEqual(60);
});
