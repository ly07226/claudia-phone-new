import {test,expect} from '@playwright/test';
import {magneticWatermark,magneticBatchHealth,canRecoverMagneticAttempt,MAGNET_PENDING_RECOVERY_MS,ownsMagneticClaim} from '../src/memoryMagnetMessages';

test('contiguous checkpoint stops at failed revision despite later success',()=>{
 const rows=[{id:'m1',fingerprint:'a'},{id:'m2',fingerprint:'b'},{id:'m3',fingerprint:'c'}];
 const completed=new Set(['m1:a','m3:c']);
 expect(magneticWatermark(rows,completed)).toEqual({processed:1,throughMessageId:'m1',throughFingerprint:'a'});
 completed.add('m2:b');
 expect(magneticWatermark(rows,completed)).toEqual({processed:3,throughMessageId:'m3',throughFingerprint:'c'});
});

test('edited source revision blocks checkpoint until reprocessed',()=>{
 const rows=[{id:'m1',fingerprint:'new'},{id:'m2',fingerprint:'same'}];
 expect(magneticWatermark(rows,new Set(['m1:old','m2:same'])).processed).toBe(0);
});

test('zero-success alarm is based on persisted consecutive runs',()=>{
 const a=magneticBatchHealth(0,2,0);
 const b=magneticBatchHealth(a.zeroRuns,3,0);
 expect(a.deadlight).toBe(false);
 expect(b.deadlight).toBe(true);
 expect(magneticBatchHealth(b.zeroRuns,0,0).deadlight).toBe(true);
 expect(magneticBatchHealth(b.zeroRuns,1,1)).toEqual({zeroRuns:0,deadlight:false});
});

test('pending claims cannot be retried while a request may still be running',()=>{
 const now=10000000;
 expect(canRecoverMagneticAttempt({status:'pending',startedAt:now-1000},now)).toBe(false);
 expect(canRecoverMagneticAttempt({status:'pending',startedAt:now-MAGNET_PENDING_RECOVERY_MS},now)).toBe(true);
 expect(canRecoverMagneticAttempt({status:'failed',startedAt:now-1000},now)).toBe(true);
});

test('stale provider success or failure cannot overwrite a replacement claim',()=>{
 const old={messageId:'m1',fingerprint:'rev1',status:'pending' as const,claimId:'old'};
 const replacement={...old,claimId:'new'};
 expect(ownsMagneticClaim(old,'m1','rev1','old')).toBe(true);
 expect(ownsMagneticClaim(replacement,'m1','rev1','old')).toBe(false);
 expect(ownsMagneticClaim(replacement,'m1','rev1','new')).toBe(true);
 expect(ownsMagneticClaim({...replacement,status:'failed' as const},'m1','rev1','new')).toBe(false);
 expect(ownsMagneticClaim(replacement,'m1','rev2','new')).toBe(false);
});
