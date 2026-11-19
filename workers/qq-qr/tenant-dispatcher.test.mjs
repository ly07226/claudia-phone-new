import test from 'node:test';
import assert from 'node:assert/strict';
import {TenantRegistry} from './tenant-registry.mjs';
import {createTenantDispatcher} from './tenant-dispatcher.mjs';
const registry=new TenantRegistry();
registry.register({tenantId:'alice_01',projectUrl:'https://alice-project.supabase.co',sharedSecret:'a'.repeat(40)});
registry.register({tenantId:'bob_01',projectUrl:'https://bob-project.supabase.co',sharedSecret:'b'.repeat(40)});
test('routes only to registered tenant project, not caller-supplied URL',async()=>{
 const calls=[];
 const dispatch=createTenantDispatcher({registry,fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({ok:true})};}});
 await dispatch({tenantId:'alice_01',functionName:'claudia-qq-ai-run',body:{projectUrl:'https://evil.test'},accessToken:'x'.repeat(40)});
 await dispatch({tenantId:'bob_01',functionName:'claudia-qq-ai-run',accessToken:'y'.repeat(40)});
 assert.equal(calls[0].url,'https://alice-project.supabase.co/functions/v1/claudia-qq-ai-run');
 assert.equal(calls[1].url,'https://bob-project.supabase.co/functions/v1/claudia-qq-ai-run');
 assert.equal(calls[0].opts.redirect,'error');
});
test('rejects unregistered tenants and arbitrary functions before network access',async()=>{
 let called=false;
 const dispatch=createTenantDispatcher({registry,fetchImpl:async()=>{called=true;}});
 await assert.rejects(dispatch({tenantId:'missing_01',functionName:'claudia-qq-ai-run',accessToken:'x'.repeat(40)}),/tenant_not_registered/);
 await assert.rejects(dispatch({tenantId:'alice_01',functionName:'arbitrary-function',accessToken:'x'.repeat(40)}),/function_not_allowed/);
 assert.equal(called,false);
});
