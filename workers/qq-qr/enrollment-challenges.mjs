// In-memory challenge coordinator for isolated development testing only.
// Production must use a durable, atomic nonce store shared across replicas.
import {issueChallenge,verifyChallenge,validateTenant} from './tenant-registry.mjs';

export class EnrollmentChallenges{
 #pending=new Map();
 #now;
 constructor({now=()=>Date.now()}={}){this.#now=now;}
 issue(record){
  const tenant=validateTenant(record);
  const challenge=issueChallenge();
  this.#pending.set(tenant.tenantId,{projectUrl:tenant.projectUrl,...challenge});
  return {tenantId:tenant.tenantId,nonce:challenge.nonce,expiresAt:challenge.expiresAt};
 }
 consume(record,challenge,signature){
  const tenant=validateTenant(record);
  const pending=this.#pending.get(tenant.tenantId);
  if(!pending)return false;
  // Consume before verification: a failed signature must not permit replay.
  this.#pending.delete(tenant.tenantId);
  if(pending.projectUrl!==tenant.projectUrl||
     pending.nonce!==challenge?.nonce||pending.expiresAt!==challenge?.expiresAt)return false;
  return verifyChallenge(tenant,challenge,signature,this.#now());
 }
 pendingCount(){return this.#pending.size;}
}
