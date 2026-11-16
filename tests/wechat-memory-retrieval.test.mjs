import test from 'node:test';
import assert from 'node:assert/strict';
import {tokens,selectSourceMemories,formatSourceMemories} from '../workers/wechat-memory-retrieval.mjs';
const row=(id,body,at='2026-11-16T10:00:00Z',direction='inbound',status='received')=>
 ({id,body,received_at:at,direction,status});
test('Chinese bigrams and English tokens are searchable',()=>{
 assert.ok(tokens('今天去滑雪了').has('滑雪'));
 assert.ok(tokens('We bought Tickets').has('tickets'));
});
test('older relevant messages are retrieved with original sources',()=>{
 const results=selectSourceMemories([
  row('a','上次滑雪的时候我摔倒了'),
  row('b','今天吃的是面条'),
  row('c','我们计划周末滑雪','2026-11-16T11:00:00Z')
 ],'还记得滑雪吗');
 assert.deepEqual(results.map(r=>r.id),['a','c']);
 assert.match(formatSourceMemories(results),/来源 a/);
 assert.match(formatSourceMemories(results),/上次滑雪/);
});
test('never recall failed outgoing messages',()=>{
 const results=selectSourceMemories([
  row('bad','滑雪成功','2026-11-16T10:00:00Z','outbound','failed'),
  row('good','滑雪完成','2026-11-16T10:01:00Z','outbound','sent')
 ],'滑雪');
 assert.deepEqual(results.map(r=>r.id),['good']);
});
test('limits bound model context and preserve untrusted source text',()=>{
 const results=selectSourceMemories(
  Array.from({length:40},(_,i)=>row(String(i),'滑雪'+('啊'.repeat(600)))),
  '滑雪',{maxItems:4,maxChars:1800});
 assert.ok(results.length<=4);
 assert.ok(results.reduce((n,r)=>n+r.body.length,0)<=1800);
});
