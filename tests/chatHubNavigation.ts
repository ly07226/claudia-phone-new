import {expect,type Page,type Locator} from '@playwright/test';
const names=new WeakMap<Page,string>();
export async function chatTab(page:Page){await page.getByRole('tab',{name:'聊天',exact:true}).click();}
export async function openChatFeatures(page:Page){
 const name=(await page.locator('.chat-nav-title').innerText()).trim();names.set(page,name);
 const id=await page.evaluate(async name=>{const {db}=await import('/src/store.ts');const actor=await db.characters.filter(c=>c.name===name).first();if(actor)return actor.id;const c=await db.conversations.filter(c=>c.mode==='daily'&&c.chatSettings?.remark===name).first();return c?.characterId;},name);
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.getByRole('tab',{name:'设置',exact:true}).click();await page.getByLabel('设置对应角色',{exact:true}).selectOption(id!);await expect(page.getByRole('switch',{name:'连续发送模式',exact:true})).toBeVisible();
}
export async function returnToChat(page:Page){await chatTab(page);await page.getByRole('button',{name:`${names.get(page)} 开始 / 继续聊天`,exact:true}).click();}

/** Tap an already-visible horizontal overlay without Playwright scrolling its absolute-positioned DOM into view. */
export async function tapMomentAction(page:Page,post:Locator,name:'点赞'|'取消点赞'|'评论'){
 const bar=post.getByRole('group',{name:'点赞与评论'});await expect(bar).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');const button=bar.getByRole('button',{name,exact:true});await expect(button).toBeVisible();const box=(await button.boundingBox())!,panel=(await page.getByRole('tabpanel',{name:'朋友圈',exact:true}).boundingBox())!;
 expect(box.x).toBeGreaterThanOrEqual(panel.x);expect(box.x+box.width).toBeLessThanOrEqual(panel.x+panel.width);expect(box.y).toBeGreaterThanOrEqual(panel.y);expect(box.y+box.height).toBeLessThanOrEqual(panel.y+panel.height+1);await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
}
