import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

for (const standalone of [false,true]) test(`iOS安全区单次补偿、全屏和背景切换：standalone=${standalone}`,async({page})=>{
  await page.addInitScript(mode=>{
    Object.defineProperty(navigator,"standalone",{value:mode,configurable:true});
    const original=matchMedia.bind(window);window.matchMedia=q=>{const m=original(q);if(q.includes("display-mode: standalone")) Object.defineProperty(m,"matches",{value:mode});return m;};
  },standalone);
  await page.goto("/");await expect(page.locator(".desktop")).toBeVisible();
  await page.evaluate(async()=>{
    const {db,usePhone}=await import("/src/store.ts");
    await db.assets.put({id:"viewport-wallpaper",type:"wallpaper",data:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",createdAt:1});
    await db.themes.put({...usePhone.getState().theme,wallpaper:"viewport-wallpaper"});
    await db.worlds.put({id:"viewport-world",name:"用户剧本",description:"布局验证",createdAt:1});
    await usePhone.getState().reload();
    document.documentElement.style.setProperty("--safe-top","47px");
    document.documentElement.style.setProperty("--safe-bottom","34px");
  });
  const theme=await page.evaluate(async()=>(await import("/src/store.ts")).db.themes.get("global"));
  await expect(page.locator("html")).toHaveAttribute("data-standalone",String(standalone));
  await expect(page.locator(".simulated-time,.status-icons,.home-indicator")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"返回空间列表",exact:true})).toBeVisible();
  for(const [width,height] of [[390,844],[390,568],[844,390]]) {
    await page.setViewportSize({width,height});
    const r=await page.evaluate(()=>{
      const phone=document.querySelector(".phone")!.getBoundingClientRect();const status=document.querySelector(".status")!.getBoundingClientRect();const desktop=document.querySelector(".desktop")!;desktop.scrollTop=desktop.scrollHeight;
      return {top:phone.top,height:phone.height,width:phone.width,status:status.height,desktop:desktop.getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight+1};
    });
    expect(r).toEqual({top:0,height,width,status:91,desktop:91,overflow:false});
    const dock=await page.locator(".dock").boundingBox();expect(dock!.y+dock!.height).toBeLessThanOrEqual(height-34);
  }
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator("html")).toHaveAttribute("data-screen","desktop");
  expect(await page.locator("html").evaluate(el=>getComputedStyle(el).backgroundImage)).toContain("data:image/png");
  await page.getByRole("button",{name:"Dock 设置",exact:true}).click();
  await expect(page.locator(".phone")).toHaveCSS("background-image","none");
  await expect(page.locator("html")).toHaveAttribute("data-screen","app");
  expect(await page.locator("html").evaluate(el=>getComputedStyle(el).backgroundImage)).toBe("none");
  await expect.poll(async()=>Math.round((await page.locator(".app-panel").boundingBox())!.y)).toBe(47);
  await page.locator(".app-scroll button").last().scrollIntoViewIfNeeded();
  const last=await page.locator(".app-scroll button").last().boundingBox();expect(last!.y+last!.height).toBeLessThanOrEqual(844-34);
  await page.getByRole("button",{name:"返回桌面",exact:true}).click();
  await expect(page.locator(".phone")).not.toHaveCSS("background-image","none");
  await page.getByRole("button",{name:"返回空间列表",exact:true}).click();
  await expect(page.locator("html")).toHaveAttribute("data-screen","spaces");
  expect(await page.locator("html").evaluate(el=>getComputedStyle(el).backgroundImage)).not.toContain("data:image");
  await page.getByRole("button",{name:"剧本",exact:true}).click();
  await page.getByRole("button",{name:"进入剧本 · 用户剧本",exact:true}).click();
  await expect(page.locator(".desktop")).toBeVisible();
  await page.reload();await expect(page.locator(".desktop")).toBeVisible();
  expect(await page.evaluate(async()=>(await import("/src/spaces.ts")).useSpaces.getState().space?.spaceId)).toBe("world:viewport-world");
  expect(await page.evaluate(async()=>(await import("/src/store.ts")).db.themes.get("global"))).toEqual(theme);
});

