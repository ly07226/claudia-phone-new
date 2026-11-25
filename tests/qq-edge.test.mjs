import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import * as context from '../supabase/functions/_shared/qqContext.mjs';import * as reply from '../supabase/functions/_shared/qqReply.mjs';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',binding='10000000-0000-4000-8000-000000000001';
function edge(name,db,fetchImpl=fetch){
 let handler;const env={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',WECHAT_ILINK_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),QQ_QR_ACCESS_TOKEN:'synthetic-bridge-credential-0123456789'};
 const code=ts.transpileModule(fs.readFileSync(`supabase/functions/${name}/index.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const require=path=>path.startsWith('npm:')?{createClient:()=>db}:path.includes('qqReply')?reply:context;
 new Function('require','exports','Deno','fetch',code)(require,{}, {env:{get:k=>env[k]},serve:fn=>{handler=fn}},fetchImpl);
 return {handler,env};
}
function fixture(){
 const tables={claudia_qq_bindings:[{id:binding,user_id:owner,character_id:'role',conversation_id:'daily',status:'connected'}],claudia_qq_context_snapshots:[],claudia_qq_ai_profiles:[],claudia_qq_messages:[]};let authOwner=owner;const calls=[];
 const db={auth:{getUser:async()=>({data:{user:{id:authOwner}},error:null})},from(table){
  const filters=[];let single=false;const query={select(){return query},eq(k,v){filters.push(r=>r[k]===v);return query},order(){return query},limit(){return query},maybeSingle(){single=true;return query},then(ok,err){return Promise.resolve({data:single?(tables[table].filter(r=>filters.every(f=>f(r)))[0]??null):tables[table].filter(r=>filters.every(f=>f(r))),error:null}).then(ok,err)}};return query;
 },async rpc(name,args){calls.push({name,args});
  if(name==='claudia_qq_commit_context'){
   const i=tables.claudia_qq_context_snapshots.findIndex(r=>r.binding_id===args.p_binding_id);const old=tables.claudia_qq_context_snapshots[i];if((old?.revision??null)!==args.p_expected_revision)return {data:false,error:null};
   const row={binding_id:binding,user_id:args.p_user_id,revision:args.p_revision,context_messages:args.p_messages,context_data:args.p_data};if(i<0)tables.claudia_qq_context_snapshots.push(row);else tables.claudia_qq_context_snapshots[i]=row;return {data:true,error:null};
  }
  if(name==='claudia_qq_claim_inbound')return {data:tables.claudia_qq_messages.slice(0,1),error:null};
  if(name==='claudia_qq_history_context')return {data:{recent:[{id:'cloud-new',direction:'inbound',body:'QQ刚发生的经历',status:'generated',received_at:'2026-11-24T07:00:00Z'}],recalled:[{id:'cloud-old',direction:'inbound',body:'去年约好看画展',status:'generated',received_at:'2025-11-24T07:00:00Z'}]},error:null};
  if(name==='claudia_qq_finish_generation')return {data:true,error:null};
  if(name==='claudia_qq_sync_state')return {data:{scanned:tables.claudia_qq_messages,pending:[]},error:null};
  if(name==='claudia_qq_sync_page')return {data:tables.claudia_qq_messages,error:null};
  throw Error('unexpected_rpc');
 }};
 const request=(payload,who=owner)=>{authOwner=who;return new Request('https://edge.test',{method:'POST',headers:{Origin:'https://claudia-phone-new.vercel.app',Authorization:'Bearer synthetic-owner','Content-Type':'application/json'},body:JSON.stringify(payload)});};
 return {tables,db,calls,request};
}
test('real config Edge handler: owner checks, CAS, incremental memory changes and lost-ACK replay',async()=>{
 const f=fixture(),{handler}=edge('claudia-qq-ai-config',f.db);
 const data={conversationId:'daily',characterId:'role',timelineId:'root',epoch:0,includedQqIds:[]};
 const payload={action:'sync-context-v2',bindingId:binding,requestId:'30000000-0000-4000-8000-000000000001',expectedRevision:null,replaceDocuments:true,patch:{keep:0,append:[{role:'system',content:'人设'},{role:'user',content:'小手机的新事实'}]},documents:{remove:[],upsert:[{id:'m',kind:'long',content:'婚姻偏好：不想结婚'}]},metadata:data};
 assert.equal((await handler(f.request(payload,other))).status,404);
 assert.equal((await handler(f.request(payload))).status,200);assert.equal((await handler(f.request(payload))).status,200);
 assert.equal(f.calls.filter(c=>c.name==='claudia_qq_commit_context').length,1);
 assert.equal((await handler(f.request({...payload,requestId:'30000000-0000-4000-8000-000000000002'}))).status,409);
 const current=f.tables.claudia_qq_context_snapshots[0];assert.match(JSON.stringify(current),/小手机的新事实/);
 const second={...payload,requestId:'30000000-0000-4000-8000-000000000003',expectedRevision:current.revision,replaceDocuments:false,patch:{keep:2,append:[]},documents:{remove:[],upsert:[{id:'m',kind:'long',content:'婚姻偏好：现在愿意结婚'}]}};
 assert.equal((await handler(f.request(second))).status,200);assert.doesNotMatch(JSON.stringify(current.context_data),/现在愿意/);assert.match(JSON.stringify(f.tables.claudia_qq_context_snapshots[0]),/现在愿意/);
});
test('real AI Edge handler final request includes latest phone context, long memory and QQ history; no extra model calls',async()=>{
 const f=fixture();const rawKey=Buffer.alloc(32,7),iv=crypto.getRandomValues(new Uint8Array(12));const key=await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['encrypt']);const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('synthetic-model-key'));
 f.tables.claudia_qq_ai_profiles.push({binding_id:binding,user_id:owner,model:'mock',enabled:true,endpoint:'https://model.example.com/v1/chat/completions',api_key_ciphertext:Buffer.from(iv).toString('base64')+'.'+Buffer.from(cipher).toString('base64')});
 f.tables.claudia_qq_context_snapshots.push({binding_id:binding,user_id:owner,context_messages:[{role:'system',content:'角色当前人设'},{role:'user',content:'下午来月经了'}],context_data:{characterId:'role',documents:[{id:'m',kind:'long',content:'婚姻偏好：不想结婚'}],includedQqIds:[]}});
 f.tables.claudia_qq_messages.push({id:'40000000-0000-4000-8000-000000000001',binding_id:binding,user_id:owner,direction:'inbound',status:'received',body:'婚姻、身体情况和画展',received_at:'2026-11-24T08:00:00Z',lease_until:'2026-11-24T08:04:00Z'});
 const requests=[];const {handler,env}=edge('claudia-qq-ai-run',f.db,async(_url,init)=>{requests.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:'我记得。我们慢慢聊。'},finish_reason:'stop'}]});});
 const response=await handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer '+env.QQ_QR_ACCESS_TOKEN}}));assert.equal(response.status,200);assert.equal((await response.json()).generated,true);assert.equal(requests.length,1);
 const text=JSON.stringify(requests[0]);for(const fact of ['角色当前人设','下午来月经了','不想结婚','QQ刚发生的经历','去年约好看画展'])assert.ok(text.includes(fact));
 const saved=f.calls.find(c=>c.name==='claudia_qq_finish_generation');assert.equal(saved.args.p_parts.length,2);assert.equal(saved.args.p_reply_body,'我记得。我们慢慢聊。');
 assert.equal(f.calls.find(c=>c.name==='claudia_qq_history_context').args.p_user_id,owner);
 f.tables.claudia_qq_context_snapshots[0].context_data.characterId='wrong-role';f.tables.claudia_qq_messages[0].id='40000000-0000-4000-8000-000000000002';
 const rejected=await handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer '+env.QQ_QR_ACCESS_TOKEN}}));assert.equal((await rejected.json()).generated,false);assert.equal(requests.length,1);assert.equal(f.calls.at(-1).args.p_error_code,'context_binding_mismatch');
});
test('real sync Edge handler keeps owner isolation and explicit ascending protocol',async()=>{
 const f=fixture(),{handler}=edge('claudia-qq-sync',f.db);
 assert.equal((await handler(f.request({bindingId:binding,order:'asc'},other))).status,404);
 const response=await handler(f.request({bindingId:binding,order:'asc'}));assert.equal(response.status,200);assert.equal((await response.json()).order,'asc');assert.equal(f.calls[0].args.p_user_id,owner);
 const v2=await handler(f.request({bindingId:binding,order:'asc',syncVersion:2,pendingIds:[]}));assert.equal(v2.status,200);assert.equal((await v2.json()).pendingAware,true);
 assert.equal((await handler(f.request({bindingId:binding,order:'asc',syncVersion:2,pendingIds:['not-a-uuid']}))).status,400);
});
test('denied origin returns explicit 403, not a temporal-dead-zone exception',async()=>{
 const f=fixture(),{handler}=edge('claudia-qq-ai-config',f.db);const request=new Request('https://edge.test',{method:'POST',headers:{Origin:'https://untrusted.example.com',Authorization:'Bearer synthetic-owner'},body:'{}'});assert.equal((await handler(request)).status,403);assert.equal(f.calls.length,0);
});
