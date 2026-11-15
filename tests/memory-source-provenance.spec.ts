import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('primary receipt fingerprint rejects edited, deleted and switched-variant sources',async({page})=>{
 await isolatedApp(page,'memory-provenance-'+crypto.randomUUID());
 const result=await page.evaluate(async()=>{
  const {summarySourceFingerprint}=await import('/src/summarySourceFingerprint.ts');
  const message=(id:string,role:'user'|'assistant',content:string)=>({id,conversationId:'c',role,content,createdAt:id==='u'?1:2});
  const receipt={turns:[{userIds:['u'],assistantId:'a'}]};
  const original=[message('u','user','约定周六见面'),message('a','assistant','好的')];
  const initial=await summarySourceFingerprint(receipt,original);
  const edited=await summarySourceFingerprint(receipt,[{...original[0],content:'约定周日见面'},original[1]]);
  const deleted=await summarySourceFingerprint(receipt,[original[1]]);
  const variant=await summarySourceFingerprint(receipt,[original[0],{...original[1],activeVariantId:'variant-b'}]);
  return {initial,edited,deleted,variant};
 });
 expect(result.initial).toMatch(/^[0-9a-f]{64}$/);
 expect(result.edited).not.toBe(result.initial);
 expect(result.deleted).toBeUndefined();
 expect(result.variant).not.toBe(result.initial);
});
