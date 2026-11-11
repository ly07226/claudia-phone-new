import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('设置进入API后逐级返回设置和桌面',async({page})=>{
 await isolatedApp(page,'settings-navigation-'+crypto.randomUUID());
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'AI / API 设置',exact:true}).click();await expect(page.locator('.api-settings')).toBeVisible();await page.getByRole('button',{name:'返回设置',exact:true}).click();await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回桌面',exact:true}).click();await expect(page.locator('.desktop')).toBeVisible();
});

const children=[
 {entry:'AI / API 设置',app:'AI / API 设置',selector:'.api-settings'},
 {entry:'世界书 / Lorebook',app:'世界书 / Lorebook',selector:'.lore-app'},
 {entry:'主题与桌面',app:'主题编辑器',selector:'.theme-editor'},
 {entry:'数据备份与恢复',app:'数据备份与恢复',selector:'.backup-page'},
 {entry:'编辑用户身份',app:'用户身份',selector:'.identity-editor'},
];
async function snapshot(page:import('@playwright/test').Page){return page.evaluate(async()=>{const {db}=await import('/src/store.ts');return JSON.stringify(await Promise.all(db.tables.map(t=>t.toArray())));});}
async function shortcut(page:import('@playwright/test').Page,app:string){await page.evaluate(async app=>{const {db,usePhone}=await import('/src/store.ts');if(!usePhone.getState().items.some(i=>i.kind==='app'&&i.app===app))await db.items.put({id:'nav-shortcut-'+app,kind:'app',app,pageId:'page-1',position:100,size:1});await usePhone.getState().reload();},app);}
for(const child of children)test(`设置来源：${child.entry}返回设置，再返回桌面，不修改存储数据`,async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await isolatedApp(page,'settings-origin-'+crypto.randomUUID());const before=await snapshot(page);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:child.entry,exact:true}).click();await expect(page.locator(child.selector)).toBeVisible();await expect(page.getByRole('button',{name:'返回设置',exact:true})).toBeVisible();
 if(child.app==='AI / API 设置')await page.screenshot({path:info.outputPath('settings-api-return-390.png')});
 await page.getByRole('button',{name:'返回设置',exact:true}).click();await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回桌面',exact:true}).click();await expect(page.locator('.desktop')).toBeVisible();expect(await snapshot(page)).toBe(before);
});
for(const child of children)test(`桌面来源：${child.app}不误回设置，重复进入来源不残留`,async({page})=>{
 await isolatedApp(page,'desktop-origin-'+crypto.randomUUID());await shortcut(page,child.app);
 // First visit through Settings, then use the desktop shortcut to the same App.
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:child.entry,exact:true}).click();await expect(page.locator(child.selector)).toBeVisible();await page.getByRole('button',{name:'返回设置',exact:true}).click();await page.getByRole('button',{name:'返回桌面',exact:true}).click();
 await page.getByRole('button',{name:child.app,exact:true}).click();await expect(page.locator(child.selector)).toBeVisible();await expect(page.getByRole('button',{name:'返回桌面',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'返回设置',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'返回桌面',exact:true}).click();await expect(page.locator('.desktop')).toBeVisible();
});

test('设置进入桌面编辑后完成返回设置；桌面长按编辑后完成返回桌面',async({page})=>{
 await isolatedApp(page,'desktop-edit-origin-'+crypto.randomUUID());const before=await snapshot(page);await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'编辑桌面',exact:true}).click();await expect(page.locator('.edit-tools')).toBeVisible();await page.getByRole('button',{name:'完成',exact:true}).click();await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回桌面',exact:true}).click();
 await page.getByRole('button',{name:'聊天',exact:true}).scrollIntoViewIfNeeded();const box=await page.getByRole('button',{name:'聊天',exact:true}).boundingBox();await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();await expect(page.locator('.edit-tools')).toBeVisible();await page.mouse.up();await page.getByRole('button',{name:'完成',exact:true}).click();await expect(page.locator('.desktop')).toBeVisible();await expect(page.locator('.edit-tools')).toHaveCount(0);expect(await snapshot(page)).toBe(before);
});

