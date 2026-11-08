const CACHE = "worktime-shell-2.5.0";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("./index.html")));
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).then((response) => {
        const copy = response.clone();
        if (response.ok && new URL(event.request.url).origin === self.location.origin)
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
        return response;
      }).catch(async () => (await caches.match(event.request)) || Response.error()),
  );
});
