import {test,expect} from '@playwright/test';
import {seedPerformance} from './performanceFixture';
for(const count of [1000,5000,10000])test(`保留废弃分支后追加不扫描全部历史 ${count}`,async({page})=>{
 test.setTimeout(180000);const id=await seedPerformance(page,count);
 const result=await page.evaluate(async({id,count})=>{
  const {db}=await import('/src/store.ts'),ops=await import('/src/messageOperations.ts'),service=await import('/src/chatService.ts');
  await ops.editMessage(id,'m'+(count-3),'保留原分支的历史编辑',true);await service.queueUserMessage(id,'建立当前投影证明');
  const C:any=db.messages.toCollection().constructor,original=C.prototype.toArray;let fullRows=0;
  C.prototype.toArray=async function(...args:any[]){const rows=await original.apply(this,args);if(this._ctx?.table?.name==='messages')fullRows+=rows.length;return rows;};
  try{const start=performance.now();await service.queueUserMessage(id,'本次追加不扫描历史');return {count,appendMs:performance.now()-start,fullRows,originals:await db.messages.count()};}finally{C.prototype.toArray=original;}
 },{id,count});
 console.log('ARCHIVED_APPEND',JSON.stringify(result));expect(result.originals).toBe(count+2);expect(result.fullRows).toBe(0);
});
test('同总数的外部新增/归档删除不得被快速追加证明遗漏',async({page})=>{
 const id=await seedPerformance(page,1000);
 const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts'),ops=await import('/src/messageOperations.ts'),{queueUserMessage}=await import('/src/chatService.ts');
  await ops.editMessage(id,'m997','当前分支',true);await queueUserMessage(id,'建立投影');
  await db.transaction('rw',db.messages,async()=>{await db.messages.delete('m999');await db.messages.add({id:'out-of-band',conversationId:id,role:'user',content:'不得遗漏的同步增量',createdAt:Date.now()+1});});
  await queueUserMessage(id,'后续正常发送');
  const rows=await(await import('/src/messagePath.ts')).activeMessages(id);
  return {external:rows.filter(m=>m.id==='out-of-band').length,content:rows.map(m=>m.content),originals:await db.messages.count()};
 },id);
 expect(result.external).toBe(1);expect(result.content).toContain('不得遗漏的同步增量');expect(result.content).toContain('后续正常发送');expect(result.originals).toBe(1002);
});
test('缓存仅提供批量ID提示，原生写入篡改仍从真实节点校验失败',async({page})=>{
 const id=await seedPerformance(page,1000);
 const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts'),timeline=await import('/src/timelines.ts');await(await import('/src/messagePath.ts')).activeMessages(id,undefined,true);
  const node=(await db.pathNodes.get('n999'))!;node.message.content='不能从缓存掩盖的篡改';
  await new Promise<void>((resolve,reject)=>{const tx=db.backendDB().transaction('pathNodes','readwrite');tx.objectStore('pathNodes').put(node);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  try{await timeline.readTimelineDisplayPage(id,36);return false;}catch{return true;}
 },id);
 expect(result).toBe(true);
});
