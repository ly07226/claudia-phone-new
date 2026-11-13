import {test,expect} from '@playwright/test';
import {storySeed,reply} from './storyFixture';

test('所有已提交原文都有索引资格，普通事件不依赖记忆信号词',async({page})=>{
 await storySeed(page);const r=await page.evaluate(async()=>{const {indexStoryHistory}=await import('/src/storyHistory.ts');const body='陆衡交出城防印，东营改由青棠统领。';const path=[{id:'root',body:'开场。'},{id:'settled',body},{id:'later',body:'柳沉在侧厅候见。'}] as any;const index=indexStoryHistory(path);return {body,entries:index.filter(x=>x.node===2)};});
 expect(r.entries.map(e=>e.text)).toEqual([r.body]);
});

for(const turns of [50,120,400])test(`${turns}回合有效存档：请求引用可追溯，结果更新与旧行动分开，刷新不变`,async({page})=>{
 await storySeed(page);let calls=0;const inputs:any[]=[];
 await page.route('https://story.test/**',route=>{calls++;inputs.push(JSON.parse(route.request().postDataJSON().messages[1].content));return route.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply(calls))}}]}});});
 const r=await page.evaluate(async turns=>{
  const {generateStory}=await import('/src/storyGeneration.ts');const {readStory}=await import('/src/storyStore.ts');const {db}=await import('/src/store.ts');
  const root=await generateStory('story');const session=(await readStory('story')).session!;
  const facts:Record<number,string>={3:'陆衡交出城防印，东营改由青棠统领。',4:'侍卫郑砚殒命于火场，遗体下葬于西坡。',5:'青棠左臂负伤，暂退后方休养；她与柳沉由同僚转为互信的盟友。',7:'原定的举兵之议被当众否决，陆衡受命抄录军籍；北门撤岗一事已按会盟条款办妥。',9:'青棠左臂伤愈，返回东营复职，柳沉的临时代领随之终止。',11:'柳沉说，除非账册核验完毕，否则不会前往西坡；他尚未动身。',12:'账册经核验并无缺页，开封手续办妥；柳沉改约在次日与主控会面。'};
  let parent=root;const nodes=[];for(let n=2;n<turns;n++){const node={...root,segments:undefined,choices:root.choices.map(c=>({...c,id:`seed-${n}:${c.label}`})),id:`seed-${n}`,parentNodeId:parent.id,sequence:n,requestId:`seed-request-${n}`,createdAt:Date.now()-n,body:facts[n]??`第${n}回，众人在回廊核对当日收支。`,action:n===3?{kind:'custom' as const,text:'我尝试询问霁岚封存函件的下落，但不擅自拆封。'}:{kind:'choice' as const,choiceId:parent.choices[0].id},fromChoiceId:n===3?undefined:parent.choices[0].id};nodes.push(node);parent=node;}
  await db.storyNodes.bulkAdd(nodes);await db.storySessions.update(session.id,{headNodeId:parent.id,revision:turns-1,status:'ready',definition:{...session.definition,background:'最初计划：陆衡准备举兵，青棠尚未接管东营。'}});
  await (await import('/src/storyValidation.ts')).validateStoryDatabase(db);
  const action='核对陆衡交出城防印和举兵之议的结果、郑砚下葬、青棠负伤与伤愈复职及柳沉的盟友关系、账册核验后的会面，并复查霁岚封存函件的旧行动。';
  const before=await readStory('story'),t=performance.now();await generateStory('story',{kind:'custom',text:action});const durationMs=performance.now()-t;
  const after=await readStory('story');const diagnostics=(await import('/src/storyGeneration.ts')).getStoryGenerationDiagnostics();return {before,after,facts,action,durationMs,diagnostics};
 },turns);
 expect(calls).toBe(2);expect(r.after.path).toHaveLength(turns);const input=inputs.at(-1),memory=input.longTermStoryMemory;
 for(const text of Object.values(r.facts))expect(memory.excerpts.map((q:any)=>q.text)).toContain(text);
 for(const quote of memory.excerpts){const source=r.before.path[quote.node-1];expect(quote.nodeId).toBe(source.id);expect(source.body.slice(quote.start,quote.end)).toBe(quote.text);}
 const intent=memory.actions.find((a:any)=>a.text.includes('霁岚'));expect(intent).toMatchObject({node:3,kind:'custom',nodeId:'seed-3'});expect(intent.fromNodeId).toBe('seed-2');expect(memory.notice).toContain('意图');
 expect(input.selectedAction.text).toBe(r.action);expect(input.confirmedHistory.at(-1).body).toBe(r.before.path.at(-1)!.body);expect(input.definition.background).toContain('最初计划');expect(input.continuity).toBeDefined();
 expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeLessThan(64000);expect(JSON.stringify(r.diagnostics)).not.toMatch(/霁岚|城防|story-api|seed-/);
 if(turns===400){const backup=await page.evaluate(async()=>{const {readStory}=await import('/src/storyStore.ts');const {storyInput}=await import('/src/storyContext.ts');const before=await readStory('story');const expected=JSON.parse(storyInput(before.session!,before.path)).longTermStoryMemory;const {createZipBackup,readBackupZip}=await import('/src/backupZip.ts');const files=await readBackupZip(new File([await createZipBackup({closedOtherClients:true})],'continuity.zip'));const {readBackup,verifiedCandidate}=await import('/src/backupService.ts');const plan=await readBackup(files,{mode:'rehearse'});try{const d=verifiedCandidate(plan),session=await d.table('storySessions').where('worldId').equals('story').first();const nodes=await d.table('storyNodes').toArray(),map=new Map(nodes.map(n=>[n.id,n])),path=[];let id=session.headNodeId;while(id){const node=map.get(id)!;path.push(node);id=node.parentNodeId;}return {expected,actual:JSON.parse(storyInput(session,path.reverse())).longTermStoryMemory,count:path.length,report:plan.report.status};}finally{await plan.dispose();}});expect(backup.count).toBe(400);expect(backup.report).toBe('rehearsed');expect(backup.actual).toEqual(backup.expected);}
 await page.reload();const restored=await page.evaluate(async()=>{const {readStory}=await import('/src/storyStore.ts');const data=await readStory('story');return {ids:data.path.map(n=>n.id),bodies:data.path.map(n=>n.body)};});expect(restored.ids).toEqual(r.after.path.map(n=>n.id));expect(restored.bodies).toEqual(r.after.path.map(n=>n.body));
 console.log(JSON.stringify({scenario:'seeded-active-path',turns,mockCalls:calls,inputBytes:new TextEncoder().encode(JSON.stringify(input)).length,excerpts:memory.excerpts.length,actions:memory.actions.length,durationMs:Math.round(r.durationMs)}));
});

