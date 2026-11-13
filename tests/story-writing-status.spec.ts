import {test,expect} from '@playwright/test';
import {storySeed,reply} from './storyFixture';

for(const width of [390,430])test(`${width}px 实际阅读卡片状态：等待不假报字数，成功只统计body`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await storySeed(page);
 let held:any,calls=0;await page.route('https://story.test/**',r=>{calls++;held=r;});
 await page.getByRole('button',{name:'剧本',exact:true}).click();
 await page.getByRole('button',{name:'开始剧情',exact:true}).click();
 const status=page.getByRole('status',{name:'剧情书写状态'});
 await expect(status).toHaveText('AI 正在书写…');await expect(page.locator('.story-opening').getByRole('status')).toBeVisible();
 await page.waitForTimeout(150);await expect(status).toHaveText('AI 正在书写…');await expect.poll(()=>calls).toBe(1);await expect(page.getByText(/已写\s*\d/)).toHaveCount(0);
 await page.screenshot({path:info.outputPath(`writing-${width}.png`)});
 const body='我走到门前。\n\n林安说：“你来了。”🌿';
 await held.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({...reply(),body})}}]}});
 await expect(status).toHaveText(`本段 ${Array.from(body.replace(/\s/gu,'')).length} 字`);
 await expect(page.locator('.story-prose')).toHaveText(body);await expect(page.locator('.story-reading-card .story-writing-status')).toHaveCount(1);
 await expect(page.locator('.story-reply-failure')).toHaveCount(0);expect(calls).toBe(1);
 const rect=await status.boundingBox(),card=await page.locator('.story-reading-card').boundingBox();expect(rect!.x).toBeGreaterThan(card!.x);expect(rect!.y).toBeLessThan((await page.locator('.story-prose').boundingBox())!.y);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`complete-${width}.png`)});
 // New turn retains original body and draft on a genuine technical failure.
 await page.getByLabel('自定义行动',{exact:true}).fill('我尝试查看门后的信件。');
 await page.getByRole('button',{name:'确认选择',exact:true}).click();await expect(status).toHaveText('AI 正在书写…');await expect.poll(()=>calls).toBe(2);
 await expect(page.locator('.story-prose')).toHaveText(body);
 await held.fulfill({status:500,json:{error:{code:'server_error'}}});
 await expect(status).toHaveText(`本段 ${Array.from(body.replace(/\s/gu,'')).length} 字`);
 await expect(page.locator('.story-reply-failure')).toBeVisible();await expect(page.getByLabel('自定义行动',{exact:true})).toHaveValue('我尝试查看门后的信件。');expect(calls).toBe(2);
 await page.reload();await page.getByRole('button',{name:'剧本',exact:true}).click();await expect(page.locator('.story-reading-card .story-writing-status')).toHaveCount(1);expect(calls).toBe(2);
});


test('真实SSE分块在body完整解析前不假报实时字数；取消不保存候选',async({page})=>{
 await storySeed(page);await page.evaluate(async()=>{
  const {browserTransport}=await import('/src/api.ts');
  (window as any).sseCalls=0;browserTransport.send=async(_url,init)=>{(window as any).sseCalls++;return new Response(new ReadableStream({start(c){(window as any).sseController=c;init.signal?.addEventListener('abort',()=>{try{c.error(new DOMException('Aborted','AbortError'));}catch{}},{once:true});}}),{headers:{'content-type':'text/event-stream'}});};
 });
 await page.getByRole('button',{name:'剧本',exact:true}).click();await page.getByRole('button',{name:'开始剧情',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).sseCalls)).toBe(1);
 const body='你推开门，停在灯下。';const raw=JSON.stringify({...reply(),body});
 const chunk=(text:string)=>`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})}\n\n`;
 await page.evaluate(text=>(window as any).sseController.enqueue(new TextEncoder().encode(text)),chunk(raw.slice(0,15)));
 await expect(page.getByRole('status',{name:'剧情书写状态'})).toHaveText('AI 正在书写…');await expect(page.getByText(/已写\s*\d/)).toHaveCount(0);
 await page.evaluate(text=>{const c=(window as any).sseController;c.enqueue(new TextEncoder().encode(text));c.close();},chunk(raw.slice(15))+'data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 await expect(page.getByRole('status',{name:'剧情书写状态'})).toHaveText(`本段 ${Array.from(body).length} 字`);
 await page.getByLabel('自定义行动',{exact:true}).fill('停在原地。');await page.getByRole('button',{name:'确认选择',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).sseCalls)).toBe(2);
 await page.getByRole('button',{name:'返回手机桌面',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>{const {db}=await import('/src/store.ts');return (await db.storySessions.toArray())[0].pending===undefined;})).toBe(true);
 const state=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return {count:await db.storyNodes.count(),s:(await db.storySessions.toArray())[0]};});expect(state.count).toBe(1);expect(state.s.failureDetails.code).toBe('cancelled');
});
