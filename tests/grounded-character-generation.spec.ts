import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('角色生成约束进入日常和世界提示词且不污染角色卡',async({page})=>{
 await isolatedApp(page,'grounded-role-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {getConversation}=await import('/src/chatService.ts');
  const {buildContext}=await import('/src/chatContext.ts');
  await db.characters.put({id:'grounded-role',name:'测试角色',persona:'黑发，偶尔开玩笑。',speakingStyle:'简洁自然。'});
  await db.worlds.put({id:'grounded-world',name:'测试世界',description:'一个独立世界',createdAt:1});
  await db.worldProfiles.put({id:'grounded-profile',worldId:'grounded-world',characterId:'grounded-role',setting:'世界身份不同'});
  const daily=await getConversation('grounded-role');
  const world=await getConversation('grounded-role','grounded-world');
  const d=(await buildContext(daily)).filter(m=>m.role==='system').map(m=>m.content).join('\n');
  const w=(await buildContext(world)).filter(m=>m.role==='system').map(m=>m.content).join('\n');
  return {d,w};
 });
 for(const s of [result.d,result.w]){
  expect(s).toContain('不得直接照搬、拼接或仅替换近义词');
  expect(s).toContain('不得擅自补写资料和当前剧情没有确立的具体事实');
  expect(s).toContain('优先回应用户当前输入');
  expect(s).toContain('黑发，偶尔开玩笑。');
 }
 expect(result.d).not.toContain('世界身份不同');
 expect(result.w).toContain('世界身份不同');
});
