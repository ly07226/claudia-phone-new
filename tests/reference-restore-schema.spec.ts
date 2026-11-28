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

for(const fault of ['none','old-source','derived-image','derived-meta'] as const)test(`旧v6回退及贴纸派生来源核验 ${fault}`,async({page})=>{
 test.setTimeout(120000);await seedPerformance(page,2);
 const r=await page.evaluate(async fault=>{
  const {db}=await import('/src/store.ts'),f=await import('/src/backupFormat.ts'),D=Object.getPrototypeOf(db.constructor),name='claudia-restore-rollback-'+crypto.randomUUID(),source=new D(name);
  source.version(6).stores(f.v6BackupSchemas);await source.open();
  await source.table('characters').put({id:'rollback-role',name:'旧角色',persona:'保留'});
  const sticker={id:crypto.randomUUID(),label:'旧表情',group:'旧分组',createdAt:1,extra:new File(['original metadata'],'original.txt',{lastModified:1}),data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
  await source.table('themes').put({id:'sticker-library',stickers:[sticker]});
  const tables:any={};for(const table of Object.keys(f.v6BackupSchemas)){let digest=await f.tableSeed(table as any);const rows=await source.table(table).orderBy(':id').toArray();for(const row of rows)digest=await f.nextDigest(digest,await f.rowBytes(table as any,row));tables[table]={count:rows.length,digest};}
  if(fault==='old-source')await source.table('characters').update('rollback-role',{name:'被篡改'});
  if(fault==='derived-image'||fault==='derived-meta'){await(await import('/src/restoreData.ts')).upgradeRestoreCandidate(source);if(fault==='derived-image')await source.table('stickerImages').update(sticker.id,{data:'tampered'});else await source.table('stickerMeta').update(sticker.id,{extra:new File(['tampered metadata'],'other.txt',{lastModified:2})});}
  source.close();localStorage.setItem('claudia.restore.rollback.v1',JSON.stringify({name,targetName:db.name,createdAt:new Date().toISOString(),tables}));
  const before=JSON.stringify(await Promise.all([db.characters.toArray(),db.messages.toArray()]));let restored=false;try{await(await import('/src/restoreService.ts')).restoreToCurrent([],{database:db,confirmed:true,rollback:true});restored=true;}catch{}
  const extra=(await db.stickerMeta.get(sticker.id) as any)?.extra;
  return {restored,metadataIntact:extra instanceof File&&await extra.text()==='original metadata',unchanged:before===JSON.stringify(await Promise.all([db.characters.toArray(),db.messages.toArray()])),messages:await db.messages.count(),role:await db.characters.get('rollback-role'),image:await db.stickerImages.get(sticker.id),originalTheme:await db.themes.get('sticker-library'),version:db.verno};
 },fault);
 expect(r.version).toBe(9);
 if(fault==='none'){expect(r.restored).toBe(true);expect(r.messages).toBe(0);expect(r.role?.name).toBe('旧角色');expect(r.metadataIntact).toBe(true);expect(r.image?.data).toBe((r.originalTheme as any).stickers[0].data);}
 else {expect(r.restored).toBe(false);expect(r.unchanged).toBe(true);expect(r.messages).toBe(2);}
});

test('旧副本表名相同但索引被改写时拒绝升级，原记录与版本保留',async({page})=>{
 await seedPerformance(page,2);const result=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts'),f=await import('/src/backupFormat.ts'),D=Object.getPrototypeOf(db.constructor),name='restore-wrong-index-'+crypto.randomUUID(),source=new D(name);
  source.version(6).stores({...f.v6BackupSchemas,messages:'id,conversationId'});await source.open();await source.table('characters').put({id:'keep',name:'保留',persona:''});source.close();let refused=false;try{await(await import('/src/restoreData.ts')).openRestoreDatabase(name);}catch{refused=true;}
  const check=new D(name);await check.open();try{return {refused,version:check.verno,name:(await check.table('characters').get('keep')).name};}finally{check.close();await D.delete(name);}
 });expect(result).toEqual({refused:true,version:6,name:'保留'});
});
