import {test,expect} from '@playwright/test';

test('external bubble CSS: selector mapping, important, inset shadow and glass blur',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {compileThemeCSS}=await import('/src/themeCSS.ts');
  const {splitBubbleCSS,checkBubbleCSS}=await import('/src/bubbleCSS.ts');
  const input=`/* imported style */
.message-container.sent .message-bubble {
 background: #e8f5e9 !important;
 border-radius: 19px !important;
 box-shadow: 0 2px 8px rgba(200, 220, 200, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.6) !important;
 backdrop-filter: blur(12px);
 -webkit-backdrop-filter: blur(12px);
}
.message-container.received .message-bubble {
 background: rgba(255, 230, 240, 0.5) !important;
}`;
  checkBubbleCSS(input);
  const parts=splitBubbleCSS(input);
  const css=compileThemeCSS(input);
  return {parts,css};
 });
 expect(result.parts.other).toBe('');
 expect(result.parts.bubble).toContain('.theme-user-bubble');
 expect(result.parts.bubble).toContain('.theme-role-bubble');
 expect(result.css).toContain('background:#e8f5e9');
 expect(result.css).toContain('inset 0 1px 2px');
 expect(result.css).toContain('backdrop-filter:blur(12px)');
 expect(result.css).not.toContain('.message-container');
});

test('bubble editor rejects unrelated page selectors',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {checkBubbleCSS}=await import('/src/bubbleCSS.ts');
  try{checkBubbleCSS('.theme-page { color: #FFFFFF; }');return 'accepted';}
  catch{return 'rejected';}
 });
 expect(result).toBe('rejected');
});
