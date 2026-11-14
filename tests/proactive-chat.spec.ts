import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('主动消息只在等待时间到达后尝试一次，关闭时永不触发',async({page})=>{
 await isolatedApp(page,'proactive-rules-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {proactiveEligible}=await import('/src/proactiveMessages.ts');
  const now=Date.now(),createdAt=now-4*3600000;
  const base:any={id:'c',mode:'daily',characterId:'a',createdAt,chatSettings:{proactiveEnabled:true,proactiveHours:3,proactiveEnabledAt:createdAt}};
  const eligible=proactiveEligible(base,0,now);
  const early=proactiveEligible({...base,chatSettings:{...base.chatSettings,proactiveHours:6}},0,now);
  const repeated=proactiveEligible({...base,chatSettings:{...base.chatSettings,proactiveAttemptFor:createdAt}},0,now);
  const off=proactiveEligible({...base,chatSettings:{...base.chatSettings,proactiveEnabled:false}},0,now);
  const recentlyMessaged=proactiveEligible(base,now-3600000,now);
  const world=proactiveEligible({...base,mode:'world',worldId:'world-1'},0,now);
  return {eligible,early,repeated,off,recentlyMessaged,world};
 });
 expect(result).toEqual({eligible:true,early:false,repeated:false,off:false,recentlyMessaged:false,world:false});
});

test('主动消息通知为独立悬浮层，五秒后消失，不改动底层布局',async({page})=>{
 await isolatedApp(page,'proactive-toast-'+crypto.randomUUID());
 const before=await page.locator('body').boundingBox();
 await page.evaluate(async()=>{
  const {proactiveEvent}=await import('/src/proactiveMessages.ts');
  window.dispatchEvent(new CustomEvent(proactiveEvent,{detail:{conversationId:'test',characterId:'actor',name:'测试角色',text:'刚刚在忙什么？'}}));
 });
 const toast=page.getByRole('button',{name:'测试角色发来新消息，点击打开聊天'});
 await expect(toast).toBeVisible();
 await expect(toast).toContainText('刚刚在忙什么？');
 expect(await page.locator('body').boundingBox()).toEqual(before);
 await expect(toast).toHaveCount(0,{timeout:8000});
});

test('主动消息采用到期定时器，不进行固定间隔轮询',async({page})=>{
 await isolatedApp(page,'proactive-deadline-'+crypto.randomUUID());
 const source=await page.evaluate(async()=>{
  const response=await fetch('/src/ProactiveScheduler.tsx');
  return response.text();
 });
 expect(source).toContain('setTimeout');
 expect(source).toContain('visibilitychange');
 expect(source).toContain('liveQuery');
 expect(source).not.toContain('setInterval(');
 expect(source).not.toContain('30000');
});
