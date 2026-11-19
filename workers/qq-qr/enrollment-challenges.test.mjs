import test from 'node:test';
import assert from 'node:assert/strict';
import {EnrollmentChallenges} from './enrollment-challenges.mjs';
import {signChallenge} from './tenant-registry.mjs';

const a={tenantId:'alice_01',projectUrl:'https://alice-project.supabase.co',sharedSecret:'a'.repeat(40)};
const b={tenantId:'bob_01',projectUrl:'https://bob-project.supabase.co',sharedSecret:'b'.repeat(40)};
function signed(record,challenge){return signChallenge(record.sharedSecret,record.tenantId,record.projectUrl,challenge.nonce,challenge.expiresAt);}
test('one-time challenge cannot be replayed',()=>{
 const c=new EnrollmentChallenges();
 const challenge=c.issue(a),sig=signed(a,challenge);
 assert.equal(c.consume(a,challenge,sig),true);
 assert.equal(c.consume(a,challenge,sig),false);
 assert.equal(c.pendingCount(),0);
});
test('wrong signature burns challenge, never registers another tenant',()=>{
 const c=new EnrollmentChallenges();
 const challenge=c.issue(a);
 assert.equal(c.consume(a,challenge,signed(b,{...challenge,tenantId:b.tenantId})),false);
 assert.equal(c.consume(a,challenge,signed(a,challenge)),false);
});
test('challenge is bound to exact project and tenant',()=>{
 const c=new EnrollmentChallenges();
 const challenge=c.issue(a);
 assert.equal(c.consume({...a,projectUrl:b.projectUrl},challenge,signed(a,challenge)),false);
});
test('expired challenge is rejected',()=>{
 const c=new EnrollmentChallenges({now:()=>Date.now()+300000});
 const challenge=c.issue(a);
 assert.equal(c.consume(a,challenge,signed(a,challenge)),false);
});