test("聊天只由会话补偿安全区，键盘小视口可访问",async({page})=>{
  await page.goto("/");await expect(page.locator(".desktop")).toBeVisible();
  await page.evaluate(async()=>{const {db,usePhone}=await import("/src/store.ts");await db.characters.put({id:"safe-role",name:"安全区角色",persona:"base"});await usePhone.getState().reload();document.documentElement.style.setProperty("--safe-top","47px");document.documentElement.style.setProperty("--safe-bottom","34px");});
  await page.getByRole("button",{name:"聊天",exact:true}).click();await page.getByRole("button",{name:/安全区角色.*开始/}).click();
  await expect(page.locator(".status")).toBeHidden();
  await expect(page.locator(".chat-immersive")).toHaveCSS("padding-top","47px");
  expect((await page.locator(".chat-nav").boundingBox())!.y).toBe(47);
  await page.getByLabel("聊天消息",{exact:true}).focus();await page.setViewportSize({width:390,height:350});
  await expect.poll(async()=>Math.round((await page.locator(".phone").boundingBox())!.height)).toBe(350);
  const footer=await page.locator(".chat-footer").boundingBox();expect(footer!.y+footer!.height).toBeLessThanOrEqual(350);
});

test.describe("桌面浏览器预览",()=>{
  test.use({userAgent:"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36",isMobile:false,hasTouch:false,viewport:{width:1280,height:960}});
  test("非iOS保留模拟状态栏与手机框",async({page})=>{
    await page.goto("/");await expect(page.locator(".desktop")).toBeVisible();
    await expect(page.locator(".simulated-time")).toBeVisible();await expect(page.locator(".status-icons")).toBeVisible();
    expect((await page.locator(".phone").boundingBox())!.width).toBe(390);
    await expect(page.locator(".status")).toHaveCSS("height","57px");
  });
});

test("PWA配置与壳缓存升级不清理业务数据或其他缓存，拒绝错误MIME",async({page})=>{
  await page.goto("/");await expect(page.locator(".desktop")).toBeVisible();
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content",/viewport-fit=cover/);
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute("content","black-translucent");
  expect((await (await page.request.get("/manifest.webmanifest")).json()).display).toBe("standalone");
  const handlers:Record<string,Function>={};const stores=new Map<string,Map<string,Response>>();const deleted:string[]=[];let response=new Response("body",{headers:{"content-type":"text/css"}});let offline=false;let installing=true;let options:any;
  const key=(r:any)=>typeof r==="string"?new URL(r,"https://phone.test").href:r.url;
  const cache=(name:string)=>{if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name)!;return {addAll:async()=>{},put:async(r:any,v:Response)=>{data.set(key(r),v);},match:async(r:any,options?:{ignoreVary?:boolean})=>r.mode === "cors" && !options?.ignoreVary ? undefined : data.get(key(r))};};
  stores.set("claudia-v1",new Map());stores.set("other-app",new Map());
  runInNewContext(readFileSync("public/sw.js","utf8"),{URL,Response,self:{location:{origin:"https://phone.test"},skipWaiting:()=>{},clients:{claim:async()=>{}},addEventListener:(name:string,fn:Function)=>handlers[name]=fn},caches:{open:async(name:string)=>cache(name),keys:async()=>[...stores.keys()],delete:async(name:string)=>{deleted.push(name);return stores.delete(name);}},fetch:async(r:any,o:any)=>{options=o;if(offline)throw Error("offline");if(installing) return new Response(r === "/" ? '<html><script src="/assets/entry.js"></script><link href="/assets/entry.css"></html>' : "resource",{headers:{"content-type":r === "/" ? "text/html" : r.endsWith(".js") ? "text/javascript" : r.endsWith(".css") ? "text/css" : r === "/icon.svg" ? "image/svg+xml" : "application/manifest+json"}});return response;}});
  let tasks:Promise<any>[]=[];const event={waitUntil:(p:Promise<any>)=>tasks.push(p)};handlers.install(event);await Promise.all(tasks);installing=false;const initialSize=stores.get("claudia-shell-v2")!.size;expect(initialSize).toBe(5);tasks=[];handlers.activate(event);await Promise.all(tasks);expect(deleted).toEqual(["claudia-v1"]);expect(stores.has("other-app")).toBe(true);
  const request=async(path:string,mode="cors")=>{tasks=[];let pending:Promise<Response>|undefined;handlers.fetch({...event,request:{url:`https://phone.test${path}`,method:"GET",mode},respondWith:(p:Promise<Response>)=>pending=p});if(!pending)return undefined;const result=await pending;await Promise.all(tasks);return result;};
  await request("/assets/style.css");expect(stores.get("claudia-shell-v2")!.size).toBe(initialSize+1);
  response=new Response("html",{headers:{"content-type":"text/html"}});await request("/assets/bad.css");expect(stores.get("claudia-shell-v2")!.size).toBe(initialSize+1);
  expect(await request("/api/chat")).toBeUndefined();
  await request("/","navigate");expect(options.cache).toBe("no-cache");offline=true;expect((await request("/assets/style.css"))!.ok).toBe(true);
});
