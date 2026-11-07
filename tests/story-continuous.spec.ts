import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
import {storySeed,reply} from './storyFixture';
const samples=[
 {name:'多段叙述',text:'窗外下着细雨。\r\n\r\n他把信放回桌上。\n第二次敲门声响起。',dialogues:0},
 {name:'单段夹杂完整直接引语',text:'风吹开窗帘。他说：“别急，我们先看看这封信。”随后把纸页推到桌边。',dialogues:1},
 {name:'多次对话',text:'他问：“你找到信了吗？”她说：“还没有，我们再看看。”门外又落起雨。',dialogues:2},
 {name:'独立无署名台词',text:'“你好。”\n\n“我们一起找。”',dialogues:2},
 {name:'嵌套引号',text:'她说：“他说‘等等’，但没人停下。”',dialogues:0},
 {name:'不完整及混合引号',text:'他说：“别走。\n她说：「还没有结束。”',dialogues:0},
 {name:'心理与引用说明',text:'他心想：“我应该先等一等。”书中写道：“我思故我在。”\n“也许是我错了。”她问自己。',dialogues:0},
 {name:'长叙述无换行',text:'檐角的水滴沿着石阶流下，树影在窗前轻轻晃动。'.repeat(35),dialogues:0},
];
for(const sample of samples)test(`保守排版保留全部原文：${sample.name}`,async({page})=>{
 await isolatedApp(page,'story-format-'+crypto.randomUUID());const parts=await page.evaluate(async text=>(await import('/src/storyProse.ts')).formatStoryProse(text),sample.text);
 expect(parts.map(p=>p.text).join('')).toBe(sample.text);expect(parts.filter(p=>p.kind==='dialogue')).toHaveLength(sample.dialogues);if(sample.name==='长叙述无换行')expect(parts.filter(p=>p.kind==='narrative').length).toBeGreaterThan(2);
});
for(const width of [390,430])test(`一张连续剧情卡片、旧文对话与紧凑抽屉 ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await storySeed(page);const body='雨停在傍晚，屋檐仍在滴水。旧车站的候车室已经空了，只有一盏灯照着桌上的信封。她没有立即拆信，而是沿着封口摸了一遍，发现蜡印边缘留着一道细小的划痕。那不是路上磕碰留下的痕迹，纸张也没有被雨打湿，送信的人显然一直小心地护着它。门外的脚步声停了片刻，又缓缓退到走廊另一端。他把伞靠在门边，目光落在那道划痕上。'+'他说：“别急，我们先核对这封信。”'+'她把信封转向灯光。地址写得很工整，收信人的姓却被描过一笔，像是写信的人在最后一刻改变了主意。桌角压着车站留下的登记册，其中一页折起了窄窄的边。她没有翻动，只把信放在折痕旁边，比较两处墨迹的颜色。屋外响起一声短促的铃声，那是站务室关门前的提醒。走廊里的人仍然没有进来，湿鞋底偶尔擦过地面，声音轻得几乎听不见。他往门口看了一眼，没有替她作出下一步决定。她把手从登记册上移开。'+'她问：“我们要不要先问问门外的人？”'+'他没有马上回答。灯罩里的飞虫撞了一下玻璃，光影随之晃动，信封上的姓氏仿佛又变回了最初的写法。走廊尽头传来收拾钥匙的声音，随后是一声克制的咳嗽。那人似乎在等候允许，也可能只是舍不得离开这座快要关闭的车站。她抬起头，确认门仍开着，登记册和信都留在伸手可及的地方。现在还有时间核对登记、询问来者，或者先检查那道被人动过的封口。没有任何一种选择已经发生，屋里的安静仍然容得下一次谨慎的决定。';
 let calls=0;const requests:any[]=[];await page.route('https://story.test/**',r=>{calls++;requests.push(r.request().postDataJSON());return r.fulfill({json:{choices:[{message:{content:JSON.stringify({...reply(),body})}}]}});});
 const before=await page.evaluate(async()=>{const {generateStory}=await import('/src/storyGeneration.ts');let n=await generateStory('story');n=await generateStory('story',n.choices[0].id);await generateStory('story',n.choices[1].id);const {db}=await import('/src/store.ts');return JSON.stringify(await db.storyNodes.toArray());});
 await page.getByRole('button',{name:'剧本',exact:true}).click();await expect(page.locator('.story-reading-card')).toHaveCount(1);await expect(page.locator('[data-story-sequence]')).toHaveCount(3);await expect(page.getByRole('button',{name:/查看更早剧情|下一幕/})).toHaveCount(0);await expect(page.locator('.story-dialogue')).toHaveCount(6);
 const texts=await page.locator('.story-prose').evaluateAll(els=>els.map(el=>el.textContent));expect(texts).toEqual([body,body,body]);expect(await page.locator('.story-dialogue').first().getAttribute('aria-label')).toBe('无署名引语');
 const reader=page.getByLabel('连续剧情',{exact:true});await reader.evaluate(el=>el.scrollTop=0);const card=page.locator('.story-reading-card');const rect=await card.boundingBox();expect(rect!.width).toBeGreaterThan(width-35);expect(rect!.x+rect!.width).toBeLessThanOrEqual(width);expect(await card.evaluate(el=>getComputedStyle(el).overflowY)).toBe('visible');await page.screenshot({path:info.outputPath(`continuous-expanded-${width}.png`)});
 await page.getByRole('button',{name:'收起操作',exact:true}).click();await expect.poll(()=>page.locator('.story-drawer').evaluate(el=>el.getBoundingClientRect().height)).toBe(45);await expect(page.locator('.story-drawer-panel')).toBeHidden();expect(await page.locator('.story-drawer').innerText()).toBe('');await page.screenshot({path:info.outputPath(`continuous-collapsed-${width}.png`)});
 const positions=await page.locator('.story-app').evaluate(el=>{const reader=el.querySelector('.story-reader')!.getBoundingClientRect(),drawer=el.querySelector('.story-drawer')!.getBoundingClientRect(),root=el.getBoundingClientRect();return {gap:drawer.top-reader.bottom,end:root.bottom-drawer.bottom};});expect(Math.abs(positions.gap)).toBeLessThan(1);expect(Math.abs(positions.end)).toBeLessThan(1);
 await page.locator('.story-drawer').evaluate(el=>(el as HTMLElement).style.setProperty('--story-drawer-safe-bottom','24px'));await expect.poll(()=>page.locator('.story-drawer').evaluate(el=>el.getBoundingClientRect().height)).toBe(69);await page.locator('.story-drawer').evaluate(el=>(el as HTMLElement).style.removeProperty('--story-drawer-safe-bottom'));
 await page.setViewportSize({width,height:440});await expect.poll(()=>page.locator('.story-drawer').evaluate(el=>el.getBoundingClientRect().height)).toBe(45);await page.getByRole('button',{name:'展开操作',exact:true}).click();await expect(page.getByRole('radio')).toHaveCount(4);await expect(page.getByRole('button',{name:'确认选择',exact:true})).toBeInViewport();await expect(page.getByRole('button',{name:'剧情指导',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const after=await page.evaluate(async()=>JSON.stringify(await(await import('/src/store.ts')).db.storyNodes.toArray()));expect(after).toBe(before);expect(calls).toBe(3);expect(requests[0].messages[0].content).toContain('人物直接引语尽量独立成段');expect(requests[0].messages[0].content).toContain('不改变已有规则、人称或篇幅目标');
});