test('50次实际生成与提交：回溯去除旧事实，重生请求排除被替换正文',async({page})=>{
 await storySeed(page);let calls=0;const inputs:string[]=[];
 await page.route('https://story.test/**',route=>{calls++;inputs.push(route.request().postDataJSON().messages[1].content);return route.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({...reply(calls),body:calls===3?'陆衡交出城防印，东营改由青棠统领。':`有效剧情标记${calls}。`})}}]}});});
 const r=await page.evaluate(async()=>{const {generateStory}=await import('/src/storyGeneration.ts');const {readStory,withdrawStory}=await import('/src/storyStore.ts');let node;for(let n=0;n<50;n++)node=await generateStory('story',node?.choices[0].id);const full=await readStory('story');await generateStory('story',undefined,{operation:'regenerate'});for(let n=0;n<48;n++){const s=(await readStory('story')).session!;await withdrawStory('story',{sessionId:s.id,headNodeId:s.headNodeId,revision:s.revision});}await generateStory('story',{kind:'custom',text:'核对青棠与东营的情况。'});return {full,after:await readStory('story')};});
 expect(r.full.path).toHaveLength(50);expect(calls).toBe(52);expect(inputs[50]).not.toContain('有效剧情标记50');expect(inputs[51]).not.toContain('陆衡交出城防印');expect(r.after.path).toHaveLength(3);expect(r.after.path.at(-1)!.body).toBe('有效剧情标记52。');
});

