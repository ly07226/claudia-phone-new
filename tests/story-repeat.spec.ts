import {test,expect} from '@playwright/test';
import {storySeed,reply} from './storyFixture';

test('近期正文使用完整历史引用，不把末尾450字符冒充完整前情',async({page})=>{
 await storySeed(page);const r=await page.evaluate(async()=>{const {claimStory}=await import('/src/storyStore.ts');const {storyInput}=await import('/src/storyContext.ts');const session=(await claimStory('story',undefined,false)).session;const body='以下是证人尚未核实的假设，不是已经发生的结果：'+'档案仍待核验，'.repeat(80)+'皇帝已经退位。';const path=[{id:'source',body,choices:[]}] as any;const input=JSON.parse(storyInput(session,path));return {input,body};});
 const beat=r.input.recentStoryBeats[0];expect(beat.ending).toBeUndefined();expect(beat).toMatchObject({node:1,nodeId:'source',source:'confirmedHistory',historyIndex:0});expect(r.input.confirmedHistory[beat.historyIndex].body).toBe(r.body);
});

test('重复选项参考是可舍弃的有界资料，不能让完整当前剧情和行动无法准入',async({page})=>{
 await storySeed(page);const r=await page.evaluate(async()=>{const {claimStory}=await import('/src/storyStore.ts');const {storyInput,storyPrompt}=await import('/src/storyContext.ts');const session=(await claimStory('story',undefined,false)).session;const path=Array.from({length:12},(_,i)=>({id:`p-${i}`,body:i===2?'盟约已经签署，旧争端已经解决。':'当日账目核对完毕。',choices:['A','B','C','D'].map(label=>({id:`p-${i}:${label}`,label,text:label+'商议后续安排'.repeat(60)}))})) as any;let error='';let input:any;try{input=JSON.parse(storyInput(session,path,{kind:'custom',text:'核对盟约已经签署后的安排。'},'standard',undefined,19000));}catch(e){error=(e as Error).message;}return {error,input,bytes:input?new TextEncoder().encode(storyPrompt+JSON.stringify(input)).length:0};});
 expect(r.error).toBe('');expect(r.bytes).toBeLessThanOrEqual(19000);expect(r.input.confirmedHistory.at(-1).body).toBe('当日账目核对完毕。');expect(r.input.selectedAction.text).toContain('盟约已经签署');expect(new TextEncoder().encode(JSON.stringify(r.input.recentStoryChoices)).length).toBeLessThanOrEqual(6000);
});

const originalPlan='初始计划：陆衡准备逼宫，打算在未来夺取宫城。';
const completed='陆衡逼宫已经成功，旧帝退位，宫城完成交接。';
const changed='旧帝随后离开宫城，柳沉接管东门巡防。';
const offered=['前往东门向守卫核对当日通行记录。','返回西院向管事询问粮草交接进度。','留在侧厅等待柳沉带来巡防名册。','沿着北廊前行寻找昨夜送信的侍从。'];
async function seedPath(page:any,turns:number,outcome=completed){
 await storySeed(page);await page.evaluate(async plan=>{const {db}=await import('/src/store.ts');const w=(await db.worlds.get('story'))!;await db.worlds.update('story',{background:plan,script:{...w.script!,opening:plan}});},originalPlan);
 const inputs:any[]=[];let calls=0;let nextBody='你来到宫城，听闻陆衡尚在筹划。',nextChoices=offered;
 await page.route('https://story.test/**',(route:any)=>{calls++;inputs.push(JSON.parse(route.request().postDataJSON().messages[1].content));return route.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({body:nextBody,choices:nextChoices.map((text,i)=>({id:'ABCD'[i],text}))})}}]}});});
 const before=await page.evaluate(async({turns,outcome,changed,offered})=>{const {generateStory}=await import('/src/storyGeneration.ts');const {db}=await import('/src/store.ts');const {readStory}=await import('/src/storyStore.ts');const root=await generateStory('story');const session=(await readStory('story')).session!;let parent=root;const nodes=[];for(let n=2;n<turns;n++){const id=`path-${n}`,node={...root,id,segments:undefined,requestId:`request-${n}`,parentNodeId:parent.id,sequence:n,body:n===3?outcome:n===6?changed:`第${n}轮，在侧厅核对账目。`,action:{kind:'choice' as const,choiceId:parent.choices[0].id},fromChoiceId:parent.choices[0].id,choices:offered.map((text,i)=>({id:`${id}:${'ABCD'[i]}`,label:'ABCD'[i] as 'A'|'B'|'C'|'D',text}))};nodes.push(node);parent=node;}await db.storyNodes.bulkAdd(nodes);await db.storySessions.update(session.id,{headNodeId:parent.id,revision:turns-1,status:'ready'});await(await import('/src/storyValidation.ts')).validateStoryDatabase(db);return readStory('story');},{turns,outcome,changed,offered});
 return {inputs,before,calls:()=>calls,response:(body:string,choices=offered)=>{nextBody=body;nextChoices=choices;}};
}

