/** Preserve a reproducible baseline defect without running paid APIs or modifying main. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';import ts from 'typescript';
test('main c582573: local changes never upload when QQ readback adds zero rows',async()=>{
 const source=fs.readFileSync('tests/fixtures/qq-closed-continuity-c582573.txt','utf8');
 assert.equal(createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex'),'8876d56ba98b7b9b41d4deb726c1a7bb81a9353e');
 let uploads=0,builds=0;const storage=new Map([['claudia-qq-closed-continuity:b','yes'],['claudia-qq-stable-sync-id','stable']]);
 const c={id:'c',characterId:'a',mode:'daily',activeTimelineId:'t'};
 const modules={store:{db:{conversations:{where:()=>({equals:()=>({toArray:async()=>[c]})}),get:async()=>c}}},qqQrLogin:{listQqCloudBindings:async()=>[{id:'b',character_id:'a',conversation_id:'c',status:'connected',stable_sync_id:'stable'}],newestQqBinding:rows=>rows[0]},qqDailySync:{syncQqDailyConversation:async()=>0},chatContext:{buildContext:async()=>{builds++;return [{role:'system',content:'最新本地记忆'}]}},qqAiAuthorization:{getQqAiStatus:async()=>({enabled:true}),syncQqContext:async()=>{uploads++}},wechatCloudConfig:{readWechatCloudConfig:()=>({url:'https://synthetic.supabase.co'})}};
 const exported={};const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','exports','localStorage','document','navigator','window','CustomEvent',code)(path=>modules[path.replace('./','')],exported,{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},{visibilityState:'visible'},{onLine:true},{dispatchEvent:()=>{}},class{});
 await exported.reconcileQqAfterReopen();assert.equal(builds,0);assert.equal(uploads,0);
});
