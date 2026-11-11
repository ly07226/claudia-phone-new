import {test,expect} from '@playwright/test';

test('external bubble CSS survives save, reload, and compiles to real chat selectors',async({page})=>{
 await page.goto('/');
 await page.waitForFunction(async()=>{const {usePhone}=await import('/src/store.ts');return usePhone.getState().ready;});
 const source=`.message-container.sent .message-bubble { background: #e8f5e9 !important; border-radius: 19px !important; box-shadow: 0 2px 8px rgba(200, 220, 200, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.6) !important; }
.message-container.received .message-bubble { background: rgba(255, 230, 240, 0.5) !important; }`;
 await page.evaluate(async(source)=>{
  const {db}=await import('/src/store.ts');
  const {splitBubbleCSS,saveBubbleCSS}=await import('/src/bubbleCSS.ts');
  let theme=await db.themes.get('global');
  if(!theme)throw Error('Missing global theme');
  const expected=splitBubbleCSS(theme.customCss?.source??'').bubble;
  await saveBubbleCSS(source,expected);
 },source);
 await page.reload();
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');
  const {compileThemeCSS}=await import('/src/themeCSS.ts');
  const {splitBubbleCSS}=await import('/src/bubbleCSS.ts');
  const theme=await db.themes.get('global');
  const source=theme?.customCss?.source??'';
  return {source,css:compileThemeCSS(source),bubble:splitBubbleCSS(source).bubble};
 });
 expect(result.source).toContain('.theme-user-bubble');
 expect(result.source).toContain('.theme-role-bubble');
 expect(result.source).not.toContain('.message-container');
 expect(result.css).toContain('.chat-user .chat-bubble-surface');
 expect(result.css).toContain('.chat-assistant .chat-bubble-surface');
 expect(result.css).toContain('background:#e8f5e9');
 expect(result.bubble).toContain('inset 0 1px 2px');
});