test('B类边界：已给出正确前情，模型仍可返回语义矛盾；解析器并非事实审核器',async({page})=>{
 await storySeed(page);let calls=0;const inputs:any[]=[];
 await page.route('https://story.test/**',route=>{calls++;inputs.push(JSON.parse(route.request().postDataJSON().messages[1].content));return route.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({...reply(calls),body:calls===1?'郑砚殒命，遗体已经下葬。':'郑砚毫发无伤地走进房间，如往常一样开始值守。'})}}]}});});
 const path=await page.evaluate(async()=>{const {generateStory}=await import('/src/storyGeneration.ts');const root=await generateStory('story');await generateStory('story',root.choices[0].id);return (await(await import('/src/storyStore.ts')).readStory('story')).path;});
 expect(inputs[1].confirmedHistory[0].body).toBe(path[0].body);expect(path[1].body).toContain('毫发无伤');expect(calls).toBe(2);
});

test('当前行动检索既有结果及后续状态，不被无关高信号段落挤掉',async({page})=>{
 await storySeed(page);const r=await page.evaluate(async()=>{const h=await import('/src/storyHistory.ts');const path=Array.from({length:100},(_,i)=>({id:`history-${i+1}`,body:i===24?'陆衡不再掌管城防，兵符由青棠接管。':i===59?'青棠已经因伤离城，柳沉代领城防。':`档案${i}：承诺约定发誓秘密身份真相揭晓背叛和解分手恋人关系信任失踪线索伏笔未解。`})) as any;const q={action:'查询陆衡交出城防后的青棠、柳沉目前各在何处，确认谁掌管兵符。',recent:'众人查阅城防交接记录。',characters:['陆衡','青棠','柳沉']};return {selected:(h.selectStoryHistory as any)(h.indexStoryHistory(path),100,2400,q),expected:[path[24].body,path[59].body]};});
 for(const text of r.expected)expect(r.selected.excerpts.map((x:any)=>x.text)).toContain(text);
});

test('大段静态背景先选取，不能先耗尽既有历史；不改保存的原文',async({page})=>{
 await storySeed(page);const r=await page.evaluate(async()=>{const {claimStory}=await import('/src/storyStore.ts');const {storyInput,storyPrompt}=await import('/src/storyContext.ts');const {db}=await import('/src/store.ts');const s=(await claimStory('story',undefined,false)).session;s.definition.background='街道两侧灯火如常。'.repeat(600);const path=Array.from({length:20},(_,i)=>({id:`p-${i}`,body:i===2?'双方已经签署停战约定，北营撤出城门。':'日暮时，大家回到各自住处。',choices:[]})) as any;const snapshot=JSON.stringify({s,path});const raw=storyInput(s,path,{kind:'custom',text:'复核双方签署的停战约定与北营撤兵结果。'},'standard',undefined,22000);return {input:JSON.parse(raw),bytes:new TextEncoder().encode(storyPrompt+raw).length,unchanged:snapshot===JSON.stringify({s,path}),dbVersion:db.verno,expected:path[2].body};});
 expect(r.unchanged).toBe(true);expect(r.bytes).toBeLessThanOrEqual(22000);expect(r.input.confirmedHistory.length).toBeGreaterThanOrEqual(3);expect(r.input.longTermStoryMemory?.excerpts.map((x:any)=>x.text)).toContain(r.expected);
});

