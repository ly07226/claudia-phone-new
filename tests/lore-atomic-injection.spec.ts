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
  const overflow=planLore([{entry,book}],history,8,()=>0);
  return {text:selected.entries[0]?.content,overflowCount:overflow.entries.length,overflowText:overflow.entries[0]?.content,overflowReason:overflow.diagnostics[0]?.reason,fullStatus:selected.diagnostics[0]?.completeness,partialStatus:overflow.diagnostics[0]?.completeness};
 });
 expect(result.text).toContain('后半段：不得替用户决定行动');
 expect(result.overflowCount).toBe(0);
 expect(result.fullStatus).toBe('full');
 expect(result.partialStatus).toBe('omitted');
});

test('常驻世界书优先保留完整规则片段，超预算不中断',async({page})=>{
 await isolatedApp(page,'lore-constant-overflow-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {newBook,newEntry}=await import('/src/loreTypes.ts');
  const {planLore}=await import('/src/loreEngine.ts');
  const book={...newBook(),global:true,charBudget:200};
  const large={...newEntry(book.id),id:'large',constant:true,content:'必须遵守规则一。必须遵守规则二。必须遵守规则三。',priority:200};
  const small={...newEntry(book.id),id:'small',constant:true,content:'短常驻规则。',priority:100};
  const planned=planLore([{entry:large,book},{entry:small,book}],[],22,()=>0);
  return {entries:planned.entries.map(e=>({id:e.id,content:e.content})),reasons:planned.diagnostics.map(d=>({id:d.entryId,reason:d.reason,completeness:d.completeness}))};
 });
 expect(result.entries[0]?.id).toBe('large');
 expect(result.entries[0]?.content).toContain('必须遵守规则一。');
 expect(result.reasons).toContainEqual({id:'large',reason:'injected',completeness:'partial'});
 expect(result.reasons).toContainEqual({id:'small',reason:'context-budget',completeness:'omitted'});
});

test('世界书优先级与完整性：高优先级先占预算，部分注入可诊断',async({page})=>{
 await isolatedApp(page,'lore-priority-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {newBook,newEntry}=await import('/src/loreTypes.ts');
  const {planLore}=await import('/src/loreEngine.ts');
  const book={...newBook(),global:true,charBudget:100};
  const high={...newEntry(book.id),id:'high',priority:200,primaryKeys:['钥匙'],content:'钥匙放在柜子里。钥匙只能由角色本人拿取。'};
  const low={...newEntry(book.id),id:'low',priority:100,primaryKeys:['钥匙'],content:'低优先级的其他说明。'};
  const history=[{id:'m',conversationId:'c',role:'user' as const,content:'钥匙',createdAt:1}];
  const plan=planLore([{entry:low,book},{entry:high,book}],history,20,()=>0);
  return {ids:plan.entries.map(e=>e.id),status:plan.diagnostics.map(d=>({id:d.entryId,completeness:d.completeness}))};
 });
 expect(result.ids).toEqual(['high']);
 expect(result.status).toContainEqual({id:'high',completeness:'partial'});
 expect(result.status).toContainEqual({id:'low',completeness:'omitted'});
});

test('世界书限制条件不能脱离主规则单独注入',async({page})=>{
 await isolatedApp(page,'lore-dependent-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {retrieveLorePassages}=await import('/src/loreEngine.ts');
  const content='角色可以主动提出建议。但是不能替用户决定行动。角色喜欢喝茶。';
  return {
   short:retrieveLorePassages(content,[],10),
   enough:retrieveLorePassages(content,[],30)
  };
 });
 expect(result.short).not.toContain('不能替用户决定行动');
 expect(result.enough).toContain('角色可以主动提出建议。但是不能替用户决定行动。');
});

test('独立段落的禁止规则不被错误合并到上一段',async({page})=>{
 await isolatedApp(page,'lore-paragraph-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {retrieveLorePassages}=await import('/src/loreEngine.ts');
  return retrieveLorePassages('角色喜欢喝茶。\n\n不得改变人物核心性格。',[{role:'user',content:'核心性格'}] as any,15);
 });
 expect(result).toContain('不得改变人物核心性格。');
 expect(result).not.toContain('角色喜欢喝茶。');
});

test('预算容得下完整段落时不拆散隐含的性格限制',async({page})=>{
 await isolatedApp(page,'lore-character-paragraph-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {retrieveLorePassages}=await import('/src/loreEngine.ts');
  const paragraph='角色说话常带玩笑。真正生气时会沉默，不会突然变得刻薄。';
  const content=paragraph+'\n\n他喜欢晴天。';
  return retrieveLorePassages(content,[{role:'user',content:'生气'}] as any,paragraph.length);
 });
 expect(result).toBe('角色说话常带玩笑。真正生气时会沉默，不会突然变得刻薄。');
});
