import {test,expect} from '@playwright/test';

test('legacy ZIP v1 and compressed ZIP both rehearse through lazy isolated import',async({page})=>{
 await page.goto('/');
 await page.waitForFunction(async()=>{const {usePhone}=await import('/src/store.ts');return usePhone.getState().ready;});
 const result=await page.evaluate(async()=>{
   const {db}=await import('/src/store.ts');
   const {createZipBackup,readBackupZip}=await import('/src/backupZip.ts');
   const {prepareZipImport,defaultImportOptions}=await import('/src/importPlan.ts');
   const {ZipWriter,BlobWriter,BlobReader}=await import('/tests/zipFixture.ts');
   const original=await createZipBackup({closedOtherClients:true});
   const files=await readBackupZip(original);
   const info=new File([JSON.stringify({format:'claudia-phone-zip',version:1,encryption:'none',payloadFormat:'claudia-phone-backup'})],'backup-info.json');
   const writer=new ZipWriter(new BlobWriter('application/zip'),{useWebWorkers:false,level:0,zip64:false});
   for(const f of [info,...files])await writer.add(f.name,new BlobReader(f));
   const legacy=new File([await writer.close()],'legacy-v1.zip',{type:'application/zip'});
   const before=await db.messages.count();
   const previews=[];
   for(const file of [legacy,original]){
     const plan=await prepareZipImport(file,defaultImportOptions);
     try{previews.push({version:plan.preview.formatVersion,changed:plan.preview.changed});}
     finally{await plan.dispose();}
   }
   return {previews,unchanged:before===await db.messages.count()};
 });
 expect(result.previews).toHaveLength(2);
 expect(result.unchanged).toBe(true);
});


test('new backup screen exports one ZIP without a password setup step',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.desktop')).toBeVisible();
  await page.getByRole('button',{name:'桌面第2页',exact:true}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'数据备份与恢复',exact:true}).click();
  await expect(page.getByRole('button',{name:'导出备份'})).toBeVisible();
  await expect(page.getByLabel('备份加密密码')).toHaveCount(0);
  await expect(page.getByLabel('加密保护')).toHaveCount(0);
  await expect(page.getByText('单个 ZIP 上限 1024 MiB',{exact:false})).toBeVisible();
});


test('password-free full ZIP retains API credentials and restores into isolated preview',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.desktop')).toBeVisible();
  const result=await page.evaluate(async()=>{
    const {db}=await import('/src/store.ts');
    const {createZipBackup,inspectBackupZip,readBackupZip}=await import('/src/backupZip.ts');
    const {prepareZipImport,defaultImportOptions}=await import('/src/importPlan.ts');
    const key='fixture-backup-api-key-not-real';
    await db.apiConfigs.put({id:'backup-key-test',name:'测试 API',provider:'openai-compatible',baseUrl:'https://example.test/v1',model:'test',enabled:true,isDefault:false,createdAt:1,updatedAt:1});
    await db.apiCredentials.put({configId:'backup-key-test',apiKey:key});
    const zip=await createZipBackup({closedOtherClients:true,includeCredentials:true,credentialConsent:true});
    const info=await inspectBackupZip(zip);
    const files=await readBackupZip(zip);
    const manifest=JSON.parse(await files.find(f=>f.name.endsWith('.manifest.json'))!.text());
    const data=(await Promise.all(files.filter(f=>f.name.endsWith('.cphone')).map(f=>f.text()))).join('');
    const plan=await prepareZipImport(zip,{...defaultImportOptions,keys:'missing'});
    try{return {encrypted:info.encrypted,credentials:manifest.credentials,hasKey:data.includes(key),status:plan.preview.credentialChanges.added+plan.preview.credentialChanges.kept+plan.preview.credentialChanges.replaced};}
    finally{await plan.dispose();}
  });
  expect(result.encrypted).toBe(false);
  expect(result.credentials).toBe('included');
  expect(result.hasKey).toBe(true);
  expect(result.status).toBeGreaterThanOrEqual(0);
});


test('legacy ZIP v1 AES and v2 encrypted backups can enter the new staged importer',async({page})=>{
 await page.goto('/');
 await expect(page.locator('.desktop')).toBeVisible();
 const result=await page.evaluate(async()=>{
   const {db}=await import('/src/store.ts');
   const {createZipBackup,readBackupZip,inspectBackupZip}=await import('/src/backupZip.ts');
   const {prepareZipImport,defaultImportOptions}=await import('/src/importPlan.ts');
   const password='legacy-compatibility-fixture-password';
   const before=await db.messages.count();
   const oldV1=await createZipBackup({closedOtherClients:true,password});
   const modernV2=await createZipBackup({closedOtherClients:true,password,includeCredentials:true,credentialConsent:true});
   const versions=[];
   for(const file of [oldV1,modernV2]){
     const header=await inspectBackupZip(file);
     const plan=await prepareZipImport(file,defaultImportOptions,{password});
     try{versions.push({version:header.version,encrypted:header.encrypted,preview:plan.preview.formatVersion});}
     finally{await plan.dispose();}
   }
   return {versions,unchanged:before===await db.messages.count()};
 });
 expect(result.versions.map(v=>v.version)).toEqual([1,2]);
 expect(result.versions.every(v=>v.encrypted)).toBe(true);
 expect(result.unchanged).toBe(true);
});