test('刷新沿用桌面启动，不带入旧返回栈；重新从设置进入仍可逐级返回',async({page})=>{
 await isolatedApp(page,'refresh-origin-'+crypto.randomUUID());await shortcut(page,'AI / API 设置');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'AI / API 设置',exact:true}).click();await expect(page.getByRole('button',{name:'返回设置',exact:true})).toBeVisible();await page.reload();await expect(page.locator('.desktop')).toBeVisible();await page.getByRole('button',{name:'AI / API 设置',exact:true}).click();await page.getByRole('button',{name:'返回桌面',exact:true}).click();await expect(page.locator('.desktop')).toBeVisible();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'AI / API 设置',exact:true}).click();await page.getByRole('button',{name:'返回设置',exact:true}).click();await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();
});

test('Daily旧来源不泄漏到World，切换空间后直接入口及设置入口各自正确',async({page})=>{
 await isolatedApp(page,'scope-navigation-'+crypto.randomUUID());await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'AI / API 设置',exact:true}).click();
 await page.evaluate(async()=>{const {db,usePhone}=await import('/src/store.ts');await db.worlds.put({id:'nav-world',name:'导航世界',description:'隔离测试',createdAt:1});await usePhone.getState().reload();await(await import('/src/spaces.ts')).useSpaces.getState().enterSpace('world:nav-world');});
 await expect(page.locator('.desktop')).toBeVisible();await page.getByRole('button',{name:'主题编辑器',exact:true}).click();await page.getByRole('button',{name:'返回桌面',exact:true}).click();await expect(page.locator('.desktop')).toBeVisible();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'世界书 / Lorebook',exact:true}).click();await page.getByRole('button',{name:'返回设置',exact:true}).click();await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回桌面',exact:true}).click();expect(await page.evaluate(async()=>(await import('/src/spaces.ts')).useSpaces.getState().space?.spaceId)).toBe('world:nav-world');
});

test('返回设置恢复列表滚动位置，API表单原有编辑取消仍正常',async({page})=>{
 await page.setViewportSize({width:390,height:640});await isolatedApp(page,'settings-scroll-'+crypto.randomUUID());await page.getByRole('button',{name:'设置',exact:true}).click();const scroll=page.locator('.phone>.app-panel>.app-scroll');await scroll.evaluate(el=>el.scrollTop=80);await page.getByRole('button',{name:'AI / API 设置',exact:true}).scrollIntoViewIfNeeded();const top=await scroll.evaluate(el=>el.scrollTop);expect(top).toBeGreaterThan(0);
 await page.getByRole('button',{name:'AI / API 设置',exact:true}).click();await page.getByRole('button',{name:'＋ 添加 API 配置',exact:true}).click();await page.getByLabel('配置名称',{exact:true}).fill('未保存的测试配置');await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'返回设置',exact:true}).click();await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBe(top);expect(await page.evaluate(async()=>(await import('/src/store.ts')).db.apiConfigs.count())).toBe(0);
});

test('身份保存、取消均按来源返回，资料保存和桌面直接入口保留',async({page})=>{
 await isolatedApp(page,'identity-return-'+crypto.randomUUID());await shortcut(page,'用户身份');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'编辑用户身份',exact:true}).click();await page.getByLabel('用户名字',{exact:true}).fill('导航测试身份');await page.getByRole('button',{name:'保存用户身份',exact:true}).click();await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();await expect(page.locator('.identity-card')).toContainText('导航测试身份');await page.getByRole('button',{name:'返回桌面',exact:true}).click();await page.getByRole('button',{name:'用户身份',exact:true}).click();await page.getByLabel('用户名字',{exact:true}).fill('取消不保存');await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.desktop')).toBeVisible();expect(await page.evaluate(async()=>(await import('/src/store.ts')).db.themes.get('global').then(t=>t?.userIdentities?.daily?.name))).toBe('导航测试身份');
});

test('兼容旧入口：直接状态跳转记录来源，回到桌面后不复用旧设置父页',async({page})=>{
 await isolatedApp(page,'legacy-entry-origin-'+crypto.randomUUID());await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'AI / API 设置',exact:true}).click();await page.evaluate(async()=>{const {usePhone}=await import('/src/store.ts');usePhone.getState().set({activeApp:null});usePhone.getState().set({activeApp:'AI / API 设置'});});await expect(page.getByRole('button',{name:'返回桌面',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回桌面',exact:true}).click();
 await page.getByRole('button',{name:'聊天',exact:true}).click();await page.evaluate(async()=>{(await import('/src/store.ts')).usePhone.getState().set({activeApp:'AI / API 设置'});});await page.getByRole('button',{name:'返回聊天',exact:true}).click();await expect(page.getByRole('tabpanel',{name:'聊天',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回桌面',exact:true}).click();await expect(page.locator('.desktop')).toBeVisible();
});
