import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
import {app,space,theme,rgb,dataSnapshot} from './themeGlobalFixture';
import type {ThemeColors} from '../src/themePalette';
async function seed(page:Page){
 await isolatedApp(page,'theme-chat-acceptance-'+crypto.randomUUID());let calls=0;
 await page.route('**/v1/**',r=>{calls++;return r.abort();});
 await page.evaluate(async()=>{await(await import('/tests/backupAppFixture.ts')).richBackupData();});
 return ()=>calls;
}
async function open(page:Page,world:boolean){await space(page,world);await app(page,'聊天');await page.getByRole('button',{name:'恢复角色甲 开始 / 继续聊天',exact:true}).click();await expect(page.locator('.chat-assistant .chat-bubble-surface p')).toHaveText(world?'世界回答':'日常回答');}
async function colors(page:Page,c:ThemeColors,background=c.page){
 // Chat intentionally uses a transparent surface over the themed app panel.
 await expect.poll(()=>page.locator('.chat-app').evaluate(el=>{for(let n:Element|null=el;n;n=n.parentElement){const color=getComputedStyle(n).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent')return color;}return 'transparent';})).toBe(rgb(background));
 for(const selector of ['.chat-nav','.chat-footer'])await expect(page.locator(selector)).toHaveCSS('background-color',rgb(c.card));
 for(const selector of ['.chat-nav-title','[aria-label="返回角色列表"]','[aria-label="会话管理"]'])await expect(page.locator(selector)).toHaveCSS('color',rgb(c.text));
 for(const [side,bg,fg] of [['user',c.userBubble,c.userBubbleText],['assistant',c.assistantBubble,c.assistantBubbleText]]){
  await expect(page.locator(`.chat-${side} .chat-bubble-surface`)).toHaveCSS('background-color',rgb(bg));await expect(page.locator(`.chat-${side} .chat-bubble-surface p`)).toHaveCSS('color',rgb(fg));
 }
 await expect(page.getByLabel('聊天消息',{exact:true})).toHaveCSS('background-color',rgb(c.input));await expect(page.getByLabel('聊天消息',{exact:true})).toHaveCSS('color',rgb(c.text));
 await expect(page.locator('.chat-send')).toHaveCSS('background-color',rgb(c.button));await expect(page.locator('.chat-send')).toHaveCSS('color',rgb(c.buttonText));
 await expect(page.locator('.chat-time-divider time')).toHaveCSS('background-color',rgb(c.card));await expect(page.locator('.chat-time-divider time')).toHaveCSS('color',rgb(c.text));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
async function menu(page:Page){await page.getByRole('button',{name:'AI 消息操作',exact:true}).press('Enter');await expect(page.locator('.message-popover')).toBeVisible();}
for(const width of [390,430])for(const id of ['white','midnight','sage','pink','blue','purple','caramel'])test(`Daily/World完整聊天主题 ${id} ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:id==='midnight'?'light':'dark'});const calls=await seed(page),before=await dataSnapshot(page),c=await theme(page,id);
 for(const world of [false,true]){
  const mode=world?'world':'daily';await space(page,world);await app(page,'聊天');await expect(page.locator('.app-panel')).toHaveCSS('background-color',rgb(c.page));await expect(page.locator('.chat-list-row').first().locator('strong')).toHaveCSS('color',rgb(c.text));await expect(page.locator('.chat-list-preview').first()).toHaveCSS('color',rgb(c.muted));await expect(page.locator('.chat-list-row time').first()).toHaveCSS('color',rgb(c.muted));if(world)await expect(page.locator('.chat-world-caption')).toHaveCSS('color',rgb(c.muted));
  await page.getByRole('button',{name:'恢复角色甲 开始 / 继续聊天',exact:true}).click();await colors(page,c);await page.screenshot({path:info.outputPath(`${id}-${mode}-${width}.png`)});
  await menu(page);await expect(page.locator('.message-popover')).toHaveCSS('background-color',rgb(c.card));await expect(page.locator('.message-popover')).toHaveCSS('color',rgb(c.text));await expect(page.locator('.message-popover .danger')).toHaveCSS('color',rgb(c.danger));
  if(id==='midnight')await page.screenshot({path:info.outputPath(`${id}-${mode}-menu-${width}.png`)});
  await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.locator('.message-sheet')).toHaveCSS('background-color',rgb(c.card));await expect(page.locator('.message-sheet')).toHaveCSS('color',rgb(c.text));await expect(page.getByLabel('编辑消息内容',{exact:true})).toHaveCSS('background-color',rgb(c.input));await expect(page.getByLabel('编辑消息内容',{exact:true})).toHaveCSS('color',rgb(c.text));if(id==='midnight')await page.screenshot({path:info.outputPath(`${id}-${mode}-edit-${width}.png`)});await page.getByRole('button',{name:'关闭消息面板',exact:true}).click();
  await menu(page);await page.getByRole('button',{name:'引用回复',exact:true}).click();await expect(page.getByLabel('引用预览',{exact:true})).toBeVisible();await expect(page.getByLabel('引用预览',{exact:true})).toHaveCSS('background-color',rgb(c.card));await page.getByRole('button',{name:'取消引用',exact:true}).click();
  await menu(page);const dialog=page.waitForEvent('dialog');const click=page.getByRole('button',{name:'删除',exact:true}).click();const prompt=await dialog;expect(prompt.message()).toContain('仅删除这条消息');await prompt.dismiss();await click;await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'会话管理',exact:true}).click();await expect(page.locator('.chat-settings-page')).toHaveCSS('background-color',rgb(c.card));await expect(page.locator('.chat-settings-page')).toHaveCSS('color',rgb(c.text));await expect(page.locator('.chat-settings-page .hint').first()).toHaveCSS('color',rgb(c.muted));if(id==='midnight')await page.screenshot({path:info.outputPath(`${id}-${mode}-settings-${width}.png`)});await page.getByRole('button',{name:'修改备注',exact:true}).click();await expect(page.getByLabel('聊天备注',{exact:true})).toHaveCSS('background-color',rgb(c.input));await expect(page.getByLabel('聊天备注',{exact:true})).toHaveCSS('color',rgb(c.text));await page.getByRole('button',{name:'返回聊天设置',exact:true}).click();await page.getByRole('button',{name:'返回聊天',exact:true}).click();
 }
 expect(await dataSnapshot(page)).toBe(before);expect(calls()).toBe(0);
});
for(const width of [390,430])test(`切换即时同步、刷新与独立背景/气泡/媒体优先级 ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});const calls=await seed(page);const original=await dataSnapshot(page);
 await open(page,false);for(const id of ['white','midnight','pink']){const c=await theme(page,id);await colors(page,c);await open(page,true);await colors(page,c);await open(page,false);await colors(page,c);}
 const custom=await page.evaluate(async()=>{const {db}=await import('/src/store.ts'),{saveThemeAppearance}=await import('/src/themeAppearance.ts');const saved=(await db.themes.get('global'))!;const c={...saved.palette!.colors,page:'#EDF1F4',card:'#FAFCFD',input:'#FFFFFF',text:'#263A48',userBubble:'#36556D',userBubbleText:'#FAFCFF',assistantBubble:'#E0D8E8',assistantBubbleText:'#392F43'};await saveThemeAppearance({color:c.page,palette:{...saved.palette!,colors:c}});return c;});
 await colors(page,custom);await page.reload();await expect(page.locator('.desktop')).toBeVisible();for(const world of [false,true]){await open(page,world);await colors(page,custom);await page.screenshot({path:info.outputPath(`custom-${world?'world':'daily'}-${width}.png`)});}expect(await dataSnapshot(page)).toBe(original);
 const media=await page.evaluate(async()=>{const {db,usePhone}=await import('/src/store.ts');const theme=(await db.themes.get('global'))!,items=await db.items.toArray();await db.themes.update('global',{wallpaper:'rich-avatar'});await usePhone.getState().reload();const {getConversation}=await import('/src/chatService.ts');const d=await getConversation('rich-a'),w=await getConversation('rich-a','rich-world');const {saveChatSettings}=await import('/src/chatPreferences.ts');await saveChatSettings(d.id,{background:{kind:'color',color:'#DED6CC'}});await saveChatSettings(w.id,{background:{kind:'image',assetId:'rich-avatar'}});return {items,identities:theme.userIdentities};});
 await open(page,false);await colors(page,custom,'#DED6CC');await page.screenshot({path:info.outputPath(`custom-daily-background-${width}.png`)});await open(page,true);await expect.poll(()=>page.locator('.chat-app').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('data:image');for(const [side,bg] of [['user',custom.userBubble],['assistant',custom.assistantBubble]])await expect(page.locator(`.chat-${side} .chat-bubble-surface`)).toHaveCSS('background-color',rgb(bg));await page.screenshot({path:info.outputPath(`custom-world-background-${width}.png`)});
 await app(page,'桌面');expect(await page.locator('.phone').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('data:image');await page.reload();await expect(page.locator('.desktop')).toBeVisible();const data=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return {theme:await db.themes.get('global'),items:await db.items.toArray()};});expect(data.theme?.palette?.colors).toEqual(custom);expect(data.theme?.wallpaper).toBe('rich-avatar');expect(data.theme?.userIdentities).toEqual(media.identities);expect(data.items).toEqual(media.items);expect(calls()).toBe(0);
});
