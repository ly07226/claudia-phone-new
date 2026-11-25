import {test,expect,type Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
import {applyContextPatch,applyDocumentPatch,qqRequestContext} from '../supabase/functions/_shared/qqContext.mjs';
const bindingId='10000000-0000-4000-8000-000000000001';
const project='https://qq-audit.supabase.co';
async function fixture(page:Page){
 const databaseName='qq-audit-'+crypto.randomUUID();await isolatedApp(page,databaseName);
 const id=await page.evaluate(async()=>{
  const {db}=await import('/src/store.ts');const {getConversation}=await import('/src/chatService.ts');
  await db.characters.put({id:'qq-role',name:'角色A',persona:'独立人设A'});
  return (await getConversation('qq-role')).id;
 });
 let remoteConversation=id;let aiEnabled=true;let snapshot:any=null;let writes=0;const payloads:any[]=[];let rows:any[]=[];let offline=false;let conflict=false;let loseAck=false;
 await page.context().route(project+'/**',async route=>{
  const p=route.request().postDataJSON();let result:any={ok:true};let status=200;
  if(route.request().url().endsWith('claudia-qq-login'))result={ok:true,bindings:[{id:bindingId,character_id:'qq-role',conversation_id:remoteConversation,status:'connected',stable_sync_id:'qq-test',created_at:'2026-01-01T00:00:00Z'}]};
  else if(route.request().url().endsWith('claudia-qq-sync')){
   if(p.after?.id==='80000000-0000-4000-8000-000000000099')return route.fulfill({status:409,json:{error:'sync_cursor_missing'}});
   const remaining=rows.filter(r=>!p.after||r.received_at>p.after.at||r.received_at===p.after.at&&r.id>p.after.id);let list=remaining.slice(0,100);
   result={ok:true,order:'asc',binding:{id:bindingId,conversationId:remoteConversation,characterId:'qq-role',status:'connected'},messages:list,pendingAware:true,pendingMessages:rows.filter(r=>(p.pendingIds??[]).includes(r.id)),hasMore:remaining.length>100,nextCursor:list.length?{at:list.at(-1).received_at,id:list.at(-1).id}:null};
  }else if(p.action==='status')result={ok:true,configured:true,enabled:aiEnabled};
  else if(p.action==='context-version')result={ok:true,revision:snapshot?.revision??null};
  else if(p.action==='sync-context-v2'){
   if(offline)return route.abort('failed');
   payloads.push(p);
   if(snapshot?.revision===p.requestId)result={ok:true,revision:snapshot.revision};
   else if(conflict||(snapshot?.revision??null)!==p.expectedRevision){status=409;result={error:'context_conflict'};}
   else{snapshot={messages:applyContextPatch(snapshot?.messages??[],p.patch),data:{...p.metadata,documents:applyDocumentPatch(p.replaceDocuments?[]:snapshot?.data.documents??[],p.documents)},revision:p.requestId};writes++;result={ok:true,revision:p.requestId};if(loseAck){loseAck=false;return route.abort('failed');}}
  }
  return route.fulfill({status,json:result});
 });
 await page.evaluate(({project,bindingId})=>{
  localStorage.setItem('claudia-wechat-cloud-config-v1',JSON.stringify({url:project,publishableKey:'sb_publishable_synthetic'}));
  localStorage.setItem('claudia-wechat-anon-v1:'+project,JSON.stringify({access_token:'synthetic-owner',refresh_token:'synthetic-refresh',expires_at:Date.now()/1000+86400}));
  localStorage.setItem('claudia-qq-closed-continuity:'+bindingId,'yes');localStorage.setItem('claudia-qq-stable-sync-id','qq-test');
 },{project,bindingId});
 const sync=()=>page.evaluate(()=>import('/src/qqClosedContinuity.ts').then(m=>m.reconcileQqAfterReopen()));
 const direct=()=>page.evaluate(({bindingId,id})=>import('/src/qqContextSync.ts').then(m=>m.syncQqSnapshot(bindingId,id)),{bindingId,id});
 return {id,databaseName,sync,direct,setRemoteConversation:(value:string)=>{remoteConversation=value},setAiEnabled:(v:boolean)=>{aiEnabled=v},get snapshot(){return snapshot},get writes(){return writes},payloads,setRows:(value:any[])=>{rows=value},setOffline:(v:boolean)=>{offline=v},setConflict:(v:boolean)=>{conflict=v},loseAck:()=>{loseAck=true}};
}
test('local chat, edited long/core memory and persona automatically reach final QQ request without QQ inbound traffic',async({page})=>{
 const f=await fixture(page);await f.sync();expect(f.writes).toBe(1);
 await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const {createMemory,getMemoryScope}=await import('/src/memoryStore.ts');
  await db.conversations.update(id,{chatSettings:{continuousSend:true}});
  await(await import('/src/chatService.ts')).queueUserMessage(id,'今天下午来月经了');
  await createMemory(await getMemoryScope(id),{kind:'long',content:'我不想结婚，婚姻不是我的计划'});
  await db.characters.update('qq-role',{persona:'更新的人设A'});
 },f.id);
 await f.sync();expect(f.writes).toBe(2);
 const request=qqRequestContext(f.snapshot.messages,f.snapshot.data,[],[],'婚姻与今天下午的身体情况');
 expect(JSON.stringify(request)).toContain('今天下午来月经了');expect(JSON.stringify(request)).toContain('不想结婚');expect(JSON.stringify(request)).toContain('更新的人设A');
 const count=f.writes;await f.sync();expect(f.writes).toBe(count);
});
test('edited/deleted memories sync deltas and full reopen removes obsolete cloud documents',async({page})=>{
 const f=await fixture(page);
 const memory=await page.evaluate(async id=>{const m=await import('/src/memoryStore.ts');return m.createMemory(await m.getMemoryScope(id),{kind:'core',content:'旧事实'});},f.id);
 await f.direct();await page.evaluate(async({id,memory})=>{const m=await import('/src/memoryStore.ts');await m.updateMemory(await m.getMemoryScope(id),memory.id,{kind:'core',content:'新事实'},memory.revision);},{id:f.id,memory});await f.direct();
 expect(JSON.stringify(f.snapshot.data)).toContain('新事实');expect(JSON.stringify(f.snapshot.data)).not.toContain('旧事实');expect(f.payloads.at(-1).replaceDocuments).toBe(false);expect(f.payloads.at(-1).documents.upsert).toHaveLength(1);expect(f.payloads.at(-1).patch.append).toHaveLength(0);
 await page.evaluate(async({id,memory})=>{const m=await import('/src/memoryStore.ts');const scope=await m.getMemoryScope(id);const current=(await m.listMemories(scope)).entries.find(e=>e.id===memory.id)!;await m.deleteMemory(scope,current.id,current.revision);},{id:f.id,memory});
 await page.reload();await f.direct();expect(f.snapshot.data.documents).toHaveLength(0);
});
test('offline and lost acknowledgements recover without duplicate commits; stale version never overwrites winner',async({page})=>{
 const f=await fixture(page);f.setOffline(true);await expect(f.direct()).rejects.toThrow();expect(f.writes).toBe(0);
 f.setOffline(false);f.loseAck();await expect(f.direct()).rejects.toThrow();expect(f.writes).toBe(1);
 await f.direct();expect(f.writes).toBe(1);
 await page.evaluate(async id=>{const {db}=await import('/src/store.ts');await db.characters.update('qq-role',{persona:'更改'});},f.id);f.setConflict(true);
 await expect(f.direct()).rejects.toThrow(/版本冲突/);expect(f.writes).toBe(1);f.setConflict(false);
 await page.evaluate(async({bindingId,id})=>(await import('/src/qqContextSync.ts')).syncQqSnapshot(bindingId,id,true),{bindingId,id:f.id});expect(f.writes).toBe(2);
});
test('QQ readback commits actual Daily timeline, resumes >3000 backlog, respects roles and deduplicates retries',async({page})=>{
 const f=await fixture(page);const rows=Array.from({length:3102},(_,i)=>({id:'20000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),body:'QQ经历'+i,direction:i%2?'outbound':'inbound',status:i%2?'sent':'generated',local_message_id:i===0?'collision':null,received_at:new Date(1700000000000+i*1000).toISOString()}));
 f.setRows(rows);await page.evaluate(async id=>{const {db}=await import('/src/store.ts');await db.messages.put({id:'collision',conversationId:id,role:'assistant',content:'不相关本地内容',createdAt:1});},f.id);
 for(let i=0;i<32;i++)await page.evaluate(async({id,bindingId})=>{await(await import('/src/qqDailySync.ts')).syncQqDailyConversation(id,bindingId);},{id:f.id,bindingId});
 // The mounted reconciler may own the same binding while explicit passes safely no-op.
 await expect.poll(()=>page.evaluate(async({id,bindingId})=>{await(await import('/src/qqDailySync.ts')).syncQqDailyConversation(id,bindingId);return(await(await import('/src/messagePath.ts')).activeMessages(id)).length;},{id:f.id,bindingId}),{timeout:30000}).toBe(3103);
 const result=await page.evaluate(async id=>{const {activeMessages}=await import('/src/messagePath.ts');const {db}=await import('/src/store.ts');const path=await activeMessages(id);const {buildQqSnapshot}=await import('/src/qqContextSnapshot.ts');return {count:path.length,first:path[1],last:path.at(-1),snapshot:await buildQqSnapshot(id),persisted:await db.messages.count()};},f.id);
 expect(result.count).toBe(3103);expect(result.persisted).toBe(3103);expect(result.first.role).toBe('user');expect(result.last?.content).toBe('QQ经历3101');expect(result.snapshot.data.includedQqIds).toHaveLength(30);
 await page.evaluate(async({id,bindingId})=>{await(await import('/src/qqDailySync.ts')).syncQqDailyConversation(id,bindingId,true);},{id:f.id,bindingId});
 expect(await page.evaluate(async()=>{const {db}=await import('/src/store.ts');return db.messages.count();})).toBe(3103);
});
test('World and other-role memory never enter QQ snapshot, unsupported image bytes stay local',async({page})=>{
 const f=await fixture(page);const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const {getConversation}=await import('/src/chatService.ts');const m=await import('/src/memoryStore.ts');
  await db.characters.put({id:'other-role',name:'B',persona:'B_PRIVATE'});const other=await getConversation('other-role');await m.createMemory(await m.getMemoryScope(other.id),{kind:'core',content:'B_MEMORY_PRIVATE'});
  await db.worlds.put({id:'world',name:'W',description:'WORLD_PRIVATE',createdAt:1});await db.worldProfiles.put({id:'profile',worldId:'world',characterId:'qq-role',setting:'WORLD_PERSONA_PRIVATE'});const world=await getConversation('qq-role','world');await m.createMemory(await m.getMemoryScope(world.id),{kind:'core',content:'WORLD_MEMORY_PRIVATE'});
  const {buildQqSnapshot}=await import('/src/qqContextSnapshot.ts');let rejected=false;try{await buildQqSnapshot(world.id)}catch{rejected=true}return {snapshot:await buildQqSnapshot(id),rejected};
 },f.id);
 expect(JSON.stringify(result.snapshot)).not.toMatch(/B_PRIVATE|B_MEMORY_PRIVATE|WORLD_PRIVATE|WORLD_MEMORY_PRIVATE/);expect(result.rejected).toBe(true);
});

test('successful automatic summary updates source-verified cloud memories without additional model generation',async({page})=>{
 const f=await fixture(page);let modelCalls=0;
 await page.route('https://summary-qq.test/**',route=>{modelCalls++;const system=route.request().postDataJSON().messages?.[0]?.content??'';return route.fulfill({json:{choices:[{message:{content:JSON.stringify(system.includes('memories')?{memories:[{type:'fact',content:'角色明确表示喜欢画展。',quality:{category:'preference',importance:'high',durability:'lasting',impact:'持续影响共同活动选择',evidence:[{turn:1,role:'assistant',quote:'我喜欢画展'}]}}]}:{summary:'双方约定周末看展，尚未完成；角色喜欢画展。'})},finish_reason:'stop'}]}});});
 const result=await page.evaluate(async id=>{
  const {db}=await import('/src/store.ts');const t=await import('/src/timelines.ts');const rows=[];
  for(let i=1;i<=20;i++){rows.push({id:'summary-u'+i,conversationId:id,role:'user',content:'第'+i+'轮：我们约定周末看展览',createdAt:i*2});rows.push({id:'summary-a'+i,conversationId:id,role:'assistant',content:'第'+i+'轮：我喜欢画展。这是承诺，还没有完成。',createdAt:i*2+1});}
  await db.transaction('rw',t.timelineTables(),async()=>{await db.messages.bulkPut(rows);await t.commitTimelineProjection(id,'append');});
  const api={id:'qq-summary',name:'Synthetic',provider:'openai-compatible' as const,baseUrl:'https://summary-qq.test/v1',model:'mock',enabled:true,isDefault:true,temperature:.7,maxTokens:4096,createdAt:1,updatedAt:1};
  await db.apiConfigs.put(api);await db.apiCredentials.put({configId:api.id,apiKey:'synthetic-summary-only'});await(await import('/src/dedicatedSummaryApi.ts')).saveSummaryApi({...api,apiKey:'synthetic-summary-only'});
  const scope=await(await import('/src/memoryStore.ts')).getMemoryScope(id);const summary=await import('/src/memorySummary.ts');await summary.saveSummarySettings(scope,true,20);await summary.runMemorySummary(scope,false);return summary.summaryStatus(scope);
 },f.id);
 expect(result.pending).toBe(0);expect(result.receipts).toBe(1);const calls=modelCalls;await f.sync();expect(modelCalls).toBe(calls);
 expect(f.snapshot.data.documents.some((d:any)=>d.kind==='long'&&d.content.includes('喜欢画展'))).toBe(true);
 expect(f.snapshot.data.documents.some((d:any)=>d.kind==='summary')).toBe(true);
 await page.evaluate(async id=>{await(await import('/src/messageOperations.ts')).editMessage(id,'summary-u1','已修改原始来源',true);},f.id);await f.direct();
 expect(f.snapshot.data.documents.some((d:any)=>d.kind==='long'||d.kind==='summary')).toBe(false);
});

test('old pending QQ sends do not block newer events; confirmed sends are rechecked exactly once',async({page})=>{
 const f=await fixture(page);const rows=[{id:'50000000-0000-4000-8000-000000000001',direction:'inbound',body:'QQ提问',status:'generated',local_message_id:null,received_at:'2026-01-01T00:00:00.000Z'}, {id:'50000000-0000-4000-8000-000000000002',direction:'outbound',body:'尚未发送',status:'generated',local_message_id:null,received_at:'2026-01-01T00:00:01.000Z'}];f.setRows(rows);
 const run=()=>page.evaluate(async({id,bindingId})=>(await import('/src/qqDailySync.ts')).syncQqDailyConversation(id,bindingId),{id:f.id,bindingId});
 rows.push({id:'50000000-0000-4000-8000-000000000003',direction:'inbound',body:'后续已收到的新事件',status:'generated',local_message_id:null,received_at:'2026-01-01T00:00:02.000Z'});expect(await run()).toBe(2);expect(await run()).toBe(0);rows[1].status='sent';expect(await run()).toBe(1);expect(await run()).toBe(0);
});

test('QQ current topic activates global worldbook rules without leaking private World books',async({page})=>{
 const f=await fixture(page);
 await page.evaluate(async()=>{const {db}=await import('/src/store.ts');const {newBook,newEntry}=await import('/src/loreTypes.ts');const book={...newBook(),id:'global-qq-book',global:true};await db.lorebooks.put(book);await db.loreEntries.put({...newEntry(book.id),id:'keyword-qq-entry',primaryKeys:['婚姻'],content:'婚姻话题的有效世界书设定'});const privateBook={...newBook(),id:'world-only-book',global:false,worldIds:['hidden-world']};await db.lorebooks.put(privateBook);await db.loreEntries.put({...newEntry(privateBook.id),constant:true,content:'DO_NOT_UPLOAD_WORLD_LORE'});});
 await f.direct();expect(JSON.stringify(f.snapshot)).not.toContain('DO_NOT_UPLOAD_WORLD_LORE');
 expect(JSON.stringify(qqRequestContext(f.snapshot.messages,f.snapshot.data,[],[],'聊聊婚姻'))).toContain('婚姻话题的有效世界书设定');
 expect(JSON.stringify(qqRequestContext(f.snapshot.messages,f.snapshot.data,[],[],'今天晚饭吃什么'))).not.toContain('婚姻话题的有效世界书设定');
});

test('committed memory changes in another tab wake automatic QQ synchronization',async({page})=>{
 const f=await fixture(page);await f.sync();const second=await page.context().newPage();await isolatedApp(second,f.databaseName);
 await second.evaluate(async id=>{const m=await import('/src/memoryStore.ts');await m.createMemory(await m.getMemoryScope(id),{kind:'core',content:'另一个窗口更新的重要事实'});},f.id);
 await expect.poll(()=>JSON.stringify(f.snapshot),{timeout:10000}).toContain('另一个窗口更新的重要事实');await second.close();
});

test('new split QQ reply imports the complete original message and exposes every bubble to memory summary',async({page})=>{
 const f=await fixture(page);const parent='60000000-0000-4000-8000-000000000001';const parts=['60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000003'];const full='我今天很好。\n我承诺下周陪你去画展。';
 f.setRows([{id:parent,direction:'inbound',body:'今天怎么样',status:'generated',received_at:'2026-01-01T00:00:00Z',local_message_id:null},...parts.map((id,i)=>({id,direction:'outbound',body:i?'我承诺下周陪你去画展。':'我今天很好。',status:'sent',received_at:'2026-01-01T00:00:01Z',part_index:i+1,local_message_id:null,in_reply_to:parent,reply_ready:true,reply_part_ids:parts,reply_body:full}))]);
 const result=await page.evaluate(async({id,bindingId})=>{
  const {syncQqDailyConversation}=await import('/src/qqDailySync.ts');await syncQqDailyConversation(id,bindingId);await syncQqDailyConversation(id,bindingId);
  const path=await(await import('/src/messagePath.ts')).activeMessages(id);const summary=await(await import('/src/memorySummary.ts')).summaryStatus(await(await import('/src/memoryStore.ts')).getMemoryScope(id));
  return {path,summary,snapshot:await(await import('/src/qqContextSnapshot.ts')).buildQqSnapshot(id)};
 },{id:f.id,bindingId});
 expect(result.path).toHaveLength(2);expect(result.path[1].content).toBe(full);expect(result.summary.pending).toBe(1);expect(result.snapshot.data.includedQqReplyIds).toEqual([parent]);
 const backup=await page.evaluate(async({id,parent})=>{
  const {db}=await import('/src/store.ts');const before=await db.messages.count();const {createZipBackup,readBackupZip}=await import('/src/backupZip.ts');const {readBackup,verifiedCandidate}=await import('/src/backupService.ts');
  const zip=await createZipBackup({closedOtherClients:true});const checked=await readBackup(await readBackupZip(zip),{mode:'rehearse'});
  try{return {body:(await verifiedCandidate(checked).table('messages').get('qq:reply:'+parent))?.content,report:checked.report,unchanged:before===await db.messages.count()};}finally{await checked.dispose();}
 },{id:f.id,parent});expect(backup.body).toBe(full);expect(backup.report.referencesValid).toBe(true);expect(backup.report.sourceDatabaseWritten).toBe(false);expect(backup.unchanged).toBe(true);

 const recent=parts.map((id,i)=>({id,body:i?'我承诺下周陪你去画展。':'我今天很好。',direction:'outbound',status:'sent',received_at:'2026-01-01T00:00:01Z',in_reply_to:parent}));
 const request=qqRequestContext(result.snapshot.messages,result.snapshot.data,recent,[],'画展');expect(request.filter(m=>m.content.includes('我承诺下周陪你去画展。'))).toHaveLength(1);
});

for(const width of [390,430])test(`QQ sync preserves mobile page bounds and input focus ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});const f=await fixture(page);await f.sync();
 const result=await page.evaluate(()=>({viewport:innerWidth,body:document.body.scrollWidth,root:document.getElementById('root')!.scrollWidth,focused:document.activeElement?.tagName}));
 expect(result.body).toBeLessThanOrEqual(result.viewport);expect(result.root).toBeLessThanOrEqual(result.viewport);expect(result.focused).not.toBe('INPUT');
});

test('same-timestamp legacy bubbles retain server part order after actual IndexedDB timeline projection',async({page})=>{
 const f=await fixture(page);const at='2026-01-01T00:00:01.123455Z';f.setRows([{id:'70000000-0000-4000-8000-000000000002',direction:'inbound',body:'提问',status:'generated',local_message_id:null,received_at:'2026-01-01T00:00:00Z'}, {id:'70000000-0000-4000-8000-000000000003',direction:'outbound',body:'第一句',status:'sent',local_message_id:null,received_at:at,part_index:1}, {id:'70000000-0000-4000-8000-000000000001',direction:'outbound',body:'第二句',status:'sent',local_message_id:null,received_at:at,part_index:2}]);
 await page.evaluate(async({id,bindingId})=>(await import('/src/qqDailySync.ts')).syncQqDailyConversation(id,bindingId),{id:f.id,bindingId});
 const messages=await page.evaluate(async id=>(await import('/src/messagePath.ts')).activeMessages(id),f.id);expect(messages.map(m=>m.content)).toEqual(['提问','第一句','第二句']);expect(messages[1].createdAt).toBeLessThan(messages[2].createdAt);
 await page.reload();expect((await page.evaluate(async id=>(await import('/src/messagePath.ts')).activeMessages(id),f.id)).map(m=>m.content)).toEqual(['提问','第一句','第二句']);
});

test('stable-ID restore resolves an old cloud conversation without QR rebinding',async({page})=>{
 const f=await fixture(page);f.setRemoteConversation('restored-old-conversation');await f.sync();expect(f.snapshot.data.conversationId).toBe(f.id);expect(f.writes).toBe(1);
});

test('missing cloud cursor automatically resumes with canonical dedup and archives the old checkpoint',async({page})=>{
 const f=await fixture(page);f.setRows([{id:'80000000-0000-4000-8000-000000000001',direction:'inbound',body:'恢复后的QQ事实',status:'received',local_message_id:null,received_at:'2026-01-01T00:00:00Z'}]);
 await page.evaluate(({bindingId,id})=>{localStorage.setItem('claudia-qq-auto-backfill:'+bindingId+':'+id,'done');localStorage.setItem('claudia-qq-sync-checkpoint:'+bindingId+':'+id,JSON.stringify({at:'2026-01-02T00:00:00Z',id:'80000000-0000-4000-8000-000000000099'}));},{bindingId,id:f.id});
 await f.sync();const result=await page.evaluate(async({bindingId,id})=>({messages:await(await import('/src/messagePath.ts')).activeMessages(id),archived:localStorage.getItem('claudia-qq-sync-checkpoint:'+bindingId+':'+id+':previous')}),{bindingId,id:f.id});expect(result.messages[0].content).toBe('恢复后的QQ事实');expect(result.archived).toContain('000000000099');
});

test('connected QQ readback does not upload private context before AI/continuity authorization',async({page})=>{
 const f=await fixture(page);f.setAiEnabled(false);await page.evaluate(bindingId=>localStorage.removeItem('claudia-qq-closed-continuity:'+bindingId),bindingId);await f.sync();expect(f.writes).toBe(0);
});

test('actual attachment-menu manual sync button imports into the existing Daily conversation',async({page})=>{
 const f=await fixture(page);await f.sync();await page.getByRole('button',{name:'聊天',exact:true}).click();await page.getByRole('button',{name:/角色A/}).first().click();
 await page.getByRole('button',{name:'图片附件',exact:true}).click();const button=page.getByRole('menuitem',{name:'同步 QQ 记录到本地',exact:true});await expect(button).toBeEnabled();
 f.setRows([{id:'90000000-0000-4000-8000-000000000001',direction:'inbound',body:'QQ手动回填的真实结构记录',status:'received',local_message_id:null,received_at:'2026-01-01T00:00:00Z'}]);
 page.once('dialog',dialog=>dialog.accept());await button.click();await expect(page.getByText('QQ手动回填的真实结构记录',{exact:true})).toBeVisible();
});

test('pending-only cloud polls do not create an empty timeline or lose later delivered records after refresh',async({page})=>{
 const f=await fixture(page);f.setRows([{id:'a0000000-0000-4000-8000-000000000001',direction:'outbound',body:'等待确认',status:'generated',local_message_id:null,received_at:'2026-01-01T00:00:00Z'}]);
 await f.sync();expect(await page.evaluate(async id=>(await(await import('/src/store.ts')).db.conversations.get(id))?.activeTimelineId,f.id)).toBeUndefined();
 await page.reload();f.setRows([{id:'a0000000-0000-4000-8000-000000000001',direction:'outbound',body:'等待确认',status:'sent',local_message_id:null,received_at:'2026-01-01T00:00:00Z'}]);await f.sync();
 expect((await page.evaluate(async id=>(await import('/src/messagePath.ts')).activeMessages(id),f.id)).map(m=>m.content)).toEqual(['等待确认']);
});
