import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('恢复Worker租约拒绝旧协议、并发客户端及过期续约，租约期间新导航被阻止',async()=>{
  const handlers:Record<string,Function>={};let now=1000,clients=[{id:'one'}];
  runInNewContext(readFileSync('public/sw.js','utf8'),{URL,Response,Date:{now:()=>now},self:{location:{origin:'https://phone.test'},addEventListener:(name:string,fn:Function)=>handlers[name]=fn,clients:{matchAll:async()=>clients}},caches:{},fetch:()=>{throw Error('unexpected fetch');}});
  async function message(action:string,owner='one',token='token'){let answer:any,work:Promise<unknown>|undefined;handlers.message({data:{type:'claudia-restore-lease-v1',action,token},source:{id:owner},ports:[{postMessage:(m:any)=>answer=m}],waitUntil:(p:Promise<unknown>)=>work=p});await work;return answer;}
  expect((await message('renew')).ok).toBe(false);
  expect((await message('acquire')).ok).toBe(true);
  let response:Promise<Response>|undefined;handlers.fetch({request:{mode:'navigate',method:'GET',url:'https://phone.test/'},respondWith:(p:Promise<Response>)=>response=p});expect((await response!).status).toBe(503);
  expect((await message('acquire','two','other')).ok).toBe(false);
  expect((await message('release','two','other')).ok).toBe(true);expect((await message('renew')).ok).toBe(true);
  clients=[{id:'one'},{id:'two'}];expect((await message('renew')).ok).toBe(false);
  clients=[{id:'one'}];expect((await message('acquire')).ok).toBe(true);now+=30001;expect((await message('renew')).ok).toBe(false);
  expect((await message('acquire')).ok).toBe(true);expect((await message('release')).ok).toBe(true);expect((await message('renew')).ok).toBe(false);
});
