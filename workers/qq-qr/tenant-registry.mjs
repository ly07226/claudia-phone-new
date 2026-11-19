// Pure, opt-in tenant routing primitives. Not wired into production listeners yet.
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const PROJECT=/^https:\/\/([a-z0-9-]+)\.supabase\.co$/;
const TENANT=/^[a-z0-9][a-z0-9_-]{2,63}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateTenant(record){
 if(!record||typeof record!=='object'||!TENANT.test(record.tenantId||''))throw Error('invalid_tenant_id');
 if(typeof record.projectUrl!=='string'||!PROJECT.test(record.projectUrl))throw Error('invalid_project_url');
 if(typeof record.sharedSecret!=='string'||Buffer.byteLength(record.sharedSecret,'utf8')<32)throw Error('invalid_tenant_secret');
 return Object.freeze({tenantId:record.tenantId,projectUrl:record.projectUrl,sharedSecret:record.sharedSecret});
}
export function tenantBindingKey(tenantId,bindingId){
 if(!TENANT.test(tenantId)||typeof bindingId!=='string'||!UUID.test(bindingId))throw Error('invalid_binding');
 return tenantId+':'+bindingId.toLowerCase();
}
export class TenantRegistry{
 #records=new Map();
 register(record){
  const valid=validateTenant(record);
  if(this.#records.has(valid.tenantId))throw Error('tenant_already_registered');
  for(const existing of this.#records.values())if(existing.projectUrl===valid.projectUrl)throw Error('project_already_registered');
  this.#records.set(valid.tenantId,valid);
  return {tenantId:valid.tenantId,projectUrl:valid.projectUrl};
 }
 get(tenantId){return this.#records.get(tenantId)||null;}
 revoke(tenantId){return this.#records.delete(tenantId);}
 list(){return [...this.#records.values()].map(({tenantId,projectUrl})=>({tenantId,projectUrl}));}
}
// Caller must persist nonce consumption and use durable registration storage before enabling HTTP endpoints.
export function issueChallenge(){
 return {nonce:randomBytes(32).toString('hex'),expiresAt:Date.now()+120000};
}
export function signChallenge(secret,tenantId,projectUrl,nonce,expiresAt){
 if(typeof nonce!=='string'||!/^[0-9a-f]{64}$/.test(nonce)||!Number.isSafeInteger(expiresAt))throw Error('invalid_challenge');
 const tenant=validateTenant({tenantId,projectUrl,sharedSecret:secret});
 return createHmac('sha256',tenant.sharedSecret).update(JSON.stringify([tenant.tenantId,tenant.projectUrl,nonce,expiresAt])).digest('hex');
}
export function verifyChallenge(record,challenge,signature,now=Date.now()){
 const tenant=validateTenant(record);
 if(!challenge||typeof challenge!=='object'||!Number.isSafeInteger(challenge.expiresAt)||challenge.expiresAt<=now||challenge.expiresAt>now+120000)return false;
 if(typeof signature!=='string'||!/^[0-9a-f]{64}$/.test(signature))return false;
 try{
  const expected=signChallenge(tenant.sharedSecret,tenant.tenantId,tenant.projectUrl,challenge.nonce,challenge.expiresAt);
  return timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex'));
 }catch{return false;}
}