for(const turns of [12,50,120,401])test(`${turns}回合：正确前情已入最终请求时，模型精确重演仍会提交且只作数值诊断`,async({page})=>{
 const fixture=await seedPath(page,turns);fixture.response(completed,offered.map(t=>t.replace('。','！')));
 const r=await page.evaluate(async()=>{const {generateStory,getStoryGenerationDiagnostics}=await import('/src/storyGeneration.ts');const node=await generateStory('story',{kind:'custom',text:'复核陆衡逼宫成功、宫城交接的既定结果以及旧帝离开宫城、柳沉接管东门巡防之后的情况。'});return {node,path:(await(await import('/src/storyStore.ts')).readStory('story')).path,diagnostics:getStoryGenerationDiagnostics()};});
 expect(fixture.calls()).toBe(2);const input=fixture.inputs.at(-1),quote=input.longTermStoryMemory.excerpts.find((q:any)=>q.node===3);expect(quote.text).toBe(completed);expect(quote.nodeId).toBe('path-3');expect(fixture.before.path[2].body.slice(quote.start,quote.end)).toBe(quote.text);expect(JSON.stringify(input)).toContain(changed);expect(input.definition.background).toBe(originalPlan);expect(input.continuity.confirmedSources).toContain('事实优先级');
 expect(r.path).toHaveLength(turns);expect(r.node.body).toBe(completed);expect(r.node.choices.map((c:any)=>c.text)).toEqual(offered.map(t=>t.replace('。','！')));expect(r.diagnostics.at(-1)).toMatchObject({exactHistoricalBodyRepeat:true,exactRecentBodyRepeat:false,exactRecentChoiceMatches:0,nearRecentChoiceMatches:4});expect(JSON.stringify(r.diagnostics)).not.toMatch(/陆衡|宫城|story-api|synthetic/);
 for(const group of input.recentStoryChoices){const source=fixture.before.path[group.node-1];expect(group.nodeId).toBe(source.id);expect(group.choices).toEqual(source.choices.map((c:any)=>c.text));}for(const beat of input.recentStoryBeats){expect(input.confirmedHistory[beat.historyIndex].body).toBe(fixture.before.path[beat.node-1].body);}expect(input.historySelection.selectedHistoryBytes).toBeLessThanOrEqual(input.historySelection.allocatedHistoryBytes);
});

