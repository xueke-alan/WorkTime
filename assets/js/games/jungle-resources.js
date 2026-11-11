"use strict";

WorkTimeApp.games.jungleResources = (() => {
  const base = "assets/vendor/misty-jungle/";
  const cacheName = "worktime-misty-jungle-binaries-v1";
  let loading = null;
  function url(path) {
    const version = WorkTimeApp.data.assetVersions?.[path];
    return new URL(path + (version ? "?v=" + version : ""), document.baseURI)
      .href;
  }
  async function directory(action) {
    try {
      return await WorkTimeApp.services.runtimeFolder?.withDependencies(
        async (root) =>
          action(
            await root.getDirectoryHandle("misty-jungle", { create: true }),
          ),
      );
    } catch {
      return null;
    }
  }
  async function valid(bytes, info) {
    if (bytes.byteLength !== info.size) return false;
    return (
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("") === info.hash
    );
  }
  async function read(priority) {
    const { assets } = WorkTimeApp.services;
    await assets.script(base + "manifest.js", { fetchPriority: priority });
    const info = WorkTimeApp.games.mistyJungleResources;
    const resourceUrl = new URL(url(base + info.name));
    resourceUrl.searchParams.set("sha256", info.hash);
    const target = resourceUrl.href;
    let storage = null;
    try {
      storage = await caches.open(cacheName);
    } catch {
      // Folder and network loading also work without Cache Storage.
    }
    const disk = await directory(async (folder) => {
      try {
        const bytes = await (
          await (await folder.getFileHandle(info.name)).getFile()
        ).arrayBuffer();
        return (await valid(bytes, info)) ? bytes : null;
      } catch {
        return null;
      }
    });
    async function clearBrowserCopies() {
      if (storage)
        for (const request of await storage.keys())
          await storage.delete(request);
    }
    if (disk) {
      await clearBrowserCopies().catch(() => {});
      return disk;
    }
    let bytes = null;
    try {
      const response = await storage?.match(target);
      if (response) {
        const cached = await response.arrayBuffer();
        if (await valid(cached, info)) bytes = cached;
        else await storage.delete(target);
      }
    } catch {
      // Retry corrupt or inaccessible cache entries from the network.
    }
    if (!bytes) {
      const response = await fetch(target, {
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
        priority,
      });
      if (!response.ok) throw Error("Unable to download Jungle engine");
      bytes = await response.arrayBuffer();
      if (!(await valid(bytes, info)))
        throw Error("Jungle engine integrity check failed");
    }
    const saved = await directory(async (folder) => {
      const file = await folder.getFileHandle(info.name, { create: true });
      const writable = await file.createWritable();
      try {
        await writable.write(new Blob([bytes]));
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
      return true;
    });
    try {
      if (saved) await clearBrowserCopies();
      else if (storage) {
        await storage.put(target, new Response(bytes));
        for (const request of await storage.keys())
          if (request.url !== target) await storage.delete(request);
      }
    } catch {
      // Persistence is optional; verified bytes remain usable for this match.
    }
    return bytes;
  }
  async function load(priority = "high") {
    if (!loading) {
      const task = read(priority);
      loading = task;
      const release = () => {
        if (loading === task) loading = null;
      };
      task.then(release, release);
    }
    // Each Worker owns its transferred bytes, even when sharing a download.
    return (await loading).slice(0);
  }
  async function prefetch() {
    if (/^https?:$/.test(location.protocol)) await load("low");
  }
  return { load, prefetch };
})();
