/** Run only against the dedicated local container: QQ_AUDIT_PG=claudia-qq-audit-postgres node --test workers/qq-tests/database.test.mjs */
import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import fs from 'node:fs';
const container=process.env.QQ_AUDIT_PG;if(!container||!/^claudia-qq-audit-[a-z0-9-]+$/.test(container))throw Error('dedicated_test_container_required');
const database='qq_audit_'+Date.now();
execFileSync('docker',['exec',container,'createdb','-U','postgres',database]);
const sql=(query)=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1'],{input:"set request.jwt.claim.role='service_role';\n"+query,encoding:'utf8'}).trim().split('\n').filter(x=>x!=='SET').join('\n');
// Separate, fresh synthetic database per run; no existing schema/data is reset.
sql(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;`);
sql(`create schema auth;create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
create table auth.users(id uuid primary key);insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');`);
sql(fs.readFileSync('supabase/migrations/20261119000000_claudia_qq_cloud.sql','utf8'));
sql(fs.readFileSync('supabase/migrations/20261124000000_qq_context_continuity.sql','utf8'));
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',binding='10000000-0000-4000-8000-000000000001';
const q=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
const messages=[{role:'system',content:'合成角色'},{role:'user',content:'合成聊天'}];
const data={conversationId:'c',characterId:'a',timelineId:'t',epoch:0,documents:[],includedQqIds:[]};
sql(`insert into public.claudia_qq_bindings(id,user_id,character_id,conversation_id,status) values('${binding}','${owner}','a','c','connected') on conflict(id) do nothing;`);
test('actual DB CAS accepts first snapshot; stale writes preserve winner and all original data',()=>{
 const first='30000000-0000-4000-8000-000000000001';
 assert.equal(sql(`select public.claudia_qq_commit_context('${binding}','${owner}',null,'${first}',${q(messages)},${q(data)});`),'t');
 assert.equal(sql(`select public.claudia_qq_commit_context('${binding}','${owner}',null,'30000000-0000-4000-8000-000000000002',${q(messages)},${q(data)});`),'f');
 assert.equal(sql(`select revision from public.claudia_qq_context_snapshots where binding_id='${binding}';`),first);
});
test('service-role still checks explicit tenant; anon/authenticated cannot execute',()=>{
 assert.throws(()=>sql(`select public.claudia_qq_commit_context('${binding}','${other}',null,gen_random_uuid(),${q(messages)},${q(data)});`),/binding_not_owned/);
 assert.throws(()=>sql(`select public.claudia_qq_history_context('${other}','${binding}',now(),gen_random_uuid(),array['合成']);`),/binding_not_owned/);
 assert.equal(sql(`select has_function_privilege('authenticated','public.claudia_qq_commit_context(uuid,uuid,uuid,uuid,jsonb,jsonb)','execute');`),'f');
 assert.equal(sql(`select has_function_privilege('anon','public.claudia_qq_sync_page(uuid,uuid,jsonb)','execute');`),'f');
});
test('ordered readback handles identical timestamps, split bubbles and legacy cursors',()=>{
 sql(`insert into public.claudia_qq_messages(id,user_id,binding_id,external_message_id,direction,body,status,received_at,part_index) values
 ('40000000-0000-4000-8000-000000000003','${owner}','${binding}','part1','outbound','第一气泡','sent','2026-01-01T00:00:00Z',1),
 ('40000000-0000-4000-8000-000000000001','${owner}','${binding}','part2','outbound','第二气泡','sent','2026-01-01T00:00:00Z',2);`);
 const rows=JSON.parse(sql(`select public.claudia_qq_sync_page('${owner}','${binding}',null);`));assert.deepEqual(rows.map(r=>r.body),['第一气泡','第二气泡']);
 const after={at:rows[0].received_at,id:rows[0].id};const next=JSON.parse(sql(`select public.claudia_qq_sync_page('${owner}','${binding}',${q(after)});`));assert.equal(next[0].body,'第二气泡');
});
test('closed-app recall queries old sources beyond 30 recent rows and excludes other owners/failed replies',()=>{
 sql(`insert into public.claudia_qq_messages(user_id,binding_id,external_message_id,direction,body,status,received_at)
 select '${owner}','${binding}','bulk-'||i,'inbound',case when i=1 then '去年承诺一起去看画展' else '合成日常'||i end,'generated','2026-02-01T00:00:00Z'::timestamptz+i*interval '1 second' from generate_series(1,30000) i;
 insert into public.claudia_qq_messages(user_id,binding_id,external_message_id,direction,body,status,received_at) values('${owner}','${binding}','failed','outbound','画展没有发出','failed','2026-02-01T01:00:00Z');`);
 const started=performance.now();const result=JSON.parse(sql(`select public.claudia_qq_history_context('${owner}','${binding}','2026-12-01T00:00:00Z',gen_random_uuid(),array['画展']);`));
 console.info('QQ 30000-row scoped recall SQL+docker ms',Math.round(performance.now()-started));assert.equal(result.recent.length,30);assert.ok(result.recalled.some(r=>r.body==='去年承诺一起去看画展'));assert.ok(result.recalled.every(r=>r.status!=='failed'));
});
test('missing restored cursor fails explicitly without skipping records',()=>{assert.throws(()=>sql(`select public.claudia_qq_sync_page('${owner}','${binding}','{"at":"2026-01-01T00:00:00Z","id":"40000000-0000-4000-8000-000000000099"}');`),/sync_cursor_missing/);});

test('claim serializes paid generation and never automatically recharges an expired inbound',()=>{
 sql(`insert into public.claudia_qq_ai_profiles(binding_id,user_id,system_prompt,model,endpoint,api_key_ciphertext,enabled) values('${binding}','${owner}','synthetic','mock','https://model.example.com/v1/chat/completions','synthetic',true);`);
 const first=JSON.parse(sql(`select coalesce(jsonb_agg(m),'[]') from public.claudia_qq_claim_inbound('${binding}',240) m;`));assert.equal(first.length,0); // existing rows already generated
 sql(`insert into public.claudia_qq_messages(user_id,binding_id,external_message_id,direction,body,status) values('${owner}','${binding}','claim-first','inbound','first','received'),('${owner}','${binding}','claim-next','inbound','next','received');`);
 const claimed=JSON.parse(sql(`select jsonb_agg(m) from public.claudia_qq_claim_inbound('${binding}',240) m;`));assert.equal(claimed.length,1);
 assert.equal(sql(`select count(*) from public.claudia_qq_claim_inbound('${binding}',240);`),'0');
 sql(`update public.claudia_qq_messages set lease_until=now()-interval '1 minute' where id='${claimed[0].id}';`);
 const next=JSON.parse(sql(`select jsonb_agg(m) from public.claudia_qq_claim_inbound('${binding}',240) m;`));assert.equal(next.length,1);assert.notEqual(next[0].id,claimed[0].id);
 assert.equal(sql(`select last_error from public.claudia_qq_messages where id='${claimed[0].id}';`),'generation_interrupted_check_before_retry');
});

test('complete replies persist atomically; partial sends remain blocked until all parts succeed',()=>{
 const active=JSON.parse(sql(`select row_to_json(m) from public.claudia_qq_messages m where status='processing' limit 1;`));
 const accepted=sql(`select public.claudia_qq_finish_generation('${active.id}','${active.lease_until}','第一句。第二句重要约定。',null,'["第一句。","第二句重要约定。"]'::jsonb);`);assert.equal(accepted,'t');
 assert.equal(sql(`select reply_body from public.claudia_qq_messages where id='${active.id}';`),'第一句。第二句重要约定。');
 sql(`update public.claudia_qq_messages set status='sent' where in_reply_to='${active.id}' and part_index=1;`);
 let rows=JSON.parse(sql(`select public.claudia_qq_sync_page('${owner}','${binding}',${q({at:active.received_at,id:active.id})});`));
 assert.equal(rows.find(r=>r.in_reply_to===active.id).status,'generated'); // Not safe to import a half-delivered original reply.
 sql(`update public.claudia_qq_messages set status='sent' where in_reply_to='${active.id}';`);
 rows=JSON.parse(sql(`select public.claudia_qq_sync_page('${owner}','${binding}',${q({at:active.received_at,id:active.id})});`));
 const reply=rows.find(r=>r.in_reply_to===active.id);assert.equal(reply.reply_ready,true);assert.equal(reply.reply_body,'第一句。第二句重要约定。');assert.equal(reply.reply_part_ids.length,2);
 assert.equal(sql(`select public.claudia_qq_finish_generation('${active.id}','${active.lease_until}','重复回复',null,'["重复回复"]');`),'f');
});

test('pending-aware state returns acknowledged later records and independently rechecks earlier undelivered IDs',()=>{
 const early=JSON.parse(sql(`select row_to_json(m) from public.claudia_qq_messages m where direction='outbound' and part_index=1 and reply_body is null order by received_at limit 1;`));
 // Old legacy part from January: changes to its status keep received_at unchanged.
 sql(`update public.claudia_qq_messages set status='generated' where id='${early.id}';`);
 const last=JSON.parse(sql(`select row_to_json(m) from public.claudia_qq_messages m order by received_at desc,coalesce(part_index,0) desc,id desc limit 1;`));
 let state=JSON.parse(sql(`select public.claudia_qq_sync_state('${owner}','${binding}',${q({at:last.received_at,id:last.id})},array['${early.id}']::uuid[]);`));
 assert.equal(state.scanned.length,0);assert.equal(state.pending[0].status,'generated');
 sql(`update public.claudia_qq_messages set status='sent' where id='${early.id}';`);
 state=JSON.parse(sql(`select public.claudia_qq_sync_state('${owner}','${binding}',${q({at:last.received_at,id:last.id})},array['${early.id}']::uuid[]);`));
 assert.equal(state.scanned.length,0);assert.equal(state.pending[0].status,'sent');
 assert.equal(sql(`select has_table_privilege('anon','public.claudia_qq_sync_records','select');`),'f');
});
