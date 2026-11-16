import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('stored assistant metadata bubbles are hidden without altering original content or legitimate dates',async({page})=>{
 await isolatedApp(page,'time-bubble-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {messageBubbles}=await import('/src/messageBubbles.ts');
  const {isLeakedTimeMarkerBubble}=await import('/src/timeMarkerSanitizer.ts');
  const content='[消息发送时间：2026-11-16, 11:15]\\n终于舍得回我了？\\n我们约在2026-11-16, 11:15见面。';
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