test('实际20轮短输出不会令早期结果消失，最终请求能核对源节点原文',async({page})=>{
 await storySeed(page);const inputs:any[]=[];let calls=0;const settled='陆衡交出城防印，东营改由青棠统领。';
 await page.route('https://story.test/**',route=>{calls++;inputs.push(JSON.parse(route.request().postDataJSON().messages[1].content));return route.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({...reply(calls),body:calls===3?settled:'一行人沿回廊前行。'})}}]}});});
 const r=await page.evaluate(async()=>{const {generateStory}=await import('/src/storyGeneration.ts');const {readStory}=await import('/src/storyStore.ts');let n;for(let i=0;i<19;i++)n=await generateStory('story',n?.choices[0].id);await generateStory('story',{kind:'custom',text:'查看陆衡交出城防印后的东营统领与青棠的职责。'});const data=await readStory('story');return {path:data.path,revision:data.session!.revision};});
 expect(calls).toBe(20);expect(r.revision).toBe(20);const input=inputs.at(-1);const quote=input.longTermStoryMemory?.excerpts.find((x:any)=>x.text===settled);expect(quote).toBeDefined();expect(quote.node).toBe(3);const source=r.path[quote.node-1];expect(source.body).toBe(settled);expect(input.selectedAction).toEqual({kind:'custom',text:'查看陆衡交出城防印后的东营统领与青棠的职责。'});expect(input.confirmedHistory.at(-1).body).toBe(r.path[18].body);
});

test('原文检索覆盖段落后半部分，推进时不再让开场检索压过当前行动',async({page})=>{
 await storySeed(page);const r=await page.evaluate(async()=>{const {fitDocumentInput}=await import('/src/wizardDocumentBudget.ts');const rules=[0,1,2].map(i=>({id:String(i),kind:'background',text:String.fromCharCode(97+i).repeat(500),certainty:'uninterpreted'}));const relevant={id:'relevant-tail',kind:'background',text:'z'.repeat(420)+'原文补充：青棠负责东营调度。',certainty:'uninterpreted'};rules.push(relevant);const input={definition:{script:{opening:'开场讨论祭典'}},confirmedHistory:[{body:'目前正在查阅城防交接。'}],selectedAction:{kind:'custom',text:'查阅青棠负责东营调度的原文。'},simulatorRules:{instruction:'普通故事模式',rules}};const parsed=JSON.parse(fitDocumentInput(input,'规则',1800));return {rules:parsed.simulatorRules.rules,expected:relevant,bytes:new TextEncoder().encode('规则'+JSON.stringify(parsed)).length};});
 expect(r.bytes).toBeLessThanOrEqual(1800);expect(r.rules).toContainEqual(r.expected);
});


test('近期选项独立于已发生剧情传递，重复情节约束不将旧选项当成事实',async({page})=>{
 await storySeed(page);
 const r=await page.evaluate(async()=>{
  const {storyInput,storyPrompt}=await import('/src/storyContext.ts');
  const {claimStory}=await import('/src/storyStore.ts');
  const s=(await claimStory('story',undefined,false)).session;
  const path=Array.from({length:12},(_,i)=>({id:`node-${i}`,body:i===2?'逼宫已经成功，皇帝退位。':`第${i+1}轮剧情。`,choices:['觐见皇帝','询问守卫','查看诏书','离开宫殿'].map((text,j)=>({id:`c-${i}-${j}`,label:['A','B','C','D'][j],text}))})) as any;
  const input=JSON.parse(storyInput(s,path));
  return {input,prompt:storyPrompt};
 });
 expect(r.input.recentStoryChoices).toHaveLength(3);
 expect(r.input.recentStoryBeats).toHaveLength(3);
 expect(r.input.recentStoryBeats[2].ending).toContain('第12轮剧情');
 expect(r.input.recentStoryChoices.map((n:any)=>n.node)).toEqual([10,11,12]);
 expect(r.input.recentStoryChoices[0].choices).toContain('觐见皇帝');
 expect(r.input.confirmedHistory.some((n:any)=>n.body.includes('觐见皇帝'))).toBe(false);
 expect(r.prompt).toContain('不得无故重演已确认完成的事件');
 expect(r.input.continuity.confirmedSources).toContain('事实优先级');
 expect(r.input.continuity.staticDefinition).toContain('故事起点');
 expect(r.prompt).toContain('不能当成已选择行动或已发生事实');
});
