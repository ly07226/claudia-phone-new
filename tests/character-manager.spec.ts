import {test,expect,type Page} from "@playwright/test";
const png={name:"avatar.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64")};
async function open(page:Page){await page.goto("/");await page.getByRole("button",{name:"角色管理",exact:true}).click();}
const card=(page:Page,id:string)=>page.locator(`[data-character-id="${id}"]`);
async function edit(page:Page,id:string){await card(page,id).getByRole("button",{name:"编辑角色",exact:true}).click();await expect(page.getByRole("form",{name:"编辑角色表单"})).toBeVisible();await expect(page.getByLabel("角色姓名",{exact:true})).toBeFocused();}
async function save(page:Page){await page.getByRole("button",{name:"保存角色",exact:true}).click();await expect(page.locator(".character-editor")).toHaveCount(0);}

test("空白角色可重新编辑，更新原ID、取消不保存，长列表编辑会定位表单",async({page})=>{
 await open(page);await page.getByRole("button",{name:"创建角色",exact:true}).click();await page.getByLabel("角色姓名",{exact:true}).fill("空白角色");await save(page);
 const id=await page.evaluate(async()=>(await import("/src/store.ts")).db.characters.toArray().then(rows=>rows[0].id));
 await page.evaluate(async()=>{const {db,usePhone}=await import("/src/store.ts");await db.characters.bulkPut(Array.from({length:18},(_,i)=>({id:`filler-${i}`,name:`占位测试${i}`,persona:"长人设\n".repeat(300)})));await usePhone.getState().reload();});
 await edit(page,id);expect(await page.getByLabel("角色人设",{exact:true}).inputValue()).toBe("");
 const bounds=await page.locator(".character-editor").boundingBox();const scroll=await page.locator(".app-scroll").boundingBox();expect(bounds!.y).toBeGreaterThanOrEqual(scroll!.y-1);expect(bounds!.y).toBeLessThan(844);
 await page.getByLabel("角色姓名",{exact:true}).fill("编辑后的名字");await page.getByLabel("角色人设",{exact:true}).fill("补充的人设\n保留换行");await page.getByLabel("说话方式",{exact:true}).fill("简洁回应");await save(page);
 expect(await page.evaluate(async id=>{const {db}=await import("/src/store.ts");return {count:await db.characters.count(),character:await db.characters.get(id)};},id)).toMatchObject({count:19,character:{id,name:"编辑后的名字",persona:"补充的人设\n保留换行",speakingStyle:"简洁回应"}});
 await edit(page,id);await page.getByLabel("角色姓名",{exact:true}).fill("取消的草稿");await page.getByRole("button",{name:"取消",exact:true}).click();expect(await page.evaluate(async id=>(await(await import("/src/store.ts")).db.characters.get(id))?.name,id)).toBe("编辑后的名字");
});

