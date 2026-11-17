import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('StarHub prefix verification excludes edited, deleted and future source messages',async({page})=>{
 await isolatedApp(page,'starhub-prefix');
 const result=await page.evaluate(async()=>{
  const {magneticFromRequestPrefix}=await import('/src/memoryMagnetMessages.ts');
  const scope={mode:'daily',spaceId:'daily',conversationId:'c',characterId:'x'};
  const message={id:'m1',conversationId:'c',role:'user',content:'我们在码头相遇',createdAt:1};
  const bytes=new TextEncoder().encode(JSON.stringify(['m1','','我们在码头相遇']));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  const fingerprint=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
  const record={messageId:'m1',fingerprint,scope,summary:'在码头相遇',detail:message.content,tags:[{axis:'keyword',tag:'码头',weight:1}],createdAt:1,taggedAt:1,active:true};
  return {
   valid:(await magneticFromRequestPrefix(scope as any,[record] as any,[message] as any,'码头')).length,
   compact:(await magneticFromRequestPrefix(scope as any,[{...record,detail:''}] as any,[message] as any,'码头')).length,
   edited:(await magneticFromRequestPrefix(scope as any,[record] as any,[{...message,content:'没去过码头'}] as any,'码头')).length,
   deleted:(await magneticFromRequestPrefix(scope as any,[record] as any,[],'码头')).length,
   untagged:(await magneticFromRequestPrefix(scope as any,[{...record,tags:[]}] as any,[message] as any,'码头')).length,
   unrelated:(await magneticFromRequestPrefix(scope as any,[record] as any,[message] as any,'天气')).length,
  };
 });
 expect(result).toEqual({valid:1,compact:1,edited:0,deleted:0,untagged:0,unrelated:0});
});