for(const outcome of ['completed','cancelled','failed'] as const)test(`初始计划与${outcome}、后续变化分层；回忆和有原因反转可正常提交`,async({page})=>{
 const old={completed,cancelled:'陆衡取消逼宫计划，宫城不再集结兵力，旧帝继续在位。',failed:'陆衡逼宫失败，兵力撤出宫城，旧帝仍然在位。'}[outcome];
 const fixture=await seedPath(page,50,old);const bodies=[`你回忆那次旧事：${old}此刻只是讨论旧记录，没有再次发生。`,`因边军新统领另起兵变，宫城出现一场新的冲突。${changed}`];
 for(const body of bodies){fixture.response(body);const node=await page.evaluate(async()=>await(await import('/src/storyGeneration.ts')).generateStory('story',{kind:'custom',text:'核对陆衡逼宫的取消、失败或完成结果，以及旧帝和柳沉当前变化，并讨论先前事件。'}));expect(node.body).toBe(body);const input=fixture.inputs.at(-1);expect(input.definition.background).toBe(originalPlan);expect(input.longTermStoryMemory.excerpts.some((q:any)=>q.text===old)).toBe(true);expect(JSON.stringify(input)).toContain(changed);}
 expect(fixture.calls()).toBe(3);
});

test('字面重复诊断不禁止合法选项复用，不制造请求或丢弃模型正文',async({page})=>{
 const fixture=await seedPath(page,12);const last=fixture.before.path.at(-1).body;fixture.response(last,offered);
 const r=await page.evaluate(async()=>{const g=await import('/src/storyGeneration.ts');const data=await(await import('/src/storyStore.ts')).readStory('story');const node=await g.generateStory('story',data.path.at(-1)!.choices[0].id);return {node,diagnostic:g.getStoryGenerationDiagnostics().at(-1)};});expect(fixture.calls()).toBe(2);expect(r.node.body).toBe(last);expect(r.diagnostic).toMatchObject({exactRecentBodyRepeat:true,exactRecentChoiceMatches:4,nearRecentChoiceMatches:4});
});

test('预算缩小后近期正文引用仍只指向准入的完整历史，选项参考先舍弃',async({page})=>{
 await storySeed(page);const r=await page.evaluate(async()=>{const {storyInput,storyPrompt}=await import('/src/storyContext.ts');const s=(await(await import('/src/storyStore.ts')).claimStory('story',undefined,false)).session;const path=Array.from({length:12},(_,i)=>({id:String(i),body:'除非核实全部条件，否则这里仍只是计划，尚未执行。'.repeat(50),choices:[]})) as any;const input=JSON.parse(storyInput(s,path,undefined,'standard',undefined,21000));return {input,bytes:new TextEncoder().encode(storyPrompt+JSON.stringify(input)).length};});expect(r.bytes).toBeLessThanOrEqual(21000);expect(r.input.confirmedHistory.length).toBeLessThan(8);for(const beat of r.input.recentStoryBeats){expect(beat.node).toBe(r.input.historyOmitted+beat.historyIndex+1);expect(r.input.confirmedHistory[beat.historyIndex].body).toMatch(/^除非核实全部条件/);}
});

test('A类边界：超出摘录容量的完整单元可能漏召回，存档不截断、不伪称模型已收到',async({page})=>{
 const outcome='现场记录，'.repeat(900)+completed;const fixture=await seedPath(page,50,outcome);fixture.response('新一轮模型输出。');await page.evaluate(async()=>await(await import('/src/storyGeneration.ts')).generateStory('story',{kind:'custom',text:'核对陆衡与宫城的历史交接记录。'}));const input=fixture.inputs.at(-1);expect(fixture.before.path[2].body).toBe(outcome);expect(input.longTermStoryMemory.excerpts.some((q:any)=>q.nodeId==='path-3')).toBe(false);expect(input.longTermStoryMemory.omittedCandidates).toBeGreaterThan(0);expect(input.confirmedHistory.every((n:any)=>n.body!==outcome)).toBe(true);expect(input.definition.background).toBe(originalPlan);expect(fixture.calls()).toBe(2);
});

