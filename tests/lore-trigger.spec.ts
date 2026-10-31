import {test,expect} from "@playwright/test";
async function ready(page:any){await page.goto("/");await expect(page.locator(".desktop")).toBeVisible();}

test("即时不追溯旧句，旧条目保留历史/AI；窗口先截取再排除AI",async({page})=>{
 await ready(page);
 const r=await page.evaluate(async()=>{
  const {newBook,newEntry,normalizeEntry}=await import("/src/loreTypes.ts");const {entryActive,planLore,loreScanMessages}=await import("/src/loreEngine.ts");
  const b=newBook(),e={...newEntry(b.id),primaryKeys:["今天的暗号是什么"],content:"Char回答的答案必须包含月亮"};
  const old={...e};delete old.triggerMode;delete old.scanAssistant;
  const h:any=[{id:"old-user",role:"user",content:"今天的暗号是什么"},{id:"old-ai",role:"assistant",content:"月亮"},{id:"latest",role:"user",content:"午饭吃什么"}];
  const ai:any=[{id:"u1",role:"user",content:"你好"},{id:"ai-key",role:"assistant",content:"今天的暗号是什么"},{id:"u2",role:"user",content:"下午安排"}];
  return {newMode:e.triggerMode,oldMode:normalizeEntry(old).triggerMode,instant:entryActive(e,b,h),old:entryActive(old,b,h),instantAI:entryActive(e,b,ai),oldAI:entryActive(old,b,ai),excludeAI:entryActive({...old,scanAssistant:false},b,ai),window:loreScanMessages({...old,scanAssistant:false,scanDepth:1},b,h.slice(0,2)).length,hit:planLore([{entry:old,book:b}],ai).diagnostics[0],none:planLore([{entry:e,book:b}],[]).diagnostics[0]};
 });
 expect(r).toMatchObject({newMode:"instant",oldMode:"history",instant:false,old:true,instantAI:false,oldAI:true,excludeAI:false,window:0});
 expect(r.hit).toMatchObject({triggerMode:"history",reason:"injected",matchedMessages:[{id:"ai-key",role:"assistant"}]});expect(r.none.reason).toBe("no-user-message");
});

test("常驻独立、禁用/概率/辅助条件/预算诊断及元数据保真",async({page})=>{
 await ready(page);const r=await page.evaluate(async()=>{
  const {newBook,newEntry}=await import("/src/loreTypes.ts");const {planLore}=await import("/src/loreEngine.ts");const b=newBook(),base={...newEntry(b.id),primaryKeys:["key"],content:"PRIVATE_RULE"};
  const h:any=[{id:"user",role:"user",content:"PRIVATE_CHAT key"}];
  const go=(patch:any,book:any=b,budget=8000,random=()=>0)=>planLore([{book,entry:{...base,...patch}}],h,budget,random).diagnostics[0];
  return {constant:planLore([{book:b,entry:{...base,constant:true,triggerMode:"instant",scanAssistant:false}}],[]).diagnostics[0],book:go({}, {...b,enabled:false}),disabled:go({enabled:false}),paused:go({compatibilityIssues:["unknown"]}),zero:go({useProbability:true,probability:0}),hundred:go({useProbability:true,probability:100},b,8000,()=>0.999),secondary:go({selective:true,secondaryKeys:["missing"]}),notSecondary:go({selective:true,selectiveLogic:2,secondaryKeys:["missing"]}),globalBudget:go({},b,1),bookBudget:go({}, {...b,charBudget:1}),serialized:JSON.stringify(go({}))};
 });
 expect(r.constant).toMatchObject({triggerMode:"constant",reason:"injected",scannedMessageCount:0});
 for(const [k,reason] of Object.entries({book:"book-disabled",disabled:"entry-disabled",paused:"compatibility-paused",zero:"probability",hundred:"injected",secondary:"secondary-miss",notSecondary:"injected",globalBudget:"context-budget",bookBudget:"book-budget"})) expect((r as any)[k].reason).toBe(reason);
 expect(r.serialized).not.toContain("PRIVATE_CHAT");expect(r.serialized).not.toContain("PRIVATE_RULE");expect(r.serialized).not.toContain('"content"');
});

