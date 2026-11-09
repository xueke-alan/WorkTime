const CACHE = "worktime-shell-3.0.0";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("./index.html")));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith("worktime-shell-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      ),
    ).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).then((response) => {
        const copy = response.clone();
        if (response.ok && new URL(event.request.url).origin === self.location.origin)
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
        return response;
      }).catch(async () =>
        (await (await caches.open(CACHE)).match(event.request)) || Response.error(),
      ),
  );
});
