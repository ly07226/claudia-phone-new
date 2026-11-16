import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
for(const stage of ['events','group'] as const)for(const reason of ['stop','length','content_filter'])test(`辅助摘要 ${stage} / ${reason} 不把未完成输出提交为成功`,async({page})=>{
 await isolatedApp(page,'completion-'+crypto.randomUUID());let calls=0;
 await page.route('https://summary-completion.test/**',r=>{calls++;return r.fulfill({json:{choices:[{message:{content:'{"summary":"有完整JSON但可能未完成的摘要。"}'},finish_reason:reason}]}});});
 const result=await page.evaluate(async stage=>{const r=await import('/src/memorySummaryRequest.ts');const config={id:'completion',name:'mock',provider:'openai-compatible' as const,baseUrl:'https://summary-completion.test/v1',model:'mock',temperature:0,maxTokens:3000,enabled:true,createdAt:1,updatedAt:1};try{return {text:stage==='events'?await r.requestChunkEvents(config,'synthetic','[]',new AbortController().signal):await r.requestGroupDigest(config,'synthetic',['已发生事件'],new AbortController().signal)};}catch(e){return {diagnostic:(e as any).diagnostic};}},stage);
 expect(calls).toBe(1);if(reason==='stop')expect(result.text).toContain('完整JSON');else {expect(result.text).toBeUndefined();expect(result.diagnostic?.code).toBe(reason==='length'?'truncated':'response-shape');}
});
