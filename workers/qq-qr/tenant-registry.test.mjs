import test from 'node:test';
import assert from 'node:assert/strict';
import {TenantRegistry,tenantBindingKey,issueChallenge,signChallenge,verifyChallenge,validateTenant} from './tenant-registry.mjs';

const a={tenantId:'alice_01',projectUrl:'https://alice-project.supabase.co',sharedSecret:'a'.repeat(40)};
const b={tenantId:'bob_01',projectUrl:'https://bob-project.supabase.co',sharedSecret:'b'.repeat(40)};
const binding='123e4567-e89b-42d3-a456-426614174000';
test('isolates projects and never lists secrets',()=>{
 const registry=new TenantRegistry();
 registry.register(a);registry.register(b);
 assert.equal(registry.list().length,2);
 assert.equal(JSON.stringify(registry.list()).includes(a.sharedSecret),false);
 assert.notEqual(tenantBindingKey(a.tenantId,binding),tenantBindingKey(b.tenantId,binding));
 assert.throws(()=>registry.register({...b,tenantId:'other_01'}),/project_already_registered/);
 assert.equal(registry.revoke(a.tenantId),true);
 assert.equal(registry.get(a.tenantId),null);
 assert.equal(registry.get(b.tenantId)?.projectUrl,b.projectUrl);
});
test('rejects untrusted hosts and weak secrets',()=>{
 assert.throws(()=>validateTenant({...a,projectUrl:'https://alice-project.supabase.co.evil.test'}));
 assert.throws(()=>validateTenant({...a,projectUrl:'http://alice-project.supabase.co'}));
 assert.throws(()=>validateTenant({...a,sharedSecret:'short'}));
});
test('challenge signature binds tenant, project, nonce and expiry',()=>{
 const c=issueChallenge(),signature=signChallenge(a.sharedSecret,a.tenantId,a.projectUrl,c.nonce,c.expiresAt);
 assert.equal(verifyChallenge(a,c,signature),true);
 assert.equal(verifyChallenge(b,c,signature),false);
 assert.equal(verifyChallenge(a,c,signature,c.expiresAt),false);
 assert.equal(verifyChallenge(a,{...c,nonce:'f'.repeat(64)},signature),false);
 assert.equal(verifyChallenge(a,c,'0'.repeat(64)),false);
});
