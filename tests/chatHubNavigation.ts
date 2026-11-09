import {expect,type Page} from '@playwright/test';
const names=new WeakMap<Page,string>();
export async function chatTab(page:Page){await page.getByRole('tab',{name:'聊天',exact:true}).click();}
export async function openChatFeatures(page:Page){
 const name=(await page.locator('.chat-nav-title').innerText()).trim();names.set(page,name);
 const id=await page.evaluate(async name=>{const {db}=await import('/src/store.ts');const actor=await db.characters.filter(c=>c.name===name).first();if(actor)return actor.id;const c=await db.conversations.filter(c=>c.mode==='daily'&&c.chatSettings?.remark===name).first();return c?.characterId;},name);
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await page.getByRole('tab',{name:'设置',exact:true}).click();await page.getByLabel('设置对应角色',{exact:true}).selectOption(id!);await expect(page.getByRole('switch',{name:'连续发送模式',exact:true})).toBeVisible();
}
export async function returnToChat(page:Page){await chatTab(page);await page.getByRole('button',{name:`${names.get(page)} 开始 / 继续聊天`,exact:true}).click();}
