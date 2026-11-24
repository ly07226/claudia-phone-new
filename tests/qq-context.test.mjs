import test from 'node:test';
import assert from 'node:assert/strict';
import {contextPatch,applyContextPatch,documentPatch,applyDocumentPatch,qqRequestContext,validContextData} from '../supabase/functions/_shared/qqContext.mjs';
const base=[{role:'system',content:'角色人设'},{role:'user',content:'不要删除未回答的问题'}];
const data={documents:[],includedQqIds:[],conversationId:'daily-a',characterId:'a',timelineId:'root',epoch:0};
test('incremental message patches retain unchanged prefix; edits/rewinds remove suffix',()=>{
 for(const next of [base,[base[0]], [...base,{role:'assistant',content:'新回答'}],[base[0],{role:'user',content:'修改后的事实'}]])assert.deepEqual(applyContextPatch(base,contextPatch(base,next)),next);
 assert.equal(contextPatch(base,[...base,{role:'assistant',content:'新回答'}]).keep,2);
 assert.throws(()=>applyContextPatch(base,{keep:8,append:[]}));
});
test('memory updates, soft deletion and explicit snapshot replacement remove old facts',()=>{
 const old=[{id:'a',kind:'long',content:'旧偏好'},{id:'b',kind:'core',content:'仍然保留'}];
 const next=[{id:'b',kind:'core',content:'仍然保留'},{id:'c',kind:'long',content:'新偏好'}];
 assert.deepEqual(applyDocumentPatch(old,documentPatch(old,next)),next);
});
test('QQ final request sees local new facts, updated long memories and untouched last user input',()=>{
 const result=qqRequestContext(base,{...data,documents:[{id:'fact',kind:'long',content:'不想结婚，婚姻不在计划内'}]},[],[],'还记得我对婚姻的态度吗');
 assert.ok(JSON.stringify(result).includes('不想结婚'));assert.ok(JSON.stringify(result).includes('不要删除未回答的问题'));assert.equal(result.at(-1).content,'还记得我对婚姻的态度吗');
});
test('closed PWA: older QQ events recalled without summary/model calls, failed sends excluded',()=>{
 const row={id:'old',body:'上周答应一起看展',direction:'inbound',status:'generated',received_at:'2026-11-10T08:00:00Z'};
 const result=qqRequestContext(base,data,[],[row,{...row,id:'failed',direction:'outbound',status:'failed',body:'未发送'}],'看展');
 assert.match(JSON.stringify(result),/上周答应一起看展/);assert.doesNotMatch(JSON.stringify(result),/未发送/);
});
test('backfilled QQ fragments are not injected a second time',()=>{
 const row={id:'a',body:'已经回填',direction:'outbound',status:'sent',received_at:'2026-11-10T08:00:00Z'};
 const result=qqRequestContext([...base,{role:'assistant',content:row.body}],{...data,includedQqIds:['a']},[row],[row],'新问题');
 assert.equal(result.filter(m=>m.content===row.body).length,1);
});
test('bounded request: huge source rows cannot inflate memory/reference budget',()=>{
 const rows=Array.from({length:80},(_,i)=>({id:String(i),body:'婚姻'.repeat(3000),direction:'inbound',status:'received',received_at:'2026-11-10T08:00:00Z'}));
 const result=qqRequestContext(base,data,rows,rows,'婚姻');assert.ok(JSON.stringify(result).length<32000);
 assert.equal(validContextData({...data,documents:[{id:'a',kind:'long',content:'x'},{id:'a',kind:'long',content:'x'}]}),false);
});
test('cloud regex planner reuses canonical worker and only activates matching entries',async()=>{
 const {prepareQqRequestContext}=await import('../supabase/functions/_shared/qqContext.mjs');
 const program={book:{id:'b',enabled:true,scanDepth:30,charBudget:4000},entry:{id:'e',lorebookId:'b',enabled:true,constant:false,primaryKeys:['/marri(age|ed)/i'],secondaryKeys:[],selective:false,selectiveLogic:0,priority:1,insertionPosition:'after-profile',scanDepth:null,caseSensitive:false,regex:true,compatibilityIssues:[],content:'REGEX_LORE',createdAt:1}};
 const withLore={...data,documents:[{id:'lore:e',kind:'lore',content:JSON.stringify(program)}]};
 assert.match(JSON.stringify(await prepareQqRequestContext(base,withLore,[],[],'marriage')),/REGEX_LORE/);
 assert.doesNotMatch(JSON.stringify(await prepareQqRequestContext(base,withLore,[],[],'dinner')),/REGEX_LORE/);
});
test('recent QQ history has priority over stale snapshot turns within a shared 24000-char budget',()=>{
 const snapshot=[{role:'system',content:'固定角色'},...Array.from({length:25},(_,i)=>({role:i%2?'assistant':'user',content:'旧快照'.repeat(280)}))];
 const recent=[{id:'new',direction:'inbound',body:'最新QQ事实',status:'received',received_at:'2026-11-24T07:00:00Z'}];
 const result=qqRequestContext(snapshot,data,recent,[],'当前问题'.repeat(1500));assert.match(JSON.stringify(result),/最新QQ事实/);
 assert.ok(result.filter(m=>m.role!=='system').reduce((n,m)=>n+m.content.length,0)<=24000);assert.ok(result.filter(m=>m.role!=='system').length<=30);
});
test('complete QQ task coverage excludes already-snapshotted cloud fragments from both history and recall',()=>{
 const snapshot=[{role:'system',content:'角色'},{role:'assistant',content:'第一句。第二句。'}];const row={id:'part',body:'第二句。',direction:'outbound',status:'sent',received_at:'2026-01-01T00:00:00Z',in_reply_to:'task'};
 const result=qqRequestContext(snapshot,{...data,includedQqReplyIds:['task']},[row],[row],'接着聊');assert.equal(result.filter(m=>m.content==='第二句。').length,0);
});
test('readback cursors preserve PostgreSQL microseconds and part order instead of random UUID order',async()=>{
 const {compareQqCursor}=await import('../supabase/functions/_shared/qqContext.mjs');
 assert.ok(compareQqCursor({at:'2026-01-01T00:00:00.123456Z',id:'a'},{at:'2026-01-01T00:00:00.123455Z',id:'z'})>0);
 assert.ok(compareQqCursor({at:'2026-01-01T00:00:00Z',part:2,id:'a'},{at:'2026-01-01T00:00:00+00:00',part:1,id:'z'})>0);
});
test('portable worldbook runtime cannot silently drift from the app implementation',async()=>{
 const {execFileSync}=await import('node:child_process');execFileSync(process.execPath,['scripts/build-qq-lore.mjs','--check']);
});
test('QQ retrieval reuses existing topic aliases for menstrual and marriage paraphrases, not a second taxonomy',async()=>{
 const {recallTerms}=await import('../supabase/functions/_shared/qqContext.mjs');assert.ok(recallTerms('今天生理期难受').includes('月经'));assert.ok(recallTerms('聊聊婚姻').includes('结婚'));
 const result=qqRequestContext(base,{...data,documents:[{id:'p',kind:'long',content:'我不想结婚。',updatedAt:1700000000000}]},[],[],'对婚姻怎么看');assert.match(JSON.stringify(result),/我不想结婚/);
});
test('escaped reference data cannot evade the system budget',()=>{
 const prefix='角色设定'.repeat(5700);const result=qqRequestContext([{role:'system',content:prefix}],{...data,documents:[{id:'x',kind:'core',content:'<'.repeat(500)}]},[],[],'问题');
 assert.ok(result.filter(m=>m.role==='system').reduce((n,m)=>n+m.content.length,0)<=24000);
});
