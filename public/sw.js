const CACHE = "claudia-shell-v2";
// Short-lived admission barrier: refuse new app documents during atomic restore.
let restoreLease;
const liveRestore = () => restoreLease && restoreLease.until > Date.now();
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const home = await fetch("/", {cache:"reload"});
    if (!home.ok || !(home.headers.get("content-type") || "").includes("text/html")) throw Error("Invalid app shell");
    const html = await home.clone().text();
    const entryAssets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(match => match[1]);
    const resources = await Promise.all([...new Set(["/icon.svg", "/manifest.webmanifest", ...entryAssets])].map(async path => {
      const response = await fetch(path, {cache:"reload"});
      if (!validShellResponse({url:new URL(path,self.location.origin).href,mode:"cors"},response)) throw Error("Invalid app resource");
      return [path,response];
    }));
    await Promise.all(resources.map(([path,response]) => cache.put(path,response)));
    // Commit the document only after its JS/CSS are available; failed installs
    // leave the currently active worker and its cache in place.
    await cache.put("/",home);
  })());
});
self.addEventListener("activate", event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("claudia-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
));
function validShellResponse(request, response) {
  if (!response || !response.ok) return false;
  const path = new URL(request.url).pathname;
  const type = response.headers.get("content-type") || "";
  if (request.mode === "navigate" || path === "/" || path === "/index.html") return type.includes("text/html");
  if (/\.(png|webp|jpe?g|svg|gif|avif)$/.test(path)) return type.startsWith("image/");
  if (path.endsWith(".css")) return type.includes("text/css");
  if (/\.(m?js)$/.test(path)) return /(?:java|ecma)script/.test(type);
  if (path === "/manifest.webmanifest") return /json/.test(type);
  return false;
}
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.mode === "navigate" && url.origin === self.location.origin && liveRestore()) {
    event.respondWith(Promise.resolve(new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><p>Claudia Phone 正在恢复数据，请关闭此窗口，稍后重新打开。</p>', {status:503,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}})));
    return;
  }
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Presentation shell only. Model/API requests are never intercepted or cached.
  if (!(request.mode === "navigate" || ["/", "/index.html", "/icon.svg", "/manifest.webmanifest"].includes(url.pathname) || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/images/"))) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request, request.mode === "navigate" ? {cache:"no-cache"} : undefined);
      if (validShellResponse(request, response)) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request,copy)).catch(() => {}));
      }
      return response;
    } catch {
      const cache = await caches.open(CACHE);
      // Same-origin owned static assets may carry Vary: Origin from the host.
      const cached = await cache.match(request, {ignoreVary:true});
      if (validShellResponse(request,cached)) return cached;
      if (request.mode === "navigate") {
        const home = await cache.match("/", {ignoreVary:true});
        if (home?.ok && (home.headers.get("content-type") || "").includes("text/html")) return home;
      }
      return Response.error();
    }
  })());
});
// Window inventory only; no backup data or credentials pass through the worker.
self.addEventListener("message", (event) => {
  if (event.data?.type === "claudia-restore-lease-v1" && event.ports[0]) {
    event.waitUntil((async () => {
      const {action,token}=event.data;
      const reply=value=>event.ports[0].postMessage(value);
      if (!event.source?.id || typeof token!=="string") return reply({ok:false});
      if(action==="release") {
        if(restoreLease?.owner===event.source.id && restoreLease.token===token) restoreLease=undefined;
        return reply({ok:true});
      }
      if(action!=="acquire" && action!=="renew") return reply({ok:false});
      if(action==="renew" && !liveRestore()) return reply({ok:false});
      if(liveRestore() && (restoreLease.owner!==event.source.id || restoreLease.token!==token)) return reply({ok:false});
      restoreLease={owner:event.source.id,token,until:Date.now()+30000};
      const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
      if(clients.length!==1 || clients[0].id!==event.source.id) {restoreLease=undefined;return reply({ok:false});}
      reply({ok:true,until:restoreLease.until});
    })());
    return;
  }
  if (event.data?.type !== "claudia-backup-clients-v1" || !event.ports[0])
    return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => event.ports[0].postMessage({ count: clients.length })),
  );
});
