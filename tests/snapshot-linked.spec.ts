import {test,expect} from '@playwright/test';

test('linked snapshots store no duplicated message arrays and restore edited history',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {db}=await import('/src/store.ts');
    const {getCurrentTimeline,resolveTimelinePath}=await import('/src/timelines.ts');
    const {editMessage,restoreSnapshot}=await import('/src/messageOperations.ts');
    const id='linked-snapshot-'+crypto.randomUUID(),characterId='linked-char-'+crypto.randomUUID();
    await db.characters.put({id:characterId,name:'Linked Test',persona:''});
    await db.conversations.put({id,characterId,mode:'daily',scopeKey:JSON.stringify([characterId,'daily','']),createdAt:1,updatedAt:1});
    await db.messages.put({id:id+'u',conversationId:id,role:'user',content:'原始消息',createdAt:1});
    await getCurrentTimeline(id);
    await editMessage(id,id+'u','编辑后消息',true);
    const snap=(await db.conversationSnapshots.where('conversationId').equals(id).toArray())[0];
    const before=(await resolveTimelinePath(id)).map(m=>m.content);
    await restoreSnapshot(id,snap.id);
    const after=(await resolveTimelinePath(id)).map(m=>m.content);
    return {before,after,hasEmbeddedMessages:Object.hasOwn(snap,'messages'),hasEmbeddedVariants:Object.hasOwn(snap,'variants'),head:snap.headNodeId,keys:snap.versionKeys};
  });
  expect(result.before).toEqual(['编辑后消息']);
  expect(result.after).toEqual(['原始消息']);
  expect(result.hasEmbeddedMessages).toBe(false);
  expect(result.hasEmbeddedVariants).toBe(false);
  expect(result.head).toBeTruthy();
  expect(result.keys).toEqual([]);
});