test("完整资料回显，编辑保留头像/API/世界绑定/聊天版本与快照，删除保留确认",async({page})=>{
 await open(page);await page.evaluate(async()=>{
  const {db,usePhone}=await import("/src/store.ts");await db.worlds.put({id:"cm-world",name:"自定义世界",description:"",createdAt:1});
  await db.assets.put({id:"cm-avatar",type:"avatar",data:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",createdAt:1});
  await db.characters.put({id:"cm-full",name:"完整角色",persona:"原始设定",speakingStyle:"原始风格",avatar:"cm-avatar",apiConfigId:"removed-api",worldId:"cm-world",extraMetadata:{keep:true}} as any);
  await db.worldProfiles.put({id:"cm-profile",worldId:"cm-world",characterId:"cm-full",setting:"世界专属设定"});
  const c=await(await import("/src/chatService.ts")).getConversation("cm-full","cm-world");
  await db.messages.put({id:"cm-msg",conversationId:c.id,role:"assistant",content:"既有回复",activeVariantId:"cm-variant",createdAt:1});await db.messageVariants.put({id:"cm-variant",conversationId:c.id,messageId:"cm-msg",content:"既有回复",source:"legacy",createdAt:1});
  await db.conversationSnapshots.put({id:"cm-snapshot",conversationId:c.id,reason:"edit",createdAt:1,messages:await db.messages.toArray(),variants:await db.messageVariants.toArray()});await usePhone.getState().reload();
 });
 const capture=()=>page.evaluate(async()=>{const {db}=await import("/src/store.ts");return Promise.all([db.worldProfiles.toArray(),db.conversations.toArray(),db.messages.toArray(),db.messageVariants.toArray(),db.conversationSnapshots.toArray(),db.assets.toArray()]);});const before=await capture();
 await edit(page,"cm-full");await expect(page.getByLabel("角色人设",{exact:true})).toHaveValue("原始设定");await expect(page.getByLabel("说话方式",{exact:true})).toHaveValue("原始风格");await expect(page.getByLabel("角色 API",{exact:true})).toHaveValue("removed-api");await expect(page.getByAltText("角色头像预览",{exact:true})).toBeVisible();
 await page.getByLabel("角色姓名",{exact:true}).fill("新的名称");await page.getByLabel("角色人设",{exact:true}).fill("新的人设");await save(page);expect(await capture()).toEqual(before);
 expect(await page.evaluate(async()=>(await import("/src/store.ts")).db.characters.get("cm-full"))).toMatchObject({id:"cm-full",name:"新的名称",persona:"新的人设",avatar:"cm-avatar",apiConfigId:"removed-api",worldId:"cm-world",extraMetadata:{keep:true}});
 let confirmations=0;page.on("dialog",d=>{confirmations++;void d.dismiss();});await card(page,"cm-full").getByRole("button",{name:"删除角色",exact:true}).click();expect(confirmations).toBe(1);expect(await capture()).toEqual(before);await expect(card(page,"cm-full")).toBeVisible();
});

test("卡片默认折叠、独立展开、长文完整且不改数据，手机无横向溢出",async({page})=>{
 await open(page);const persona="第一行设定\n"+"长篇人物信息。".repeat(900);await page.evaluate(async text=>{const {db,usePhone}=await import("/src/store.ts");await db.characters.bulkPut([{id:"fold-a",name:"长文角色",persona:text,speakingStyle:"温和\n克制"},{id:"fold-b",name:"空白角色",persona:""}]);await usePhone.getState().reload();},persona);
 await expect(page.locator(".character-details")).toHaveCount(0);await expect(card(page,"fold-b")).toContainText("尚未填写人设");
 const short=await card(page,"fold-a").boundingBox();expect(short!.height).toBeLessThan(220);
 await card(page,"fold-a").getByRole("button",{name:"展开",exact:true}).click();await expect(card(page,"fold-a").getByRole("region")).toContainText(persona);await expect(card(page,"fold-b").getByRole("region")).toHaveCount(0);await expect(card(page,"fold-a").getByRole("region").locator(".preserve").last()).toHaveCSS("white-space","pre-wrap");
 expect(await card(page,"fold-a").getByRole("region").evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await card(page,"fold-a").getByRole("button",{name:"收起",exact:true}).click();expect(Math.abs((await card(page,"fold-a").boundingBox())!.height-short!.height)).toBeLessThanOrEqual(0.5);
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 expect(await page.evaluate(async()=>(await(await import("/src/store.ts")).db.characters.get("fold-a"))?.persona)).toBe(persona);
});

test("顶部头像选择、更换、取消、移除与格式失败保持兼容",async({page})=>{
 await open(page);await page.getByRole("button",{name:"创建角色",exact:true}).click();await expect(page.locator(".character-avatar-preview > svg")).toBeVisible();
 const picker=await page.locator(".character-avatar-control").boundingBox();const name=await page.getByLabel("角色姓名",{exact:true}).boundingBox();expect(picker!.y+picker!.height).toBeLessThan(name!.y);
 const choosing=page.waitForEvent("filechooser");await page.getByRole("button",{name:"上传角色头像",exact:true}).click();await(await choosing).setFiles(png);await expect(page.getByAltText("角色头像预览",{exact:true})).toBeVisible();await page.getByLabel("角色姓名",{exact:true}).fill("头像角色");await save(page);
 const c=await page.evaluate(async()=>(await import("/src/store.ts")).db.characters.toArray().then(r=>r[0]));await edit(page,c.id);await expect(page.getByAltText("角色头像预览",{exact:true})).toBeVisible();
 await page.getByLabel("上传头像",{exact:true}).setInputFiles({...png,name:"replacement.png"});await expect(page.getByRole("button",{name:"保存角色",exact:true})).toBeEnabled();await save(page);const second=await page.evaluate(async id=>(await(await import("/src/store.ts")).db.characters.get(id))?.avatar,c.id);expect(second).not.toBe(c.avatar);
 await edit(page,c.id);await page.getByRole("button",{name:"移除头像",exact:true}).click();await expect(page.locator(".character-avatar-preview > svg")).toBeVisible();await page.getByRole("button",{name:"取消",exact:true}).click();expect(await page.evaluate(async id=>(await(await import("/src/store.ts")).db.characters.get(id))?.avatar,c.id)).toBe(second);
 await edit(page,c.id);await page.getByRole("button",{name:"移除头像",exact:true}).click();await save(page);await edit(page,c.id);await expect(page.locator(".character-avatar-preview > svg")).toBeVisible();
 await page.getByLabel("上传头像",{exact:true}).setInputFiles({name:"bad.txt",mimeType:"text/plain",buffer:Buffer.from("invalid")});await expect(page.locator(".character-error")).toContainText("请选择 JPG");
 await page.getByLabel("上传头像",{exact:true}).setInputFiles({name:"broken.png",mimeType:"image/png",buffer:Buffer.from("not a png")});await expect(page.locator(".character-error")).toContainText("头像上传未完成");expect(await page.evaluate(async id=>(await(await import("/src/store.ts")).db.characters.get(id))?.avatar,c.id)).toBeUndefined();expect(await page.evaluate(async()=>(await import("/src/store.ts")).db.assets.count())).toBe(2);
});

test("迟到上传不覆盖输入或恢复取消的表单；已删除角色不可被保存复活",async({page})=>{
 await open(page);await page.getByRole("button",{name:"创建角色",exact:true}).click();await page.getByLabel("角色姓名",{exact:true}).fill("上传期间");
 await page.evaluate(async()=>{const {db}=await import("/src/store.ts");const put=db.assets.put.bind(db.assets);(db.assets as any).put=async(...args:any[])=>{await new Promise<void>(resolve=>(window as any).__releaseAvatar=resolve);return put(...args as [any]);};});
 await page.getByLabel("上传头像",{exact:true}).setInputFiles(png);await page.waitForFunction(()=>typeof (window as any).__releaseAvatar === "function");await expect(page.getByRole("button",{name:"保存角色",exact:true})).toBeDisabled();await page.getByLabel("角色姓名",{exact:true}).fill("保留最新输入");await page.getByLabel("角色人设",{exact:true}).fill("新的输入不能被上传旧闭包覆盖");await page.evaluate(()=>(window as any).__releaseAvatar());await expect(page.getByAltText("角色头像预览",{exact:true})).toBeVisible();await expect(page.getByLabel("角色姓名",{exact:true})).toHaveValue("保留最新输入");await save(page);
 const id=await page.evaluate(async()=>(await import("/src/store.ts")).db.characters.toArray().then(r=>r[0].id));await edit(page,id);await page.evaluate(()=>{delete (window as any).__releaseAvatar;});await page.getByLabel("上传头像",{exact:true}).setInputFiles({...png,name:"late.png"});await page.waitForFunction(()=>!!(window as any).__releaseAvatar);await page.getByRole("button",{name:"取消",exact:true}).focus();await page.keyboard.press("Enter");await page.getByRole("button",{name:"创建角色",exact:true}).click();await page.getByLabel("角色姓名",{exact:true}).fill("另一个草稿");await page.evaluate(()=>(window as any).__releaseAvatar());await expect(page.getByText("正在处理并保存图片…",{exact:true})).toHaveCount(0);await expect(page.getByLabel("角色姓名",{exact:true})).toHaveValue("另一个草稿");await expect(page.getByAltText("角色头像预览",{exact:true})).toHaveCount(0);await page.getByRole("button",{name:"取消",exact:true}).click();
 await edit(page,id);await page.evaluate(async id=>(await import("/src/chatService.ts")).deleteCharacter(id),id);await page.getByRole("button",{name:"保存角色",exact:true}).click();await expect(page.locator(".character-error")).toContainText("保存未完成");expect(await page.evaluate(async()=>(await import("/src/store.ts")).db.characters.count())).toBe(0);
});
