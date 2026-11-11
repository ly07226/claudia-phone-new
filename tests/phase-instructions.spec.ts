import {test,expect} from '@playwright/test';
test('built-in instruction pool follows phase and category filters',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const lib=await import('/src/phasePlay/instructions.ts');
  return {red:lib.instructionPool('red'),filtered:lib.instructionPool('red',{excludedCategories:['rest']}),empty:lib.pickInstruction('red',{excludedCategories:['rest','focus']}),chosen:lib.pickInstruction('green',{},()=>0)};
 });
 expect(result.red.length).toBeGreaterThan(0);
 expect(result.red.every(x=>x.phase==='red')).toBe(true);
 expect(result.filtered.every(x=>x.category!=='rest')).toBe(true);
 expect(result.empty).toBeNull();
 expect(result.chosen?.phase).toBe('green');
});
test('character prompt is scoped and never performs AI calls',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const lib=await import('/src/phasePlay/instructions.ts');
  const base=lib.instructionPool('red')[0];
  const request=lib.buildCharacterInstructionRequest(base,{characterName:'角色甲',persona:'说话冷静',speakingStyle:'简短',worldContext:'仅当前世界'});
  return {request,fallback:lib.sanitizeGeneratedInstruction('<unsafe>',base),good:lib.sanitizeGeneratedInstruction('现在停一下。',base)};
 });
 expect(result.request.user).toContain('仅当前世界');
 expect(result.request.system).toContain('不得增加新动作');
 expect(result.fallback).toBe('暂停当前动作，等待下一阶段。');
 expect(result.good).toBe('现在停一下。');
});
