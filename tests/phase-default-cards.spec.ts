import {expect,test,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

async function launch(page:Page){
 await isolatedApp(page,'phase-default-'+crypto.randomUUID());
 await page.getByRole('button',{name:'桌面第2页',exact:true}).click();
 await page.getByRole('button',{name:'忍一下嘛',exact:true}).click();
 await page.getByRole('button',{name:'指令',exact:true}).click();
}
function card(page:Page,mode:'sweet'|'dirty'){
 return page.locator('.phase-play-default-card').filter({has:page.getByRole('button',{name:mode==='sweet'?'Sweet Talk':'Dirty Talk',exact:true})});
}
async function saved(page:Page){return page.evaluate(async()=>{
 const {db}=await import('/src/store.ts');const {storageKey}=await import('/src/phasePlay/storage.ts');
 return JSON.parse(localStorage.getItem(storageKey(db.name))!);
});}
async function manage(page:Page,mode:'sweet'|'dirty'){const c=card(page,mode);await c.locator('summary').click();return c;}

for(const mode of ['sweet','dirty'] as const)test(`${mode} 默认卡片新增、编辑及灯色、删除、刷新、恢复出厂只作用本模式`,async({page})=>{
 await launch(page);const c=await manage(page,mode);
 const factory=await c.locator('.phase-play-default-item p').allTextContents();
 const other=card(page,mode==='sweet'?'dirty':'sweet');
 const otherBefore=await other.locator('.phase-play-default-item p').allTextContents();
 await c.getByRole('button',{name:'＋ 新增指令',exact:true}).click();
 const editor=c.locator('.phase-play-default-editor');
 await editor.getByLabel('所属灯色').selectOption('red');
 await editor.getByLabel('指令内容').fill('用户新增：等待一次节拍。  ');
 await editor.getByRole('button',{name:'保存指令',exact:true}).click();
 await expect(c.locator('.phase-play-default-item')).toHaveCount(factory.length+1);
 expect((await saved(page)).settings.defaultTalkOverrides[mode].at(-1)).toMatchObject({phase:'red',text:'用户新增：等待一次节拍。  '});
 const added=c.locator('.phase-play-default-item').last();
 await added.getByRole('button',{name:'编辑',exact:true}).click();
 await editor.getByLabel('所属灯色').selectOption('yellow');
 await editor.getByLabel('指令内容').fill('用户编辑后的内容\n保留原始顺序。');
 await editor.getByRole('button',{name:'保存指令',exact:true}).click();
 const data=await saved(page);expect(data.settings.defaultTalkOverrides[mode].at(-1)).toMatchObject({phase:'yellow',text:'用户编辑后的内容\n保留原始顺序。'});
 expect(await other.locator('.phase-play-default-item p').allTextContents()).toEqual(otherBefore);
 await page.reload();await page.getByRole('button',{name:'桌面第2页',exact:true}).click();await page.getByRole('button',{name:'忍一下嘛',exact:true}).click();await page.getByRole('button',{name:'指令',exact:true}).click();
 await manage(page,mode);await expect(c.locator('.phase-play-default-item').last()).toContainText('用户编辑后的内容');
 page.once('dialog',d=>d.accept());await c.locator('.phase-play-default-item').last().getByRole('button',{name:'删除',exact:true}).click();await expect(c.locator('.phase-play-default-item')).toHaveCount(factory.length);
 page.once('dialog',d=>d.accept());await c.getByRole('button',{name:'恢复出厂',exact:true}).click();
 expect((await saved(page)).settings.defaultTalkOverrides[mode]).toBeUndefined();
 expect(await c.locator('.phase-play-default-item p').allTextContents()).toEqual(factory);
 expect(await other.locator('.phase-play-default-item p').allTextContents()).toEqual(otherBefore);
});

test('只调整原装卡片灯色不 trim 原文，Dirty 原文重复项不阻止保存',async({page})=>{
 await launch(page);
 for(const mode of ['sweet','dirty'] as const){
  const c=await manage(page,mode);const first=c.locator('.phase-play-default-item').first();const original=await first.locator('p').textContent();
  await first.getByRole('button',{name:'编辑',exact:true}).click();await c.getByLabel('所属灯色').selectOption('red');await c.getByRole('button',{name:'保存指令',exact:true}).click();
  const rows=(await saved(page)).settings.defaultTalkOverrides[mode];expect(rows.at(-1)).toMatchObject({text:original,phase:'red'});
  const raw=await page.evaluate(async mode=>(await import('/src/phasePlay/phaseTalkLibraries.ts')).talkInstructions(mode).map(x=>x.text),mode);
  expect(rows.map((x:any)=>x.text).sort()).toEqual(raw.sort());
 }
});

test('实际游戏使用修改后的指令，暂停修改删除后不会继续显示旧缓存',async({page})=>{
 await launch(page);
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const e=await import('/src/phasePlay/engine.ts');const {savePhaseData}=await import('/src/phasePlay/storage.ts');const settings={...e.defaults(),sweetMode:true,defaultTalkOverrides:{sweet:[{id:'custom:sweet:only',phase:'red' as const,text:'已保存的旧卡片'}],dirty:[{id:'custom:dirty:only',phase:'red' as const,text:'另一模式独立卡片'}]}};savePhaseData(db.name,{version:1,settings,session:{...e.initial(settings),status:'paused',step:1,prompt:'已保存的旧卡片',draws:{red:{scope:'default:sweet',used:['custom:sweet:only'],lastId:'custom:sweet:only'}}}});});
 await page.getByRole('button',{name:'退出应用',exact:true}).click();await page.getByRole('button',{name:'忍一下嘛',exact:true}).click();await page.getByRole('button',{name:'指令',exact:true}).click();
 const c=await manage(page,'sweet');await c.getByRole('button',{name:'编辑',exact:true}).click();await c.getByLabel('指令内容').fill('游戏必须使用的新卡片');await c.getByRole('button',{name:'保存指令',exact:true}).click();
 expect((await saved(page)).session.prompt).toBe('游戏必须使用的新卡片');
 await page.getByRole('button',{name:'我准备好了 · 开始'}).click();await expect(page.locator('.phase-play-prompt')).toHaveText('游戏必须使用的新卡片');
 await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'快速退出',exact:true}).click();await page.getByRole('button',{name:'忍一下嘛',exact:true}).click();await page.getByRole('button',{name:'指令',exact:true}).click();await manage(page,'sweet');page.once('dialog',d=>d.accept());await c.getByRole('button',{name:'删除',exact:true}).click();expect((await saved(page)).session.prompt).not.toBe('游戏必须使用的新卡片');
 await page.getByRole('button',{name:'我准备好了 · 开始'}).click();await expect(page.locator('.phase-play-prompt')).not.toHaveText('游戏必须使用的新卡片');
 expect((await saved(page)).settings.defaultTalkOverrides.dirty).toEqual([{id:'custom:dirty:only',phase:'red',text:'另一模式独立卡片'}]);
});