test("新旧Native与ST导入、导出往返保留模式；失败不写入",async({page})=>{
 await ready(page);const r=await page.evaluate(async()=>{
  const {db}=await import("/src/store.ts");const {newBook,newEntry}=await import("/src/loreTypes.ts");const {parseLorebook,exportLorebook}=await import("/src/loreImport.ts");
  const b={...newBook(),name:"book"},e={...newEntry(b.id),title:"entry",content:"value",triggerMode:"history" as const,scanAssistant:false};
  const round=parseLorebook(exportLorebook(b,[e])).entries[0];const native=JSON.parse(exportLorebook(b,[e]));delete native.entries[0].triggerMode;delete native.entries[0].scanAssistant;
  const old=parseLorebook(JSON.stringify(native)).entries[0];const st=parseLorebook(JSON.stringify({entries:{0:{uid:0,key:["key"],content:"value",constant:false}}})).entries[0];
  const instant=parseLorebook(exportLorebook(b,[{...e,triggerMode:"instant"}])).entries[0];
  const before=await db.loreEntries.count();native.entries[0].triggerMode="INVALID";let failed=false;try{failed=parseLorebook(JSON.stringify(native)).entries.length===0;}catch{failed=true;}
  return {round:{mode:round.triggerMode,scan:round.scanAssistant},old:{mode:old.triggerMode,scan:old.scanAssistant},st:{mode:st.triggerMode,scan:st.scanAssistant},instant:instant.triggerMode,failed,before,after:await db.loreEntries.count()};
 });expect(r).toEqual({round:{mode:"history",scan:false},old:{mode:"history",scan:true},st:{mode:"history",scan:true},instant:"instant",failed:true,before:0,after:0});
});

test("真实上下文、正则来源、停用及角色/世界隔离，历史记录不变",async({page})=>{
 await ready(page);const r=await page.evaluate(async()=>{
  const {db}=await import("/src/store.ts");const {getConversation}=await import("/src/chatService.ts");const {buildContext}=await import("/src/chatContext.ts");const {lastLoreTrace}=await import("/src/loreDiagnostics.ts");const {newBook,newEntry}=await import("/src/loreTypes.ts");
  await db.characters.bulkPut([{id:"c1",name:"one",persona:"PRIVATE_PERSONA"},{id:"c2",name:"two",persona:"base"}]);
  await db.worlds.bulkPut([{id:"a",name:"a",description:"",createdAt:1},{id:"b",name:"b",description:"",createdAt:1}]);
  await db.worldProfiles.bulkPut([{id:"pa",worldId:"a",characterId:"c1",setting:"A"},{id:"pb",worldId:"b",characterId:"c1",setting:"B"}]);
  const global={...newBook(),id:"global",global:true},ba={...newBook(),id:"bookA",worldIds:["a"]},bb={...newBook(),id:"bookB",worldIds:["b"]};await db.lorebooks.bulkPut([global,ba,bb]);
  const e={...newEntry(global.id),id:"e",regex:true,primaryKeys:["/暗号/"],content:"TEMP_RULE"};await db.loreEntries.bulkPut([e,{...newEntry(ba.id),id:"ae",constant:true,content:"ONLY_A"},{...newEntry(bb.id),id:"be",constant:true,content:"ONLY_B"}]);
  const cs=await Promise.all([getConversation("c1"),getConversation("c2"),getConversation("c1","a"),getConversation("c1","b")]);
  for(const [i,c] of cs.entries()) {await db.messages.bulkPut([{id:`u-${i}`,conversationId:c.id,role:"user",content:i===1?"本轮暗号":"PRIVATE_CHAT你好",createdAt:1},{id:`ai-${i}`,conversationId:c.id,role:"assistant",content:"旧的暗号",createdAt:2},{id:`last-${i}`,conversationId:c.id,role:"user",content:i===1?"本轮暗号":"午饭安排",createdAt:3}]);}
  const before=await db.messages.toArray();const contexts=[];for(const c of cs) contexts.push(await buildContext(c));
  const initial=lastLoreTrace(cs[0].id)!;const role2=lastLoreTrace(cs[1].id)!;
  await db.loreEntries.update("e",{triggerMode:"history",scanAssistant:true});await buildContext(cs[0]);const aiTrace=lastLoreTrace(cs[0].id)!;const regen=await buildContext(cs[0],"ai-0");
  await db.loreEntries.update("e",{scanAssistant:false});const filtered=await buildContext(cs[0]);
  await db.lorebooks.update(global.id,{enabled:false});await buildContext(cs[0]);const off=lastLoreTrace(cs[0].id)!;
  return {systems:contexts.map(c=>c[0].content),regen:regen[0].content,initial,role2,aiTrace,filtered:filtered[0].content,off,unchanged:JSON.stringify(before)===JSON.stringify(await db.messages.toArray()),version:db.verno,traceText:JSON.stringify([initial,role2,aiTrace,off])};
 });
 expect(r.systems[0]).not.toContain("TEMP_RULE");expect(r.systems[1]).toContain("TEMP_RULE");expect(r.systems[2]).toContain("ONLY_A");expect(r.systems[2]).not.toContain("ONLY_B");expect(r.systems[3]).toContain("ONLY_B");expect(r.systems[3]).not.toContain("ONLY_A");expect(r.systems[0]).not.toContain("ONLY_A");
 expect(r.initial.diagnostics[0].reason).toBe("primary-miss");expect(r.role2.diagnostics[0].matchedMessages).toEqual([{id:"last-1",role:"user"}]);expect(r.aiTrace.diagnostics[0].matchedMessages).toEqual([{id:"ai-0",role:"assistant"}]);expect(r.regen).not.toContain("TEMP_RULE");expect(r.filtered).not.toContain("TEMP_RULE");expect(r.off.skippedBooks).toContainEqual({lorebookId:"global",reason:"book-disabled"});expect(r.unchanged).toBe(true);expect(r.version).toBe(5);expect(r.traceText).not.toMatch(/PRIVATE_|TEMP_RULE|旧的暗号|ONLY_A|ONLY_B/);
});

