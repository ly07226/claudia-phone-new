import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {ignoreAutomationBuild,automationBuildExit} from '../scripts/automation-build-policy.mjs';
const matrix=[
 ['local',{},false],['main production',{NETLIFY:'true',CONTEXT:'production',BRANCH:'main'},false],
 ['normal preview',{NETLIFY:'true',CONTEXT:'deploy-preview',BRANCH:'feature/other',REVIEW_ID:'110'},false],
 ['source branch',{NETLIFY:'true',BRANCH:'feature/dual-automation-api'},true],
 ['head source',{NETLIFY:'true',CONTEXT:'deploy-preview',BRANCH:'main',HEAD:'feature/dual-automation-api'},true],
 ['git ref',{NETLIFY:'true',BRANCH:'refs/heads/feature/dual-automation-api'},true],
 ['review fallback',{NETLIFY:'true',CONTEXT:'deploy-preview',BRANCH:'main',REVIEW_ID:'109'},true],
 ['main stale head',{NETLIFY:'true',CONTEXT:'production',BRANCH:'main',HEAD:'feature/dual-automation-api',REVIEW_ID:'109'},false]
];
for(const [name,env,blocked]of matrix)test('deployment policy: '+name,()=>{assert.equal(ignoreAutomationBuild(env),blocked);assert.equal(automationBuildExit('ignore',env),blocked?0:1);assert.equal(automationBuildExit('prebuild',env),blocked?2:0)});
test('local feature build still works without Netlify',()=>assert.equal(automationBuildExit('prebuild',{BRANCH:'feature/dual-automation-api'}),0));
test('CLI guard fails closed before build without printing environment',()=>{const env={...process.env,NETLIFY:'true',CONTEXT:'deploy-preview',BRANCH:'main',HEAD:'feature/dual-automation-api',PRIVATE_FIXTURE:'synthetic-secret-must-not-log'};const r=spawnSync(process.execPath,['scripts/automation-build-policy.mjs','prebuild'],{env,encoding:'utf8'});assert.equal(r.status,2);assert.match(r.stderr,/Stopped before TypeScript\/Vite/);assert.doesNotMatch(r.stderr+r.stdout,/synthetic-secret-must-not-log/)});
for(const [name,env,expected]of [
 ['Vercel feature',{VERCEL:'1',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/dual-automation-api'},2],
 ['Vercel PR fallback',{VERCEL:'1',VERCEL_ENV:'preview',VERCEL_GIT_PULL_REQUEST_ID:'109'},2],
 ['Vercel unrelated',{VERCEL:'1',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/other',VERCEL_GIT_PULL_REQUEST_ID:'110'},0],
 ['Vercel main',{VERCEL:'1',VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',VERCEL_GIT_PULL_REQUEST_ID:'109'},0]
])test(name,()=>assert.equal(automationBuildExit('prebuild',env),expected));
