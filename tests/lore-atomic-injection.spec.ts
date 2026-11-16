import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('日常全局世界书超预算时不中断聊天',async({page})=>{
 await isolatedApp(page,'lore-atomic-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {newBook,newEntry}=await import('/src/loreTypes.ts');
  const {planLore}=await import('/src/loreEngine.ts');
  const book={...newBook(),global:true,charBudget:200};
  const entry={...newEntry(book.id),primaryKeys:['钥匙'],content:'前半段：角色知道钥匙。后半段：不得替用户决定行动。',triggerMode:'instant' as const};
  const history=[{id:'m',conversationId:'c',role:'user' as const,content:'钥匙在哪里',createdAt:1}];
  const selected=planLore([{entry,book}],history,500,()=>0);
  const overflow=planLore([{entry,book}],history,12,()=>0);
  return {text:selected.entries[0]?.content,overflowCount:overflow.entries.length,overflowText:overflow.entries[0]?.content,overflowReason:overflow.diagnostics[0]?.reason};
 });
 expect(result.text).toContain('后半段：不得替用户决定行动');
 expect(result.overflowCount).toBe(1);
 expect(result.overflowText?.length).toBeLessThan(result.text.length);
 expect(result.overflowText).toContain('前半段');
});

test('常驻世界书超预算时跳过并继续处理其他条目',async({page})=>{
 await isolatedApp(page,'lore-constant-overflow-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {newBook,newEntry}=await import('/src/loreTypes.ts');
  const {planLore}=await import('/src/loreEngine.ts');
  const book={...newBook(),global:true,charBudget:200};
  const large={...newEntry(book.id),id:'large',constant:true,content:'必须遵守的完整规则'.repeat(30),priority:200};
  const small={...newEntry(book.id),id:'small',constant:true,content:'短常驻规则',priority:100};
  const planned=planLore([{entry:large,book},{entry:small,book}],[],30,()=>0);
  return {entries:planned.entries.map(e=>e.id),reasons:planned.diagnostics.map(d=>({id:d.entryId,reason:d.reason}))};
 });
 expect(result.entries).toEqual(['small']);
 expect(result.reasons).toContainEqual({id:'large',reason:'context-budget'});
 expect(result.reasons).toContainEqual({id:'small',reason:'injected'});
});
