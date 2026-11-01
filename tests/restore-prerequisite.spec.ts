import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Restore requires a controlling worker. Exercise its real install handler with
// the observed host MIME type, without using any user's browser or database.
async function installWorker(manifestType:string){
  const handlers:Record<string,Function>={};
  let savedHome=false;
  runInNewContext(readFileSync('public/sw.js','utf8'),{
    URL,Response,
    self:{location:{origin:'https://phone.test'},skipWaiting:()=>{},addEventListener:(name:string,fn:Function)=>{handlers[name]=fn;}},
    caches:{open:async()=>({put:async(path:string)=>{if(path==='/')savedHome=true;}})},
    fetch:async(path:string)=>new Response(path==='/'?'<html></html>':'{}',{headers:{'content-type':path==='/'?'text/html':path==='/icon.svg'?'image/svg+xml':manifestType}}),
  });
  let pending!:Promise<void>;
  handlers.install({waitUntil:(p:Promise<void>)=>{pending=p;}});
  await pending;
  return savedHome;
}

test('Netlify原manifest MIME会拒绝安装恢复所需Worker，不能当作恢复成功',async()=>{
  await expect(installWorker('application/octet-stream')).rejects.toThrow('Invalid app resource');
});

test('发布的manifest响应头配置允许恢复所需Worker完成安装',async()=>{
  const headers=readFileSync('public/_headers','utf8');
  expect(headers).toMatch(/^\/manifest\.webmanifest\s*\n\s+Content-Type:/);
  const type=headers.match(/Content-Type:\s*([^\n]+)/)?.[1];
  expect(type).toBe('application/manifest+json; charset=utf-8');
  expect(await installWorker(type!)).toBe(true);
});