test('旧设置、角色词库、历史和其他本地数据保持，编辑覆盖数据按模式灯色抽取',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const e=await import('/src/phasePlay/engine.ts');const storage=await import('/src/phasePlay/storage.ts');
  const oldSettings=e.defaults();const character={id:'character:person:world:one',phase:'green' as const,text:'原有角色指令'};oldSettings.prompts=[character];
  const data={version:1 as const,settings:oldSettings,session:e.initial(oldSettings),libraryVersions:{'character:person:world:':[{savedAt:1,prompts:[character]}]}};
  localStorage.setItem('unrelated-fixture','must-keep');storage.savePhaseData('compat-fixture',data);const old=storage.loadPhaseData('compat-fixture');
  const s={...old.data.settings,sweetMode:true,defaultTalkOverrides:{sweet:[{id:'custom:sweet:r',phase:'red' as const,text:'用户红灯'}],dirty:[{id:'custom:dirty:g',phase:'green' as const,text:'用户另一模式绿灯'}]}};
  storage.savePhaseData('compat-fixture',{...old.data,settings:s});const restored=storage.loadPhaseData('compat-fixture');
  return {oldError:old.error,restoredError:restored.error,characters:restored.data.settings.prompts,history:restored.data.libraryVersions,red:e.instructionPool(restored.data.settings,'red'),green:e.instructionPool(restored.data.settings,'green'),dirty:e.instructionPool({...restored.data.settings,commandMode:true,sweetMode:false},'green'),unrelated:localStorage.getItem('unrelated-fixture')};
 });
 expect(result.oldError).toBe('');expect(result.restoredError).toBe('');expect(result.characters).toHaveLength(1);expect(result.history!['character:person:world:']).toHaveLength(1);expect(result.red.map(x=>x.text)).toEqual(['用户红灯']);expect(result.green).toEqual([]);expect(result.dirty.map(x=>x.text)).toEqual(['用户另一模式绿灯']);expect(result.unrelated).toBe('must-keep');
});

test('保存失败时原覆盖库不被替换，输入仍保留',async({page})=>{
 await launch(page);const c=await manage(page,'sweet');await c.getByRole('button',{name:'＋ 新增指令'}).click();await c.getByLabel('指令内容').fill('失败后仍应保留的草稿');
 const before=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
 await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('claudia.phasePlay.v1:'))throw new DOMException('quota','QuotaExceededError');set.call(this,key,value);};});
 await c.getByRole('button',{name:'保存指令'}).click();await expect(page.getByRole('alert')).toContainText('本地保存失败');await expect(c.getByLabel('指令内容')).toHaveValue('失败后仍应保留的草稿');expect(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)))).toEqual(before);
});
