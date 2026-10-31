const CACHE = "claudia-v1";
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["/", "/icon.svg"])),
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then(
            (cached) =>
              cached ||
              (event.request.mode === "navigate"
                ? caches.match("/")
                : Response.error()),
          ),
      ),
  );
});
// Window inventory only; no backup data or credentials pass through the worker.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "claudia-backup-clients-v1" || !event.ports[0])
    return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => event.ports[0].postMessage({ count: clients.length })),
  );
});
