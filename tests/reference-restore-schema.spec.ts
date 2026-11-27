import {test,expect} from '@playwright/test';
import {seedPerformance} from './performanceFixture';
for(const version of [5,7] as const)test(`旧v${version} ZIP经真实导入计划升级，原始聊天保持完整`,async({page})=>{
 test.setTimeout(120000);const id=await seedPerformance(page,100);
 const result=await page.evaluate(async({id,version})=>{
  const {db}=await import('/src/store.ts'),f=await import('/src/backupFormat.ts');
  const schemas=version===5?f.legacyBackupSchemas:f.v7BackupSchemas,tables:any={},resources:any[]=[];let body='';
  for(const [name,schema]of Object.entries(schemas)){
   let rows=await db.table(name).orderBy(':id').toArray();
   if(version===5&&name==='conversations')rows=rows.map(c=>({...c,activeTimelineId:undefined,timelineEpoch:undefined}));
   const exported=name==='apiCredentials'?[]:rows;let digest=await f.tableSeed(name as any);
   for(const row of exported){const bytes=await f.rowBytes(name as any,row);digest=await f.nextDigest(digest,bytes);body+=new TextDecoder().decode(bytes)+'\n';if(name==='assets')resources.push({id:row.id,bytes:f.utf8(row.data).length,digest:await f.sha(f.utf8(row.data))});}
   tables[name]={schema,sourceCount:rows.length,count:exported.length,digest};
  }
  const backupId=crypto.randomUUID(),now=new Date().toISOString(),bytes=f.utf8(body),part={index:0,name:backupId+'.part-0001.cphone',bytes:bytes.length,digest:await f.sha(bytes)};
  const manifest={format:'claudia-phone-backup',version:version===5?1:3,codec:1,backupId,schemaVersion:version,nativeVersion:version*10,createdAt:now,snapshotCompletedAt:now,coordination:'isolated synthetic legacy archive',tables,resources,parts:[part],credentials:'excluded',redactions:[]};
  const zip=await import('/src/backupZip.ts');const file=await zip.packBackupZip({manifest,readPart:async()=>new Blob([bytes]),dispose:async()=>{}} as any);
  const {prepareZipImport,defaultImportOptions,getImportPlan}=await import('/src/importPlan.ts');const plan=await prepareZipImport(file,defaultImportOptions);
  try{const target=getImportPlan(plan,db).database;return {version:target.verno,messages:await target.table('messages').count(),originals:await db.messages.where('conversationId').equals(id).count()};}finally{await plan.dispose();}
 },{id,version});
 expect(result).toEqual({version:9,messages:100,originals:100});
});
test('未知临时库结构在升级前拒绝，所有原记录与未知表保留',async({page})=>{
 await seedPerformance(page,2);
 const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts'),f=await import('/src/backupFormat.ts'),D=Object.getPrototypeOf(db.constructor),name='restore-unknown-'+crypto.randomUUID();
  const candidate=new D(name);candidate.version(7).stores({...f.v7BackupSchemas,unknown:'id'});await candidate.open();await candidate.table('unknown').put({id:'keep',value:'must survive'});candidate.close();
  let rejected=false;try{await(await import('/src/restoreData.ts')).openRestoreDatabase(name);}catch{rejected=true;}
  const check=new D(name);await check.open();try{return {rejected,version:check.verno,row:await check.table('unknown').get('keep')};}finally{check.close();await D.delete(name);}
 });
 expect(result).toEqual({rejected:true,version:7,row:{id:'keep',value:'must survive'}});
});
