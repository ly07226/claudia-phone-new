import {test,expect} from '@playwright/test';
import {seedPerformance} from './performanceFixture';
for(const count of [1000,5000,10000])test(`快照工作集 ${count}`,async({page})=>{
 test.setTimeout(120000);const id=await seedPerformance(page,count);
 const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts'),ops=await import('/src/messageOperations.ts');
  let reads=0;const get=db.pathNodes.get.bind(db.pathNodes);db.pathNodes.get=((key:any)=>{reads++;return get(key);}) as any;
  try{const start=performance.now();const saved=await db.transaction('rw',ops.messageTables(),async()=>await ops.snapshotPath(id,'edit'));
   const snapshotMs=performance.now()-start,nodeGets=reads;reads=0;const pageStart=performance.now();const display=await(await import('/src/timelines.ts')).readTimelineDisplayPage(id,36);return {count:await db.messages.where('conversationId').equals(id).count(),snapshotMs,bytes:JSON.stringify(saved).length,nodeGets,pageGets:reads,pageMs:performance.now()-pageStart,pageRows:display.rows.length};
  }finally{db.pathNodes.get=get as any;}
 },id);
 console.log('SNAPSHOT_COST',JSON.stringify(result));expect(result.count).toBe(count);expect(result.bytes).toBeLessThan(1024);expect(result.nodeGets).toBeLessThanOrEqual(1);expect(result.pageGets).toBe(36);expect(result.pageRows).toBe(36);
});
