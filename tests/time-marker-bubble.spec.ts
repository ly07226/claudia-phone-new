import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('stored assistant metadata bubbles are hidden without altering original content or legitimate dates',async({page})=>{
 await isolatedApp(page,'time-bubble-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {messageBubbles}=await import('/src/messageBubbles.ts');
  const {isLeakedTimeMarkerBubble}=await import('/src/timeMarkerSanitizer.ts');
  const content='[消息发送时间：2026-11-16, 11:15]\n终于舍得回我了？\n我们约在2026-11-16, 11:15见面。';
  const m={id:'m',conversationId:'c',role:'assistant' as const,createdAt:Date.now(),content};
  return {original:m.content,visible:messageBubbles(m).filter(p=>p.kind==='text').map(p=>p.text),marker:isLeakedTimeMarkerBubble('[消息发送时间：2026-11-16, 11:15]'),legit:isLeakedTimeMarkerBubble('我们约在2026-11-16, 11:15见面。')};
 });
 expect(result.original).toContain('[消息发送时间：');
 expect(result.visible.join('')).not.toContain('[消息发送时间：');
 expect(result.visible.join('')).toContain('终于舍得回我了？');
 expect(result.visible.join('')).toContain('我们约在2026-11-16, 11:15见面。');
 expect(result.marker).toBe(true);
 expect(result.legit).toBe(false);
});


test('mixed bubble, legacy splitting and user text retain exact original offsets',async({page})=>{
 await isolatedApp(page,'time-offset-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {messageBubbles}=await import('/src/messageBubbles.ts');
  const {visibleWithoutLeakedTimeMarkers}=await import('/src/timeMarkerSanitizer.ts');
  const content='前一句。\n[消息发送时间：2026-11-16, 11:15]\n后一句。';
  const m={id:'m',conversationId:'c',role:'assistant' as const,createdAt:Date.now(),content};
  const current=messageBubbles(m),legacy=messageBubbles(m,true);
  const user=messageBubbles({...m,role:'user' as const});
  const mixed='前一句。\n[消息发送时间：2026-11-16, 11:15]\n后一句。';
  return {current,legacy,user,mixed,spans:visibleWithoutLeakedTimeMarkers(mixed)};
 });
 for(const parts of [result.current,result.legacy]){
   const texts=parts.filter(p=>p.kind==='text');
   expect(texts.map(p=>p.text).join('')).not.toContain('[消息发送时间：');
   expect(texts.map(p=>p.text).join('')).toContain('前一句。');
   expect(texts.map(p=>p.text).join('')).toContain('后一句。');
   for(const p of texts)expect(result.mixed.slice(p.start,p.end)).toBe(p.text);
 }
 expect(result.user.map(p=>p.text).join('')).toContain('[消息发送时间：');
 expect(result.spans.map(p=>result.mixed.slice(p.start,p.end)).join('')).toBe('前一句。\n后一句。');
});