test("手机编辑器默认即时、旧条目历史可排除AI，诊断可读且不持久化",async({page})=>{
 await ready(page);await page.evaluate(async()=>{const {db}=await import("/src/store.ts");const {newBook,newEntry}=await import("/src/loreTypes.ts");const b={...newBook(),id:"ui-book",name:"触发模式",global:true};const e={...newEntry(b.id),id:"old-entry",title:"旧条目",content:"PRIVATE_RULE"};delete e.triggerMode;delete e.scanAssistant;await db.lorebooks.put(b);await db.loreEntries.put(e);await db.characters.put({id:"ui-char",name:"char",persona:"base"});const c=await(await import("/src/chatService.ts")).getConversation("ui-char");await db.messages.put({id:"ui-msg",conversationId:c.id,role:"user",content:"PRIVATE_CHAT",createdAt:1});await(await import("/src/chatContext.ts")).buildContext(c);});
 await page.getByRole("button",{name:"设置",exact:true}).click();await page.getByRole("button",{name:"世界书 / Lorebook",exact:true}).click();
 await page.getByRole("button",{name:"查看最近触发诊断",exact:true}).click();await expect(page.locator(".lore-diagnostics")).toContainText("old-entry");await expect(page.locator(".lore-diagnostics")).not.toContainText("PRIVATE_CHAT");
 await page.getByRole("button",{name:"展开世界书 触发模式",exact:true}).click();await page.getByRole("button",{name:"新增条目",exact:true}).click();await expect(page.getByLabel("关键词触发模式")).toHaveValue("instant");
 await page.getByRole("button",{name:"取消",exact:true}).click();await page.getByRole("button",{name:"展开条目 旧条目",exact:true}).click();await page.getByRole("button",{name:"编辑条目",exact:true}).click();await expect(page.getByLabel("关键词触发模式")).toHaveValue("history");await expect(page.getByLabel("历史触发扫描AI消息")).toBeChecked();await page.getByLabel("历史触发扫描AI消息").uncheck();await page.getByRole("button",{name:"保存条目",exact:true}).click();
 expect(await page.evaluate(async()=>(await(await import("/src/store.ts")).db.loreEntries.get("old-entry"))?.scanAssistant)).toBe(false);
 await page.reload();expect(await page.evaluate(async()=>{const {db}=await import("/src/store.ts");await db.open();const c=await db.conversations.toArray();return(await import("/src/loreDiagnostics.ts")).lastLoreTrace(c[0].id);})).toBeNull();
});
