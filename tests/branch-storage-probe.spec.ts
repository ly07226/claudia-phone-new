import {test,expect} from '@playwright/test';
import {seedPerformance} from './performanceFixture';
// Measures remaining physical duplication; passing means original data survives
// restore, NOT that single-body storage or garbage collection is implemented.
for(const count of [1000,5000,10000])test(`早期编辑/回退的存储观测与原文完整性 ${count}`,async({page},info)=>{
 test.setTimeout(180000);const id=await seedPerformance(page,count);
 const result=await page.evaluate(async({id,count})=>{
  const {db}=await import('/src/store.ts'),{activeMessages}=await import('/src/messagePath.ts'),{editMessage}=await import('/src/messageOperations.ts'),{switchTimeline}=await import('/src/timelines.ts');
  const before=await activeMessages(id),original=JSON.stringify(before),timeline=(await db.conversations.get(id))!.activeTimelineId!,beforeNodes=await db.pathNodes.where('conversationId').equals(id).count();
  const start=performance.now();await editMessage(id,'m1','一次早期历史编辑',true);const editMs=performance.now()-start,afterEditNodes=await db.pathNodes.where('conversationId').equals(id).count();
  const restoreStart=performance.now();await switchTimeline(id,timeline);const restoreMs=performance.now()-restoreStart,after=await activeMessages(id);
  const probeId='m'+Math.floor(count/2),copies=await db.pathNodes.where('conversationId').equals(id).filter(n=>n.messageId===probeId).count();
  return {count,beforeNodes,afterEditNodes,afterRestoreNodes:await db.pathNodes.where('conversationId').equals(id).count(),unchangedMessageNodeCopies:copies,restoredOriginal:original===JSON.stringify(after),messages:await db.messages.where('conversationId').equals(id).count(),active:after.length,editMs,restoreMs};
 },{id,count});
 console.log('BRANCH_STORAGE_PROBE',JSON.stringify(result));await info.attach('branch-storage-observation',{body:JSON.stringify(result),contentType:'application/json'});
 expect(result.beforeNodes).toBe(count);expect(result.messages).toBe(count);expect(result.active).toBe(count);expect(result.restoredOriginal).toBe(true);
});
