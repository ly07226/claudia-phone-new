import {test,expect} from '@playwright/test';
import {seedPerformance} from './performanceFixture';
test('引用快照通过数据库校验并完整ZIP读回，原文只在路径来源读取',async({page})=>{
 test.setTimeout(120000);const id=await seedPerformance(page,1000);
 const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const ops=await import('/src/messageOperations.ts');
  const snapshot=await db.transaction('rw',ops.messageTables(),async()=>await ops.snapshotPath(id,'edit')).catch(e=>{throw Error('snapshot: '+e.name+': '+e.message);});
  await(await import('/src/timelineValidation.ts')).validateTimelineDatabase(db);
  const zip=await import('/src/backupZip.ts');const file=await zip.createZipBackup({closedOtherClients:true});
  const files=await zip.readBackupZip(file);
  const checked=await(await import('/src/backupService.ts')).readBackup(files,{mode:'rehearse'});
  try{return {references:snapshot.references?.storageVersion,inline:snapshot.messages.length,status:checked.report.status,originals:await db.messages.where('conversationId').equals(id).count()};}finally{await checked.dispose();}
 },id);
 expect(result).toEqual({references:3,inline:0,status:'rehearsed',originals:1000});
});
test('引用篡改不会通过导出校验或恢复，事务失败不影响原消息',async({page})=>{
 const id=await seedPerformance(page,100);
 const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const ops=await import('/src/messageOperations.ts');const snapshot=await db.transaction('rw',ops.messageTables(),async()=>await ops.snapshotPath(id,'edit')).catch(e=>{throw Error('snapshot: '+e.name+': '+e.message);});
  try{await db.conversationSnapshots.update(snapshot.id,{'references.headNodeId':'other-chat'});}catch(e){throw Error('tamper update: '+(e as Error).name+': '+(e as Error).message);}
  let validate=false,restore=false;
  try{await(await import('/src/timelineValidation.ts')).validateTimelineDatabase(db);}catch{validate=true;}
  try{await ops.restoreSnapshot(id,snapshot.id);}catch{restore=true;}
  return {validate,restore,count:await db.messages.where('conversationId').equals(id).count()};
 },id);
 expect(result).toEqual({validate:true,restore:true,count:100});
});
test('编辑已有回复版本后，引用快照恢复的是原始正文而非可变版本现值',async({page})=>{
 const id=await seedPerformance(page,2);
 const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const ops=await import('/src/messageOperations.ts');
  const m=(await db.messages.get('m1'))!,variant={id:'original-v',messageId:m.id,conversationId:id,content:m.content,source:'legacy' as const,createdAt:m.createdAt};
  await db.messageVariants.put(variant);const source={...m,activeVariantId:variant.id};
  await db.messages.put(source);const timeline=await import('/src/timelines.ts');await db.pathNodes.update('n1',{message:source,variantId:variant.id,fingerprint:await timeline.messageFingerprint(source)});
  const before=source.content;await ops.editMessage(id,'m1','修改后的回复');
  const snapshot=(await db.conversationSnapshots.where('conversationId').equals(id).toArray()).find(s=>s.reason==='edit')!;
  await ops.restoreSnapshot(id,snapshot.id);
  return {before,after:(await(await import('/src/messagePath.ts')).activeMessages(id)).at(-1)?.content};
 },id);
 expect(result.after).toBe(result.before);
});
test('旧V2引用和内联快照继续可预览、恢复',async({page})=>{
 const id=await seedPerformance(page,100);
 const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts'),ops=await import('/src/messageOperations.ts'),t=await import('/src/timelines.ts');
  const modern=await db.transaction('rw',ops.messageTables(),async()=>await ops.snapshotPath(id,'edit'));
  const nodes=await t.nodesForHead(id,modern.headNodeId);
  const old={...modern,id:'legacy-v2',references:{storageVersion:2 as const,timelineId:modern.timelineId,headNodeId:modern.headNodeId,timelineEpoch:modern.timelineEpoch,messageIds:nodes.map(n=>n.messageId),variantIds:[]}};
  await db.conversationSnapshots.put(old);
  const preview=await(await import('/src/snapshotPreview.ts')).readSnapshotPreview(old);
  await ops.restoreSnapshot(id,old.id);
  const inline={id:'legacy-inline',conversationId:id,reason:'restore' as const,createdAt:1,messages:[nodes[0].message],variants:[]};await db.conversationSnapshots.put(inline);
  await ops.restoreSnapshot(id,inline.id);
  return {preview:preview.length,first:preview[0].id,restored:(await(await import('/src/messagePath.ts')).activeMessages(id)).map(m=>m.content)};
 },id);
 expect(result).toEqual({preview:30,first:'m70',restored:['消息 0']});
});
test('头节点快照合并ZIP重映射后仍指向正确角色和路径，当前聊天不被覆盖',async({page})=>{
 test.setTimeout(120000);const id=await seedPerformance(page,100);
 const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts'),ops=await import('/src/messageOperations.ts');
  const snapshot=await db.transaction('rw',ops.messageTables(),async()=>await ops.snapshotPath(id,'edit'));
  const zip=await import('/src/backupZip.ts'),files=await zip.readBackupZip(await zip.createZipBackup({closedOtherClients:true}));
  await db.characters.update('perf-actor',{persona:'保留目标库现有人设'});
  const {prepareImport,defaultImportOptions,getImportPlan}=await import('/src/importPlan.ts');
  const plan=await prepareImport(files,{...defaultImportOptions,mode:'merge'});
  try{
   const target=getImportPlan(plan,db).database;
   const imported=(await target.table('conversationSnapshots').toArray()).find(s=>s.conversationId!==id);
   if(!imported)throw Error('未生成冲突隔离的导入快照');
   await(await import('/src/timelineValidation.ts')).validateTimelineDatabase(target);
   const c=await target.table('conversations').get(imported.conversationId),head=await target.table('pathNodes').get(imported.headNodeId);
   return {changed:imported.headNodeId!==snapshot.headNodeId,owner:head.conversationId===c.id,reference:imported.references.headNodeId===head.id,originals:await db.messages.where('conversationId').equals(id).count(),persona:(await db.characters.get('perf-actor'))!.persona};
  }finally{await plan.dispose();}
 },id);
 expect(result).toEqual({changed:true,owner:true,reference:true,originals:100,persona:'保留目标库现有人设'});
});
for(const width of [390,430])test(`引用快照预览及输入布局 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});const id=await seedPerformance(page,1000);
 await page.evaluate(async id=>{const {db}=await import('/src/store.ts'),ops=await import('/src/messageOperations.ts');await db.transaction('rw',ops.messageTables(),async()=>await ops.snapshotPath(id,'edit'));},id);
 await page.getByRole('button',{name:'聊天',exact:true}).click();await page.locator('.chat-list-row').filter({hasText:'性能角色'}).click();
 await page.getByRole('button',{name:'会话管理',exact:true}).click();await page.getByRole('button',{name:'历史快照 / 分支恢复',exact:true}).click();
 await page.getByRole('button',{name:'查看快照',exact:true}).click();await expect(page.locator('.snapshot-preview')).toContainText('消息 998');
 expect(await page.locator('.snapshot-preview > p').count()).toBe(31);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`artifacts/reference-snapshot-${width}.png`,fullPage:true,animations:'disabled'});
});
