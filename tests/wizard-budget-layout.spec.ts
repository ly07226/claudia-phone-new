import {test,expect} from '@playwright/test';
import {seedWizardAI,wizardResponse,openingNode} from './wizardAIFixture';

test('长设定按预算选择参考片段，身份规则开局完整，原文及快照不变',async({page})=>{
 await seedWizardAI(page);const requests:any[]=[];await page.route('https://wizard.test/**',r=>{requests.push(r.request().postDataJSON());return r.fulfill({json:wizardResponse('openai-compatible',openingNode)});});
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts'),{newWizardDraft}=await import('/src/scriptWizardDraft.ts'),{createWizardWorld}=await import('/src/scriptWizardCreation.ts');
  const d=newWizardDraft();Object.assign(d,{title:'长设定',synopsis:'城市的街道延伸至远方，薄雾在河岸散开。\n'.repeat(500),background:'书架沿着墙壁排列，窗外的树影缓缓移动。\n'.repeat(300),rules:'禁止替主控作出选择。身份不可改变。',opening:'清晨在车站寻找旧信。'.repeat(100),identity:{...d.identity,name:'顾安',occupation:'医生'},characterIds:['base']});
  const world=await createWizardWorld(d);const before=JSON.stringify(world);
  const {generateWizardOpening}=await import('/src/wizardOpening');await generateWizardOpening(world.id,'confirmation');
  const s=(await db.storySessions.where('worldId').equals(world.id).first())!;
  return {same:before===JSON.stringify(await db.worlds.get(world.id)),description:world.description,background:world.background,snapshotSame:s.definition.description===world.description&&s.definition.background===world.background,rules:world.rules,opening:world.script!.opening};
 });
 expect(requests).toHaveLength(1);const messages=requests[0].messages;const input=JSON.parse(messages[1].content);
 expect(new TextEncoder().encode(messages.map((x:any)=>x.content).join('')).length).toBeLessThanOrEqual(48000);
 expect(input.referenceSelection.originalCharacters).toBeGreaterThan(input.referenceSelection.includedCharacters);
 expect(input.referenceSelection.notice).toContain('不是完整设定');expect(input.definition.participants.protagonist.name).toBe('顾安');expect(input.definition.rules).toBe(result.rules);expect(input.definition.script.opening).toBe(result.opening);expect(result.same&&result.snapshotSame).toBe(true);
 const full=structuredClone(input);delete full.referenceSelection;full.definition.description=result.description;full.definition.background=result.background;expect(new TextEncoder().encode(messages[0].content+JSON.stringify(full)).length).toBeGreaterThan(48000);
});

test('必要资料超预算请求前停止，当前节点和关键条件不被静默裁剪',async({page})=>{
 await seedWizardAI(page);let calls=0;await page.route('https://wizard.test/**',r=>{calls++;return r.abort();});
 const r=await page.evaluate(async()=>{
  const {storyInput,storyPrompt}=await import('/src/storyContext.ts');const {db}=await import('/src/store.ts');const {createWizardWorld}=await import('/src/scriptWizardCreation.ts');const {newWizardDraft}=await import('/src/scriptWizardDraft.ts');
  const d=newWizardDraft();Object.assign(d,{title:'预算保护',synopsis:'背景。',opening:'开场',rules:'禁止'.repeat(2000),identity:{...d.identity,name:'主控',bio:'资料'.repeat(2000),appearance:'外貌'.repeat(2000),experience:'经历'.repeat(2000)},characterIds:['base']});const w=await createWizardWorld(d);let error='';try{await(await import('/src/wizardOpening.ts')).generateWizardOpening(w.id,'confirmation');}catch(e){error=(e as Error).message;}
  const state=await db.storySessions.where('worldId').equals(w.id).count();
  const definition={name:'世界',description:'主控身份为医生，只有出示证件才可进入。\n'+'远方的树林笼罩着晨雾。\n'.repeat(1400),background:'城市历史。',rules:'不得改变身份。',script:{version:1,playMode:'story',opening:'开场',definitionRevision:1}};
  const node={id:'head',body:'当前剧情完整保留。'.repeat(500),choices:[{id:'head:A',label:'A',text:'留在现场'}]};
  const input=storyInput({definition} as any,[node] as any,{kind:'choice',choiceId:'head:A'});const parsed=JSON.parse(input);
  return {error,state,kept:parsed.definition.description.includes('只有出示证件'),current:parsed.confirmedHistory.at(-1).body===node.body,bytes:new TextEncoder().encode(storyPrompt+input).length};
 });
 expect(r.error).toContain('全部原文保留');expect(r.error).not.toContain('缩短');expect(r.state).toBe(0);expect(calls).toBe(0);expect(r.kept&&r.current).toBe(true);expect(r.bytes).toBeLessThanOrEqual(48000);
});

for(const width of [375,390,430])test(`第四步滚动不遮挡、第五步主次按钮竖排 ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await seedWizardAI(page);await page.route('https://wizard.test/**',r=>r.fulfill({json:wizardResponse('openai-compatible',openingNode)}));
 await page.getByLabel('开场场景',{exact:true}).fill('很长的开场设定。\n'.repeat(120));
 for(const height of [844,440]){
  await page.setViewportSize({width,height});const area=page.locator('.wizard-content');await area.evaluate(el=>el.scrollTop=el.scrollHeight);
  const last=page.locator('.wizard-summary dd').last();await last.scrollIntoViewIfNeeded();
  const b=await last.boundingBox(),footer=await page.locator('.wizard-footer').boundingBox(),content=await area.boundingBox();
  expect(b&&footer&&content).toBeTruthy();expect(b!.y+b!.height).toBeLessThanOrEqual(footer!.y+1);expect(content!.height).toBeGreaterThan(50);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'确认开局',exact:true}).click();await expect(page.getByRole('button',{name:'进入故事',exact:true})).toBeVisible();
 const buttons=await page.locator('.wizard-setup .wizard-footer button').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return {top:b.top,bottom:b.bottom,width:b.width};}));
 expect(buttons).toHaveLength(3);for(let i=1;i<buttons.length;i++)expect(buttons[i].top).toBeGreaterThanOrEqual(buttons[i-1].bottom);
 expect(buttons[0].width).toBeGreaterThan(250);await expect(page.getByRole('button',{name:'进入故事',exact:true})).toBeInViewport();await page.screenshot({path:info.outputPath(`wizard-buttons-${width}.png`)});
});
