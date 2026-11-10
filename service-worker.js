const CACHE = "worktime-shell-3.1.0";
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
    ).then(async () => {
      const cache = await caches.open(CACHE);
      // Retire the previous monolithic engine and any shell-cached binaries.
      for (const request of await cache.keys())
        if (/\/assets\/vendor\/(pikafish|utttai)\//.test(new URL(request.url).pathname))
          await cache.delete(request);
      await self.clients.claim();
    }),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // The engine manages its binary cache and optional runtime-folder copy itself.
  // Bypass shell caching to avoid duplicate 50 MB models and network-first reads.
  const url = new URL(event.request.url);
  if (/\/assets\/vendor\/(pikafish|utttai)\//.test(url.pathname)) {
    if (!/\/(manifest|worker|worker-source)\.js$/.test(url.pathname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(event.request);
      if (cached && url.searchParams.has("v")) return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }
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
