import {test,expect} from '@playwright/test';
import {seedPerformance} from './performanceFixture';
for(const count of [1000,5000,10000])test(`输入不重渲染聊天主树 ${count}`,async({page},info)=>{
 test.setTimeout(180000);
 await page.addInitScript(()=>{
  (window as any).chatRenders=0;
  (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject:()=>1,onCommitFiberRoot:(_id:any,root:any)=>{
   const visit=(node:any)=>{if(!node)return;if(node.type?.name==='Chat'&&(node.flags&1))(window as any).chatRenders++;visit(node.child);visit(node.sibling);};visit(root.current);
  },onCommitFiberUnmount:()=>{}};
 });
 await seedPerformance(page,count);
 await page.getByRole('button',{name:'聊天',exact:true}).click();
 await page.locator('.chat-list-row').filter({hasText:'性能角色'}).click();
 await expect(page.locator('.chat-bubble').last()).toHaveAttribute('data-message-id','m'+(count-1));
 const input=page.getByLabel('聊天消息',{exact:true});
 await expect(input).toBeEnabled();await expect.poll(()=>page.evaluate(()=>(window as any).chatRenders)).toBeGreaterThan(0);
 await page.waitForTimeout(100);
 const before=await page.evaluate(()=>(window as any).chatRenders);
 const start=Date.now();await input.pressSequentially('连续输入不应重新计算历史列表'.repeat(4),{delay:0});
 const metrics={count,typingMs:Date.now()-start,chatRenders:await page.evaluate(()=>(window as any).chatRenders)-before};
 console.log('DRAFT_ISOLATION',JSON.stringify(metrics));
 await info.attach('draft-metrics',{body:JSON.stringify(metrics),contentType:'application/json'});
 expect(metrics.chatRenders).toBe(0);
 await expect(input).toHaveValue('连续输入不应重新计算历史列表'.repeat(4));
 await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(input).toHaveValue('');
 await expect(page.locator('.chat-bubble').last()).toContainText('连续输入');
 await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();
});
