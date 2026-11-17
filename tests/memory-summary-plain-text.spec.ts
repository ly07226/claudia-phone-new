import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

const config={id:'summary-fixture',name:'summary-fixture',provider:'openai-compatible' as const,baseUrl:'https://summary.test/v1',model:'fixture',temperature:0.3,maxTokens:5000,enabled:true,isDefault:true,createdAt:1,updatedAt:1};
async function run(page:import('@playwright/test').Page){
 return page.evaluate(async(config)=>{
  const {requestSummary}=await import('/src/memorySummaryRequest.ts');
  try{return {text:await requestSummary(config,'synthetic-fixture-only','两人约定周末见面。',new AbortController().signal),code:''};}
  catch(error){return {text:'',code:(error as {diagnostic?:{code?:string}}).diagnostic?.code??'unknown'};}
 },config);
}
test('plain text summary accepts normal compatible response without JSON mode',async({page})=>{
 await isolatedApp(page,'summary-plain');
 let body:any;
 await page.route('https://summary.test/**',async route=>{
  body=route.request().postDataJSON();
  await route.fulfill({json:{choices:[{message:{content:'两人约定周末见面，尚未完成。'},finish_reason:'stop'}]}});
 });
 expect(await run(page)).toEqual({text:'两人约定周末见面，尚未完成。',code:''});
 expect(body.response_format).toBeUndefined();
});
test('plain text summary normalizes alternate output_text response',async({page})=>{
 await isolatedApp(page,'summary-alt');
 await page.route('https://summary.test/**',route=>route.fulfill({json:{output_text:'两人已经确定见面安排。'}}));
 expect(await run(page)).toEqual({text:'两人已经确定见面安排。',code:''});
});
test('empty output and length stop are classified without second paid request',async({page})=>{
 await isolatedApp(page,'summary-failure');
 let calls=0;
 await page.route('https://summary.test/**',route=>{calls++;return route.fulfill({json:{choices:[{message:{content:null,reasoning_content:'内部推理'},finish_reason:'length'}]}});});
 expect((await run(page)).code).toBe('truncated');
 expect(calls).toBe(1);
});
