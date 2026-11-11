/* The generated manifest follows source and published entry URLs exactly. */
importScripts("./offline-shell.js");
const SHELL = self.WORKTIME_SHELL;
const CACHE = SHELL.cache;
const ENTRY = new URL("./index.html", self.registration.scope).href;
const PRECACHE = new Set(
  SHELL.assets.map((asset) => new URL(asset, self.registration.scope).href),
);
self.addEventListener("install", (event) => {
  // A failed dependency keeps the previous worker and its complete shell active.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          [...PRECACHE].map((url) => new Request(url, { cache: "reload" })),
        ),
      ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("worktime-shell-") && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    !url.href.startsWith(self.registration.scope)
  )
    return;
  // Engines own their large binary/offline packages, avoiding duplicate model storage.
  if (
    /\/assets\/vendor\/(pikafish|utttai|rapfi|misty-jungle)\//.test(
      url.pathname,
    ) &&
    !/\/(manifest|worker|worker-source)\.js$/.test(url.pathname)
  )
    return;
  const navigation = event.request.mode === "navigate";
  const isEntry =
    url.pathname === new URL(ENTRY).pathname ||
    url.href.split(/[?#]/)[0] === self.registration.scope;
  const immutable =
    url.searchParams.has("v") && /\/assets\//.test(url.pathname);
  const cachedFirst = !navigation && (immutable || PRECACHE.has(url.href));
  async function network(cache) {
    const response = await fetch(event.request);
    // Keep the installed entry paired with the assets from the same build.
    if (response.ok && response.type !== "opaque" && !(navigation && isEntry)) {
      try {
        await cache.put(event.request, response.clone());
        // Bound historical content-hash variants of dynamically loaded assets.
        if (immutable)
          for (const request of await cache.keys())
            if (
              request.url !== url.href &&
              new URL(request.url).pathname === url.pathname &&
              !PRECACHE.has(request.url)
            )
              await cache.delete(request);
      } catch {
        // Quota/cache failures must never hide a successful network response.
      }
    }
    return response;
  }
  const background = [];
  const response = (async () => {
    let cache, cached;
    try {
      cache = await caches.open(CACHE);
      cached = await cache.match(navigation && isEntry ? ENTRY : event.request);
    } catch {
      // Private browsing or storage pressure can disable CacheStorage.
    }
    if (cachedFirst && cached) return cached;
    const request = network(cache);
    background.push(request);
    if (navigation && cached) {
      // A slow connection should not block an installed application's cached entry.
      let timer;
      try {
        return await Promise.race([
          request
            .then((response) => (response.ok ? response : cached))
            .catch(() => cached),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(cached), 3000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      const response = await request;
      return !response.ok && cached ? cached : response;
    } catch {
      return cached || Response.error();
    }
  })();
  event.respondWith(response);
  event.waitUntil(response.then(() => Promise.allSettled(background)));
});
