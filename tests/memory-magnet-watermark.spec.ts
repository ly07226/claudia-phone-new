import {test,expect} from '@playwright/test';
import {isolatedApp} from './backupBrowser';

test('watermark stops at gaps and advances only through contiguous completed revisions',async({page})=>{
 await isolatedApp(page,'magnet-watermark');
 const result=await page.evaluate(async()=>{
  const {magneticWatermark}=await import('/src/memoryMagnetMessages.ts');
  const rows=[{id:'m1',fingerprint:'a'},{id:'m2',fingerprint:'b'},{id:'m3',fingerprint:'c'}];
  const done=new Set(['m1:a','m3:c']);
  const gap=magneticWatermark(rows,done);
  done.add('m2:b');
  const complete=magneticWatermark(rows,done);
  const edited=magneticWatermark([{id:'m1',fingerprint:'new'},...rows.slice(1)],done);
  const empty=magneticWatermark([],done);
  return {gap,complete,edited,empty};
 });
 expect(result).toEqual({
  gap:{processed:1,throughMessageId:'m1',throughFingerprint:'a'},
  complete:{processed:3,throughMessageId:'m3',throughFingerprint:'c'},
  edited:{processed:0,throughMessageId:undefined,throughFingerprint:undefined},
  empty:{processed:0,throughMessageId:undefined,throughFingerprint:undefined},
 });
});
