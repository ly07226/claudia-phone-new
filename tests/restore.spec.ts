import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page){
  await page.goto('/');
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.evaluate(async()=>{
    const {db}=await import('/src/store.ts');const Dexie=Object.getPrototypeOf(db.constructor);
    const {backupSchemas}=await import('/src/backupFormat.ts');
    const source=new Dexie(`restore-test-source-${crypto.randomUUID()}`);source.version(9).stores(backupSchemas);await source.open();
    const target=new Dexie(`restore-test-target-${crypto.randomUUID()}`);target.version(9).stores(backupSchemas);await target.open();
    await source.table('characters').add({id:'char',name:'备份角色',persona:'人设',avatar:'img'});
    await source.table('assets').add({id:'img',type:'avatar',createdAt:1,data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='});
    const message={id:'m',conversationId:'c',role:'user',content:'备份聊天',createdAt:1};
    const {messageFingerprint}=await import('/src/timelines.ts');
    await source.table('conversations').add({id:'c',characterId:'char',mode:'daily',scopeKey:JSON.stringify(['char','daily','']),createdAt:1,updatedAt:1,activeTimelineId:'t'});
    await source.table('messages').add(message);
    await source.table('pathNodes').add({id:'node',conversationId:'c',parentNodeId:'',messageId:'m',role:'user',message,fingerprint:await messageFingerprint(message),createdAt:1});
    await source.table('timelines').add({id:'t',conversationId:'c',characterId:'char',spaceId:'daily',epoch:0,headNodeId:'node',revision:1,createdAt:1,status:'live',reason:'append'});
    await target.table('characters').add({id:'old-char',name:'原有角色',persona:'原有人设'});
    await target.table('apiConfigs').add({id:'local-api',name:'本机配置',baseUrl:'https://mock.invalid/v1',provider:'openai',model:'mock',enabled:true,isDefault:true,createdAt:1,updatedAt:1,temperature:.7,maxTokens:10});
    await target.table('apiCredentials').add({configId:'local-api',apiKey:'synthetic-local-fixture'});
    const {createBackup}=await import('/src/backupService.ts');const snapshot=await createBackup({closedOtherClients:true,database:source});
    const {packBackupZip,readBackupZip}=await import('/src/backupZip.ts');const zip=await packBackupZip(snapshot);await snapshot.dispose();
    (window as any).fixture={source,target,zip,files:await readBackupZip(zip)};
  });
}
async function contents(page:Page){return page.evaluate(async()=>{const {target}=(window as any).fixture;return JSON.stringify(await Promise.all(target.tables.map((t:any)=>t.toArray())));});}
test('ZIP验证、取消与重复恢复门禁不写正式目标；确认后全量原子恢复并可回退',async({page})=>{
  await setup(page);const before=await contents(page);
  const result=await page.evaluate(async()=>{const {target,files}=(window as any).fixture;const {readBackup}=await import('/src/backupService.ts');const check=await readBackup(files,{mode:'verify'});await check.dispose();const {restoreToCurrent}=await import('/src/restoreService.ts');let cancelled=false;try{await restoreToCurrent(files,{database:target,confirmed:false});}catch{cancelled=true;}return cancelled;});expect(result).toBe(true);expect(await contents(page)).toBe(before);
  const restored=await page.evaluate(async()=>{const {target,files}=(window as any).fixture;const {restoreToCurrent,previousRestore}=await import('/src/restoreService.ts');const r=await restoreToCurrent(files,{database:target,confirmed:true});target.close();await target.open();return {r,name:(await target.table('characters').get('char')).name,message:(await target.table('messages').get('m')).content,old:await target.table('characters').get('old-char'),nodes:await target.table('pathNodes').count(),key:(await target.table('apiCredentials').get('local-api')).apiKey,rollback:previousRestore(target.name)?.name};});
  expect(restored.name).toBe('备份角色');expect(restored.message).toBe('备份聊天');expect(restored.old).toBeUndefined();expect(restored.nodes).toBe(1);expect(restored.key).toBe('synthetic-local-fixture');expect(restored.rollback).toBe(restored.r.rollbackName);
  const undone=await page.evaluate(async()=>{const {target}=(window as any).fixture;return(await import('/src/restoreService.ts')).restoreToCurrent([],{database:target,confirmed:true,rollback:true});});expect(undone.credentials).toBe('rollback-copy');expect(await contents(page)).toBe(before);
});
test('写入中断与存储不足原子回退，回退副本完整保留；无半恢复',async({page})=>{
  await setup(page);const before=await contents(page);
  const result=await page.evaluate(async()=>{const {target,files}=(window as any).fixture;const {restoreToCurrent,previousRestore}=await import('/src/restoreService.ts');const proto=IDBObjectStore.prototype,original=proto.add;let thrown=false;
    proto.add=function(...args:any[]){if(this.transaction.db.name===target.name&&this.name==='messages'){thrown=true;throw new DOMException('fixture quota','QuotaExceededError');}return original.apply(this,args as any);};
    let failed=false;try{await restoreToCurrent(files,{database:target,confirmed:true});}catch{failed=true;}finally{proto.add=original;}
    return {failed,thrown,rollback:!!previousRestore(target.name)};});expect(result).toEqual({failed:true,thrown:true,rollback:true});expect(await contents(page)).toBe(before);
});
test('后台挂起、并发恢复及新窗口阻止提交',async({page,context})=>{
  await setup(page);const before=await contents(page);
  const r=await page.evaluate(async()=>{const {target,files}=(window as any).fixture;const {restoreToCurrent}=await import('/src/restoreService.ts');let interrupted=false,duplicate=false;const controller=new AbortController();let other:Promise<void>|undefined;
    try{await restoreToCurrent(files,{database:target,confirmed:true,signal:controller.signal,onProgress:p=>{if(p.phase==='正在恢复'&&p.table==='messageVariants'){other=restoreToCurrent(files,{database:target,confirmed:true}).then(()=>{}).catch(()=>{duplicate=true;});Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}}});}catch{interrupted=true;}finally{Object.defineProperty(document,'hidden',{configurable:true,value:false});}await other;return {interrupted,duplicate};});expect(r).toEqual({interrupted:true,duplicate:true});expect(await contents(page)).toBe(before);
  const second=await context.newPage();await second.goto('/');
  const blocked=await page.evaluate(async()=>{const {target,files}=(window as any).fixture;try{await(await import('/src/restoreService.ts')).restoreToCurrent(files,{database:target,confirmed:true});return false;}catch{return true;}});expect(blocked).toBe(true);expect(await contents(page)).toBe(before);await second.close();
});
test('旧v5备份真实恢复保留旧消息ID，新增时间线表为空而非伪造，旧格式加密仍可恢复',async({page})=>{
  await setup(page);
  const result=await page.evaluate(async()=>{const {source,target}=(window as any).fixture;const f=await import('/src/backupFormat.ts');
    const id=crypto.randomUUID(),now=new Date().toISOString(),tables:any={},resources:any[]=[];let text='';
    for(const [name,schema] of Object.entries(f.legacyBackupSchemas)){const rows=await source.table(name).orderBy(':id').toArray();let digest=await f.tableSeed(name);for(const original of rows){const row={...original};if(name==='conversations'){delete row.activeTimelineId;delete row.timelineEpoch;}const bytes=await f.rowBytes(name as any,row);digest=await f.nextDigest(digest,bytes);text+=new TextDecoder().decode(bytes)+'\n';if(name==='assets')resources.push({id:row.id,bytes:f.utf8(row.data).length,digest:await f.sha(f.utf8(row.data))});}tables[name]={schema,sourceCount:rows.length,count:rows.length,digest};}
    const bytes=f.utf8(text),part={index:0,name:`${id}.part-0001.cphone`,bytes:bytes.length,digest:await f.sha(bytes)},manifest={format:'claudia-phone-backup',version:1,codec:1,backupId:id,schemaVersion:5,nativeVersion:50,createdAt:now,snapshotCompletedAt:now,coordination:'isolated legacy fixture',tables,resources,parts:[part],credentials:'excluded',redactions:[]};
    await(await import('/src/restoreService.ts')).restoreToCurrent([new File([JSON.stringify(manifest)],`${id}.manifest.json`),new File([bytes],part.name)],{database:target,confirmed:true});
    return {version:target.verno,m:(await target.table('messages').get('m')).content,nodes:await target.table('pathNodes').count(),timelines:await target.table('timelines').count(),avatar:(await target.table('characters').get('char')).avatar};});
  expect(result).toEqual({version:9,m:'备份聊天',nodes:0,timelines:0,avatar:'img'});
});
test('旧加密分卷错误密码不写入，正确密码可恢复但不覆盖本机API配置和Key',async({page})=>{
  await setup(page);const before=await contents(page);
  const rejected=await page.evaluate(async()=>{const {source,target}=(window as any).fixture;await source.table('apiConfigs').add({id:'local-api',name:'备份内不同地址',provider:'openai',baseUrl:'https://other.invalid/v1',model:'other',enabled:true,isDefault:true,temperature:1,maxTokens:10,createdAt:1,updatedAt:1});await source.table('apiCredentials').add({configId:'local-api',apiKey:'synthetic-import-fixture'});
    const {createBackup}=await import('/src/backupService.ts');const s=await createBackup({database:source,closedOtherClients:true,includeCredentials:true,credentialConsent:true,password:'strong legacy fixture password'});const files=[new File([JSON.stringify(s.manifest)],`${s.manifest.backupId}.manifest.json`)];for(const p of s.manifest.parts)files.push(new File([await s.readPart(p.index)],p.name));await s.dispose();(window as any).fixture.encrypted=files;try{await(await import('/src/restoreService.ts')).restoreToCurrent(files,{database:target,confirmed:true,password:'wrong'});return false;}catch{return true;}});expect(rejected).toBe(true);expect(await contents(page)).toBe(before);
  const restored=await page.evaluate(async()=>{const {target,encrypted}=(window as any).fixture;await(await import('/src/restoreService.ts')).restoreToCurrent(encrypted,{database:target,confirmed:true,password:'strong legacy fixture password'});return {name:(await target.table('characters').get('char')).name,url:(await target.table('apiConfigs').get('local-api')).baseUrl,key:(await target.table('apiCredentials').get('local-api')).apiKey};});expect(restored).toEqual({name:'备份角色',url:'https://mock.invalid/v1',key:'synthetic-local-fixture'});
});
test('回退副本存储不足或回退定位写入失败时拒绝正式写入',async({page})=>{
  await setup(page);const before=await contents(page);
  const r=await page.evaluate(async()=>{const {target,files}=(window as any).fixture;const {restoreToCurrent}=await import('/src/restoreService.ts');const original=IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add=function(...args:any[]){if(this.transaction.db.name.startsWith('claudia-restore-rollback-'))throw new DOMException('fixture','QuotaExceededError');return original.apply(this,args as any);};let quota=false;try{await restoreToCurrent(files,{database:target,confirmed:true});}catch{quota=true;}finally{IDBObjectStore.prototype.add=original;}
    const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k:string,v:string){if(k==='claudia.restore.rollback.v1')throw new DOMException('fixture','QuotaExceededError');return set.call(this,k,v);};let locator=false;try{await restoreToCurrent(files,{database:target,confirmed:true});}catch{locator=true;}finally{Storage.prototype.setItem=set;}return {quota,locator};});expect(r).toEqual({quota:true,locator:true});expect(await contents(page)).toBe(before);
});
test('未知目标版本与旧Worker无法取得保护时失败关闭，不自动升级目标库',async({page})=>{
  await setup(page);const before=await contents(page);
  const r=await page.evaluate(async()=>{const {target,files}=(window as any).fixture;const {restoreToCurrent}=await import('/src/restoreService.ts');const Dexie=Object.getPrototypeOf((await import('/src/store.ts')).db.constructor);const old=new Dexie('restore-test-old-'+crypto.randomUUID());old.version(5).stores((await import('/src/backupFormat.ts')).legacyBackupSchemas);await old.open();let version=false;try{await restoreToCurrent(files,{database:old,confirmed:true});}catch{version=true;}const v=old.verno;old.close();Object.defineProperty(navigator.serviceWorker,'controller',{configurable:true,value:null});let worker=false;try{await restoreToCurrent(files,{database:target,confirmed:true});}catch{worker=true;}return {version,v,worker};});expect(r).toEqual({version:true,v:5,worker:true});expect(await contents(page)).toBe(before);
});
for(const width of [375,390,430])test(`恢复UI ${width}px：替换前确认、取消零写入，提交后重载并从随机测试库读回`,async({page})=>{
  await page.setViewportSize({width,height:844});await setup(page);const before=await contents(page);
  const name=await page.evaluate(async()=>{const {target,files}=(window as any).fixture;const {readBackup}=await import('/src/backupService.ts');const check=await readBackup(files,{mode:'verify'});await check.dispose();await(await import('/tests/restoreHarness.tsx')).mountRestore(files,check.report,target);return target.name;});
  const root=page.locator('#isolated-restore-test');await expect(root.getByRole('button',{name:'覆盖恢复',exact:true})).toBeDisabled();await root.getByRole('checkbox',{name:'我了解替换范围，已关闭其他标签页和 PWA'}).check();page.once('dialog',d=>d.dismiss());await root.getByRole('button',{name:'覆盖恢复',exact:true}).click();expect(await contents(page)).toBe(before);
  await page.screenshot({animations:'disabled',path:`artifacts/restore-confirm-${width}.png`});expect(await root.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  page.once('dialog',d=>d.accept());await Promise.all([page.waitForEvent('load'),root.getByRole('button',{name:'覆盖恢复',exact:true}).click()]);
  const restored=await page.evaluate(async name=>{const Dexie=Object.getPrototypeOf((await import('/src/store.ts')).db.constructor);const d=new Dexie(name);d.version(9).stores((await import('/src/backupFormat.ts')).backupSchemas);await d.open();const rows=await d.table('messages').toArray(),c=await d.table('characters').get('char');d.close();return {rows,c};},name);expect(restored.c.name).toBe('备份角色');expect(restored.rows[0].content).toBe('备份聊天');
});
test('恢复前仍在生成或快照后发生写入时拒绝替换，不吞掉合法新写入',async({page})=>{
  await setup(page);
  const r=await page.evaluate(async()=>{const {target,files}=(window as any).fixture;const {restoreToCurrent}=await import('/src/restoreService.ts');await target.table('conversations').add({id:'busy',characterId:'old-char',mode:'daily',scopeKey:JSON.stringify(['old-char','daily','']),createdAt:1,updatedAt:1,sendingUntil:Date.now()+60000,sendingToken:'fixture'});let sending=false;try{await restoreToCurrent(files,{database:target,confirmed:true});}catch{sending=true;}
    await target.table('conversations').delete('busy');let changed=false,write:Promise<unknown>|undefined;try{await restoreToCurrent(files,{database:target,confirmed:true,onProgress:p=>{if(p.phase==='正在恢复'&&!p.table)write=target.table('characters').update('old-char',{persona:'快照后合法新数据'});}});}catch{changed=true;}await write;return {sending,changed,old:await target.table('characters').get('old-char'),imported:await target.table('characters').get('char')};});expect(r.sending).toBe(true);expect(r.changed).toBe(true);expect(r.old.persona).toBe('快照后合法新数据');expect(r.imported).toBeUndefined();
});