test('失败重生、成功重生、回溯与ZIP恢复：最近选项引用不带旧叶节点或另一世界',async({page})=>{
 const fixture=await seedPath(page,12);const oldBody='旧分支只出现于此：ORIGINAL_LEAF',oldChoices=offered.map((t,i)=>t+`旧叶${i}`);fixture.response(oldBody,oldChoices);
 await page.evaluate(async()=>{const {generateStory}=await import('/src/storyGeneration.ts');const data=await(await import('/src/storyStore.ts')).readStory('story');await generateStory('story',data.path.at(-1)!.choices[0].id);});
 let failures=0;const failedInputs:any[]=[];await page.route('https://story.test/**',async r=>{failures++;failedInputs.push(JSON.parse(r.request().postDataJSON().messages[1].content));await r.abort('connectionfailed');},{times:1});
 const failed=await page.evaluate(async()=>{try{await(await import('/src/storyGeneration.ts')).generateStory('story',undefined,{operation:'regenerate'});}catch{}return(await import('/src/storyStore.ts')).readStory('story');});expect(failures).toBe(1);expect(failed.path).toHaveLength(12);expect(failed.path.at(-1)!.body).toBe(oldBody);expect(JSON.stringify(failedInputs[0])).not.toContain('ORIGINAL_LEAF');expect(JSON.stringify(failedInputs[0])).not.toContain('旧叶');
 fixture.response('重生后有效新分支。');await page.evaluate(async()=>await(await import('/src/storyGeneration.ts')).generateStory('story',undefined,{operation:'regenerate'}));expect(JSON.stringify(fixture.inputs.at(-1))).not.toContain('ORIGINAL_LEAF');
 const restored=await page.evaluate(async()=>{const {readStory,withdrawStory}=await import('/src/storyStore.ts');const before=await readStory('story');await withdrawStory('story',{sessionId:before.session!.id,headNodeId:before.session!.headNodeId,revision:before.session!.revision});const data=await readStory('story'),{storyInput}=await import('/src/storyContext.ts');const expected=JSON.parse(storyInput(data.session!,data.path));const {createZipBackup,readBackupZip}=await import('/src/backupZip.ts');const files=await readBackupZip(new File([await createZipBackup({closedOtherClients:true})],'branch.zip'));const {readBackup,verifiedCandidate}=await import('/src/backupService.ts');const plan=await readBackup(files,{mode:'rehearse'});try{const db=verifiedCandidate(plan),s=await db.table('storySessions').where('worldId').equals('story').first(),nodes=await db.table('storyNodes').toArray(),map=new Map(nodes.map(n=>[n.id,n])),path=[];let id=s.headNodeId;while(id){const n=map.get(id)!;path.push(n);id=n.parentNodeId;}return {expected,actual:JSON.parse(storyInput(s,path.reverse())),count:data.path.length,version:db.verno};}finally{await plan.dispose();}});expect(restored.actual).toEqual(restored.expected);expect(restored.version).toBe(7);expect(restored.count).toBe(11);expect(JSON.stringify(restored.actual)).not.toMatch(/ORIGINAL_LEAF|旧叶|重生后有效新分支/);
 await page.reload();fixture.response('继续有效前缀。');await page.evaluate(async()=>{const {generateStory}=await import('/src/storyGeneration.ts');const data=await(await import('/src/storyStore.ts')).readStory('story');await generateStory('story',data.path.at(-1)!.choices[0].id);});expect(JSON.stringify(fixture.inputs.at(-1))).not.toContain('ORIGINAL_LEAF');
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const w=(await db.worlds.get('story'))!;await db.worlds.add({...w,id:'other-story',name:'另一剧本'});await(await import('/src/storyGeneration.ts')).generateStory('other-story');});const other=fixture.inputs.at(-1);expect(other.confirmedHistory).toEqual([]);expect(other.recentStoryChoices).toEqual([]);expect(other.recentStoryBeats).toEqual([]);expect(other.longTermStoryMemory).toBeUndefined();expect(fixture.calls()).toBe(5);expect(failures).toBe(1);
});


