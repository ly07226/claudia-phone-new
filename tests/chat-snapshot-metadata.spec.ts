import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
test('相同消息保留DOM，租约元数据更新立即解锁输入和重试',async({page})=>{
 await isolatedApp(page,'snapshot-meta-'+crypto.randomUUID());const id=await page.evaluate(async()=>{const {db,usePhone}=await import('/src/store.ts');await db.characters.put({id:'actor',name:'快照角色',persona:''});const c=await(await import('/src/chatService.ts')).getConversation('actor');await db.messages.put({id:'msg',conversationId:c.id,role:'user',content:'消息原样保留',createdAt:1});await db.conversations.update(c.id,{sendingToken:'synthetic-lease',sendingUntil:Date.now()+120000});await usePhone.getState().reload();return c.id;});
 await page.getByRole('button',{name:'聊天',exact:true}).click();await page.locator('.chat-list-row').filter({hasText:'快照角色'}).click();const input=page.getByLabel('聊天消息',{exact:true});await expect(input).toBeDisabled();await page.locator('.chat-bubble-surface').first().evaluate(el=>(window as any).metadataBubble=el);
 await page.evaluate(async id=>{const {db}=await import('/src/store.ts');await db.conversations.update(id,{sendingToken:undefined,sendingUntil:undefined});},id);
 await expect(input).toBeEnabled();await expect(page.getByRole('button',{name:'重试最后一条消息',exact:true})).toBeVisible();expect(await page.locator('.chat-bubble-surface').first().evaluate(el=>el===(window as any).metadataBubble)).toBe(true);await expect(page.locator('.chat-history')).toContainText('消息原样保留');
});
