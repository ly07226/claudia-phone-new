import {test,expect} from '@playwright/test';
import {storySeed,reply} from './storyFixture';

test('合理格式差异保留原文和四项明确标签，不凭顺序伪造选项',async({page})=>{
 await storySeed(page);const result=await page.evaluate(async good=>{const {parseStoryReply}=await import('/src/storyGeneration.ts');const variants=[JSON.stringify(good),'```json\n'+JSON.stringify(good)+'\n```','以下为本次节点：\n```json\n'+JSON.stringify(good)+'\n```\n以上为完整节点。',JSON.stringify({...good,choices:[good.choices[2],good.choices[0],good.choices[3],good.choices[1]]}),JSON.stringify({...good,choices:good.choices.map(c=>({label:c.id.toLowerCase(),text:c.text}))})];return variants.map(raw=>{try{return {ok:true,value:parseStoryReply(raw)};}catch{return {ok:false};}});},reply());
 expect(result.every(r=>r.ok)).toBe(true);for(const r of result)expect(r.value).toEqual(reply());
});

test('缺失、重复、标签冲突、多个JSON、坏转义及截断不修补或伪造',async({page})=>{
 await storySeed(page);const r=await page.evaluate(async good=>{const {parseStoryReply}=await import('/src/storyGeneration.ts');const bad=[{body:'',choices:good.choices},{...good,choices:good.choices.slice(0,3)},{...good,choices:[...good.choices,good.choices[0]]},{...good,choices:[good.choices[0],good.choices[0],...good.choices.slice(2)]},{...good,choices:good.choices.map(c=>({...c,text:'重复'}))},{...good,choices:good.choices.map(c=>({id:c.id,label:'D',text:c.text}))},{...good,choices:good.choices.map(c=>c.text)},{...good,body:'x'.repeat(12001)},{...good,deleteWorld:true}].map(x=>JSON.stringify(x));bad.push(JSON.stringify(good)+'\n'+JSON.stringify(good),JSON.stringify(good).slice(0,-2),'[{"body":"正文"}',JSON.stringify(good).replace('节点','节点\n未转义换行'));
 return bad.map(raw=>{try{parseStoryReply(raw);return 'accepted';}catch(e){return (e as any).code;}});},reply());expect(r).not.toContain('accepted');expect(r).toContain('json-ambiguous');expect(r).toContain('json-incomplete');expect(r).toContain('choice-label');expect(r).toContain('choice-duplicate');
});

for(const provider of ['openai-compatible','gemini'])test(`实际 ${provider} 响应块规范化及结构协议，不额外调用模型`,async({page})=>{
 await storySeed(page,provider);let calls=0,request:any;const expected={...reply(),body:'正文中包含“对白”和 {括号}。\n\n第二段。'};
 const wrapped='以下是结果：\n```json\n'+JSON.stringify({...expected,choices:expected.choices.map(c=>({label:c.id,text:c.text}))})+'\n```';
 await page.route('https://story.test/**',r=>{calls++;request=r.request().postDataJSON();const mid=Math.floor(wrapped.length/2);return r.fulfill({json:provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'PRIVATE_REASONING_NOT_OUTPUT'},{text:wrapped.slice(0,mid)},{text:wrapped.slice(mid)}]}}]}:{choices:[{finish_reason:'stop',message:{content:[{type:'text',text:wrapped.slice(0,mid)},{type:'output_text',text:wrapped.slice(mid)}]}}]}});});
 const node=await page.evaluate(async()=>await(await import('/src/storyGeneration.ts')).generateStory('story'));expect(calls).toBe(1);expect(node.body).toBe(expected.body);expect(node.choices.map(c=>({id:c.label,text:c.text}))).toEqual(expected.choices);
 const system=provider==='gemini'?request.systemInstruction.parts[0].text:request.messages[0].content;expect(system.startsWith('输出协议优先')).toBe(true);expect(system).toContain('JSON 正确转义');expect(system).toContain('文学质感');
 if(provider==='gemini'){expect(request.generationConfig.responseSchema.properties.choices.minItems).toBe(4);expect(request.generationConfig.responseSchema.properties.choices.maxItems).toBe(4);expect(request.systemInstruction.parts).toHaveLength(1);}else expect(request.response_format).toEqual({type:'json_object'});
});

for(const provider of ['openai-compatible','gemini'])test(`${provider} 格式失败诊断脱敏，旧剧情与行动保留，无自动重试`,async({page})=>{
 await storySeed(page,provider);let calls=0,mode='good';const good={...reply(),body:'PRIVATE_STORY_BODY 不得记录到日志。'};
 await page.route('https://story.test/**',r=>{
  calls++;if(mode==='envelope')return r.fulfill({contentType:'application/json',body:'private-invalid-service-response'});
  let text=JSON.stringify(good);if(mode==='count')text=JSON.stringify({...good,choices:good.choices.slice(0,3)});if(mode==='broken')text=text.slice(0,-3);if(mode==='empty')text='';
  return r.fulfill({json:provider==='gemini'?{candidates:[{finishReason:mode==='truncated'?'MAX_TOKENS':mode==='blocked'?'SAFETY':'STOP',content:{parts:[{text}]}}]}:{choices:[{finish_reason:mode==='truncated'?'length':mode==='blocked'?'content_filter':'stop',message:{content:text}}]}});
 });
 const root=await page.evaluate(async()=>await(await import('/src/storyGeneration.ts')).generateStory('story'));
 for(const failure of ['count','broken','truncated','blocked','empty','envelope']){
  mode=failure;const state=await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {generateStory,getStoryResponseDiagnostics}=await import('/src/storyGeneration.ts');let error='';try{await generateStory('story',{kind:'custom',text:'先观察现场，暂不拆信。'});}catch(e){error=(e as Error).message;}const s=(await db.storySessions.toArray())[0];return {head:s.headNodeId,revision:s.revision,draft:s.actionDraft,status:s.status,nodes:await db.storyNodes.count(),error,diagnostics:getStoryResponseDiagnostics()};});
  expect(state.head).toBe(root.id);expect(state.revision).toBe(1);expect(state.nodes).toBe(1);expect(state.draft?.customText).toBe('先观察现场，暂不拆信。');expect(state.status).toBe('failed');expect(state.error).toBe('模型未返回有效正文及四个选项，原进度未改变。');
  expect(state.diagnostics.at(-1)?.code).toBe({count:'choice-count',broken:'json-incomplete',truncated:'truncated',blocked:'blocked',empty:'empty-response',envelope:'envelope-invalid'}[failure]);
  expect(JSON.stringify(state.diagnostics)).not.toMatch(/PRIVATE_|private-invalid|synthetic|story-fixture|先观察|拆信/);
 }
 expect(calls).toBe(7);await page.reload();expect(calls).toBe(7);
});
