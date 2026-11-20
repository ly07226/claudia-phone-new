import {test,expect} from '@playwright/test';

test('legacy ZIP v1 and compressed ZIP both rehearse through lazy isolated import',async({page})=>{
 await page.goto('/');
 await page.waitForFunction(async()=>{const {usePhone}=await import('/src/store.ts');return usePhone.getState().ready;});
 const result=await page.evaluate(async()=>{
   const {db}=await import('/src/store.ts');
   const {createZipBackup,readBackupZip}=await import('/src/backupZip.ts');
   const {prepareZipImport,defaultImportOptions}=await import('/src/importPlan.ts');
   const {ZipWriter,BlobWriter,BlobReader}=await import('@zip.js/zip.js');
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
