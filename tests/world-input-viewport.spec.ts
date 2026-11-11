import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
for(const width of [375,390,430])test(`世界表单聚焦字号、尺寸和草稿 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});await isolatedApp(page,'world-input-'+crypto.randomUUID());
 await page.evaluate(async()=>{await(await import('/src/spaces.ts')).useSpaces.getState().openWorldEditor('manual');});
 const labels=['故事标题','整体剧情梗概','补充规则','世界背景','发展方向'];
 for(const label of labels){const control=page.getByLabel(label,{exact:true});await control.fill('保留草稿 abc');
  const node=await control.elementHandle();
  for(let cycle=0;cycle<2;cycle++){await control.focus();
   expect(await control.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
   await page.setViewportSize({width,height:440});await expect(control).toBeFocused();await expect(control).toHaveValue('保留草稿 abc');
   expect(await control.evaluate(el=>el===document.activeElement)).toBe(true);
   await control.blur();await page.setViewportSize({width,height:844});
  }
  expect(await node!.evaluate(el=>el.isConnected)).toBe(true);
 }
 const select=page.getByLabel('剧情节奏',{exact:true});expect(await select.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const viewport=await page.locator('meta[name=viewport]').getAttribute('content');expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
});
for(const width of [375,390,430])test(`剧本自定义行动与篇幅控件无缩放风险 ${width}`,async({page})=>{
 const {storySeed,reply}=await import('./storyFixture');await page.setViewportSize({width,height:844});await storySeed(page);
 await page.route('https://story.test/**',r=>r.fulfill({json:{choices:[{message:{content:JSON.stringify(reply())}}]}}));
 await page.evaluate(async()=>{await(await import('/src/storyGeneration.ts')).generateStory('story');});
 await page.getByRole('button',{name:'剧本',exact:true}).click();
 const controls=page.getByLabel('自定义行动',{exact:true});
 await expect(controls).toHaveCount(1);
 for(const control of await controls.all())expect(await control.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 await page.getByRole('button',{name:'剧本设置',exact:true}).click();
 expect(await page.getByLabel('剧情篇幅',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