test('场景证据在正常与紧缩预算下仅引用已准入正文，不复制或误判事实',async({page})=>{
 await storySeed(page);
 const r=await page.evaluate(async()=>{
  const {storyInput,storyPrompt}=await import('/src/storyContext.ts');
  const {claimStory}=await import('/src/storyStore.ts');
  const s=(await claimStory('story',undefined,false)).session;
  const path=Array.from({length:12},(_,i)=>({id:`scene-${i}`,body:(i===10?'有人声称皇帝已经退位，但此事尚未证实。':'除非核实条件，否则计划尚未执行。').repeat(60),choices:[]})) as any;
  return [undefined,21000].map(limit=>{
   const input=JSON.parse(storyInput(s,path,undefined,'standard',undefined,limit));
   return {input,bytes:new TextEncoder().encode(storyPrompt+JSON.stringify(input)).length,limit};
  });
 });
 for(const {input,bytes,limit} of r){
  if(limit)expect(bytes).toBeLessThanOrEqual(limit);
  expect(input.currentSceneEvidence.length).toBeGreaterThan(0);
  expect(input.currentSceneEvidence.length).toBeLessThanOrEqual(2);
  for(const evidence of input.currentSceneEvidence){
   expect(evidence).toMatchObject({source:'confirmedHistory'});
   expect(evidence.node).toBe(input.historyOmitted+evidence.historyIndex+1);
   expect(input.confirmedHistory[evidence.historyIndex]).toBeDefined();
   expect(evidence.nodeId).toBe(input.confirmedHistory[evidence.historyIndex].body===undefined?undefined:`scene-${evidence.node-1}`);
   expect(evidence).not.toHaveProperty('body');
   expect(evidence).not.toHaveProperty('instruction');
  }
  expect(input.confirmedHistory.at(-1).body).toContain('尚未执行');
 }
});


test('30回合文档时间线压力测试：已确认死亡、失踪传闻与后续归来不混为一谈',async({page})=>{
 await storySeed(page);
 const r=await page.evaluate(async()=>{
  const {claimStory}=await import('/src/storyStore.ts');
  const {storyInput,storyPrompt}=await import('/src/storyContext.ts');
  const s=(await claimStory('story',undefined,false)).session;
  const events:Record<number,string>={
   1:'宫变当夜，储君被刺身亡，北境统帅只是坠崖失踪，生死尚未查明。',
   4:'禁军控制宫门，朝臣仍在争论继位程序。',
   7:'皇帝正式交出玉玺，宫变告一段落。',
   11:'新帝下诏整顿禁军，旧日宫变没有再次发生。',
   16:'边境有人传言统帅仍活着，但京城尚无确证。',
   21:'封后大典已经举行，仪典完成。',
   26:'边境统帅终于返回京城，此时才得知京中发生的变故。'
  };
  const path=Array.from({length:30},(_,i)=>({id:`turn-${i+1}`,body:events[i+1]??`第${i+1}回合，朝中议事推进，人物依据已经发生的局势作出反应。`,choices:[]})) as any;
  const input=JSON.parse(storyInput(s,path,{kind:'custom',text:'复核宫变结果、北境统帅的真实处境和封后大典后的归京时间。'}));
  const budget=21000;
  const tight=JSON.parse(storyInput(s,path,{kind:'custom',text:'核对已完成的宫变、封后仪典与归京。'},'standard',undefined,budget));
  const inspect=(v:any)=>({references:v.currentSceneEvidence.map((e:any)=>({node:e.node,body:v.confirmedHistory[e.historyIndex]?.body,nodeId:e.nodeId})),history:v.confirmedHistory.length,omitted:v.historyOmitted,quotes:v.longTermStoryMemory?.excerpts??[]});
  return {normal:inspect(input),tight:inspect(tight),tightBytes:new TextEncoder().encode(storyPrompt+JSON.stringify(tight)).length,budget,events};
 });
 expect(r.tightBytes).toBeLessThanOrEqual(r.budget);
 for(const mode of [r.normal,r.tight]){
  expect(mode.references.length).toBeGreaterThan(0);
  expect(mode.references.at(-1).node).toBe(30);
  for(const item of mode.references){expect(item.nodeId).toBe(`turn-${item.node}`);expect(item.body).toBeTruthy();}
 }
 expect(r.normal.quotes.every((q:any)=>q.node<r.normal.omitted+1)).toBe(true);
});
