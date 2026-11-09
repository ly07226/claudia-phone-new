import {test,expect} from '@playwright/test';
import {storySeed,reply} from './storyFixture';
import {isolatedApp} from './backupBrowser';
const parts=[
 {type:'narration',text:'深夜十一点，门铃响了。你打开门，看见夏以昼站在走廊里，手中拎着一只黑色工具箱。\n'},
 {type:'action',text:'他看起来一点也不意外。\n'},
 {type:'dialogue',speaker:'夏以昼',text:'“这么晚还不睡？连名带姓在平台上下单找家政，叶小姐，你什么时候背着哥哥学会这种花钱的新方式了？”\n'},
 {type:'action',text:'他微微挑眉，语气里带着熟悉的调侃。\n'},
 {type:'narration',text:'你还没来得及解释，他已经自然地走进玄关，把工具箱放在鞋柜旁。\n'},
 {type:'action',text:'咔哒一声，门锁在身后落下。\n'},
 {type:'dialogue',speaker:'夏以昼',text:'“既然订单已经生成了，那哥哥可就要按规矩办事了。”\n'},
 {type:'action',text:'他的目光落在你身上，似乎在等你的回答。'}
];
const body=parts.map(p=>p.text).join('');
const choices=['质问他为什么出现在这里','询问他接单的原因','直接让他离开','先请他坐下'].map((text,i)=>({id:'ABCD'[i],text}));
for(const [width,provider] of [[390,'openai-compatible'],[430,'gemini']] as const)test(`实际生成保存三种片段与参考截图 ${provider} ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await storySeed(page,provider);let calls=0;let request:any;
 await page.route('https://story.test/**',r=>{calls++;request=r.request().postDataJSON();const text=JSON.stringify({body,choices,segments:parts});return r.fulfill({json:provider==='gemini'?{candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]}:{choices:[{message:{content:text},finish_reason:'stop'}]}});});
 const saved=await page.evaluate(async()=>{const n=await(await import('/src/storyGeneration.ts')).generateStory('story');const {db}=await import('/src/store.ts');db.close();await db.open();return db.storyNodes.get(n.id);});
 expect(saved!.segments).toEqual(parts);expect(saved!.body).toBe(body);expect(JSON.stringify(request)).toContain('segments');
 await page.getByRole('button',{name:'剧本',exact:true}).click();await expect(page.locator('.story-speaker')).toHaveText(['夏以昼','夏以昼']);await expect(page.locator('.story-action-description')).toHaveCount(4);
 expect(await page.locator('.story-prose').evaluate(el=>Array.from(el.childNodes).map(n=>{const copy=n.cloneNode(true) as HTMLElement;copy.querySelectorAll?.('.story-speaker').forEach(e=>e.remove());return copy.textContent;}).join(''))).toBe(body);
 expect(await page.locator('.story-action-description').first().evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.color];})).toEqual(['17px','rgb(64, 82, 73)']);
 expect(await page.locator('.story-paragraph').first().evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.lineHeight,s.textIndent];})).toEqual(['17px','28.05px','0px']);
 expect(await page.locator('.story-dialogue').first().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(234, 242, 233)');
 const reader=page.getByLabel('连续剧情',{exact:true});await reader.evaluate(el=>el.scrollTop=0);await page.screenshot({path:info.outputPath(`structured-reader-${width}.png`)});
 await reader.evaluate(el=>el.scrollTop=el.scrollHeight);await page.screenshot({path:info.outputPath(`structured-options-${width}.png`)});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(calls).toBe(1);
});

test('交替说话人根据当前资料或正文识别；格式差异保存原文切片',async({page})=>{
 await storySeed(page);const result=await page.evaluate(async()=>{const {parseStoryReply}=await import('/src/storyResponse.ts');return parseStoryReply(JSON.stringify({body:'林安说：“早。”\n周宁说：“晚上见。”',choices:['A','B','C','D'].map(id=>({id,text:id})),segments:[{type:'narration',text:'林安说：'},{type:'dialogue',speaker:'林安',text:'“早。”'},{type:'narration',text:'周宁说：'},{type:'dialogue',speaker:'周宁',text:'“晚上见。”'}]}));});
 expect(result.segments!.filter(s=>s.type==='dialogue').map(s=>(s as any).speaker)).toEqual(['林安','周宁']);expect(result.segments!.map(s=>s.text).join('')).toBe(result.body);
});
for(const fault of ['missing-speaker','unknown-speaker','mismatch','duplicate','omission','invalid-type','old'] as const)test(`片段安全回退 ${fault}`,async({page})=>{
 await storySeed(page);const result=await page.evaluate(async({fault,parts,body,choices})=>{const {parseStoryReply}=await import('/src/storyResponse.ts');const s:any=structuredClone(parts);if(fault==='missing-speaker')delete s[2].speaker;if(fault==='unknown-speaker')s[2].speaker='不存在的身份';if(fault==='mismatch')s[0].text+='更改原文';if(fault==='duplicate')s.push(s[0]);if(fault==='omission')s.pop();if(fault==='invalid-type')s[0].type='unknown';return parseStoryReply(JSON.stringify({body,choices,...(fault==='old'?{}:{segments:s})}));},{fault,parts,body,choices});expect(result.body).toBe(body);expect(result.choices).toHaveLength(4);expect(result.segments).toBeUndefined();
});
for(const mode of ['overwrite','merge'] as const)test(`结构化片段 ZIP ${mode} 及 ID 冲突映射`,async({page,browser})=>{
 await storySeed(page);await page.route('https://story.test/**',r=>r.fulfill({json:{choices:[{message:{content:JSON.stringify({body,choices,segments:parts})}}]}}));
 const bytes=await page.evaluate(async()=>{const {generateStory}=await import('/src/storyGeneration.ts');const first=await generateStory('story');await generateStory('story',first.choices[0].id);const file=await(await import('/src/backupZip.ts')).createZipBackup({closedOtherClients:true});return Array.from(new Uint8Array(await file.arrayBuffer()));});
 const context=await browser.newContext(),target=await context.newPage();try{await isolatedApp(target,'segments-restore-'+crypto.randomUUID());const restored=await target.evaluate(async({bytes,mode})=>{const {db}=await import('/src/store.ts');if(mode==='merge')await db.worlds.put({id:'story',name:'保留的不同世界',description:'',createdAt:1});const files=await(await import('/src/backupZip.ts')).readBackupZip(new File([new Uint8Array(bytes)],'segments.zip'));const {prepareImport,defaultImportOptions}=await import('/src/importPlan.ts');const plan=await prepareImport(files,{...defaultImportOptions,mode});try{await(await import('/src/restoreService.ts')).restoreToCurrent([],{confirmed:true,plan,database:db});}finally{await plan.dispose();}db.close();await db.open();await(await import('/src/storyValidation.ts')).validateStoryDatabase(db);return {nodes:await db.storyNodes.toArray(),version:db.verno,worlds:await db.worlds.toArray()};},{bytes,mode});expect(restored.version).toBe(7);expect(restored.nodes).toHaveLength(2);for(const n of restored.nodes){expect(n.body).toBe(body);expect(n.segments).toEqual(parts);}if(mode==='merge')expect(restored.nodes[0].worldId).not.toBe('story');}finally{await context.close();}
});

test('世界人物快照允许正文未重复姓名的真实说话人；未知身份不接受',async({page})=>{
 await storySeed(page);const result=await page.evaluate(async()=>{const {parseStoryReply}=await import('/src/storyResponse.ts');const raw=JSON.stringify({body:'“我在这里。”',choices:['A','B','C','D'].map(id=>({id,text:id})),segments:[{type:'dialogue',speaker:'周宁',text:'“我在这里。”'}]});return {allowed:parseStoryReply(raw,['周宁']),rejected:parseStoryReply(raw,['林安'])};});expect(result.allowed.segments?.[0]).toMatchObject({speaker:'周宁'});expect(result.rejected.segments).toBeUndefined();
});
test('损坏的持久化片段被备份数据校验拒绝，旧节点不受影响',async({page})=>{
 await storySeed(page);await page.route('https://story.test/**',r=>r.fulfill({json:{choices:[{message:{content:JSON.stringify(reply())}}]}}));const result=await page.evaluate(async()=>{const node=await(await import('/src/storyGeneration.ts')).generateStory('story');const {validateStoryNode}=await import('/src/storyValidation.ts');validateStoryNode(node);let rejected=false;try{validateStoryNode({...node,segments:[{type:'action',text:'篡改原文'}]});}catch{rejected=true;}return rejected;});expect(result).toBe(true);
});
