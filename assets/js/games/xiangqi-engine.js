"use strict";

// Raw binary resources are shared across engine instances, never serialized as Base64.
WorkTimeApp.games.pikafishResources = (() => {
  const base = "assets/vendor/pikafish/";
  const cacheName = "worktime-pikafish-binaries-v1";
  let manifestLoading;
  let resourcesLoading;
  function url(path) {
    const version = WorkTimeApp.data.assetVersions?.[path];
    return new URL(path + (version ? "?v=" + version : ""), document.baseURI)
      .href;
  }
  function manifest() {
    if (!manifestLoading)
      manifestLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        const timer = setTimeout(() => {
          script.onload = script.onerror = null;
          script.remove();
          reject(Error("Engine manifest timed out"));
        }, 30000);
        script.src = url(base + "manifest.js");
        script.onload = () => {
          clearTimeout(timer);
          script.remove();
          resolve(WorkTimeApp.games.pikafishAssets);
        };
        script.onerror = () => {
          clearTimeout(timer);
          script.remove();
          reject(Error("Unable to load engine manifest"));
        };
        document.head.append(script);
      }).catch((error) => {
        manifestLoading = null;
        throw error;
      });
    return manifestLoading;
  }
  async function valid(bytes, resource) {
    if (bytes.byteLength !== resource.size) return false;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return (
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("") === resource.hash
    );
  }
  async function directory(action) {
    try {
      return await WorkTimeApp.services.runtimeFolder?.withDependencies(
        async (root) =>
          action(await root.getDirectoryHandle("pikafish", { create: true })),
      );
    } catch {
      return null;
    }
  }
  async function cache() {
    try {
      return await caches.open(cacheName);
    } catch {
      return null;
    }
  }
  async function resource(info) {
    const target = url(base + info.name);
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
    const storage = await cache();
    if (disk) {
      // A durable folder copy replaces the app-managed browser copy.
      if (storage) void storage.delete(target).catch(() => {});
      return { bytes: disk, persistence: Promise.resolve() };
    }
    let bytes;
    try {
      const response = await storage?.match(target);
      if (response) {
        const cached = await response.arrayBuffer();
        if (await valid(cached, info)) bytes = cached;
        else await storage.delete(target);
      }
    } catch {
      /* A cache failure must not prevent a network fallback. */
    }
    if (!bytes) {
      const response = await fetch(target, {
        cache: "no-store",
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw Error("Unable to download engine resource");
      bytes = await response.arrayBuffer();
      if (!(await valid(bytes, info)))
        throw Error("Engine resource integrity check failed");
    }
    // Snapshot before transferring the ArrayBuffer to the Worker.
    const blob = new Blob([bytes]);
    const persistence = (async () => {
      const saved = await directory(async (folder) => {
        const file = await folder.getFileHandle(info.name, { create: true });
        const writable = await file.createWritable();
        try {
          await writable.write(blob);
          await writable.close();
        } catch (error) {
          await writable.abort().catch(() => {});
          throw error;
        }
        return true;
      });
      if (saved) await storage?.delete(target);
      else if (storage) await storage.put(target, new Response(blob));
    })().catch(() => {});
    return { bytes, persistence };
  }
  async function load() {
    // Only coalesce concurrent loads; detached buffers must never be reused.
    if (!resourcesLoading)
      resourcesLoading = (async () => {
        const assets = await manifest();
        const [wasm, net] = await Promise.all([
          resource(assets.wasm),
          resource(assets.net),
        ]);
        void Promise.all([wasm.persistence, net.persistence])
          .then(async () => {
            const keep = new Set(
              Object.values(assets).map((info) => info.name),
            );
            const storage = await cache();
            if (storage)
              for (const request of await storage.keys())
                if (!keep.has(new URL(request.url).pathname.split("/").pop()))
                  await storage.delete(request);
            await directory(async (folder) => {
              for await (const [name, entry] of folder.entries())
                if (
                  entry.kind === "file" &&
                  /^(wasm|net)-[a-f0-9]{16}\.(wasm|nnue)$/.test(name) &&
                  !keep.has(name)
                )
                  await folder.removeEntry(name);
            });
          })
          .catch(() => {});
        return { wasm: wasm.bytes, net: net.bytes };
      })().finally(() => {
        resourcesLoading = null;
      });
    // Every consumer owns its buffers; one transfer must not detach another load.
    const bytes = await resourcesLoading;
    return { wasm: bytes.wasm.slice(0), net: bytes.net.slice(0) };
  }
  return { load, url };
})();

WorkTimeApp.games.createXiangqiEngine = function () {
  let worker = null,
    loading = null,
    sequence = 0,
    disposed = false;
  let rejectLoading = null,
    loadTimer = null,
    generation = 0,
    resourceScript = null;
  const pending = new Map();
  function fail(error) {
    generation++;
    clearTimeout(loadTimer);
    if (resourceScript) {
      resourceScript.onload = resourceScript.onerror = null;
      resourceScript.remove();
      resourceScript = null;
    }
    rejectLoading?.(error);
    rejectLoading = null;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
    loading = null;
  }
  function load() {
    if (disposed) return Promise.reject(Error("Engine disposed"));
    if (loading) return loading;
    const token = ++generation;
    loading = new Promise((resolve, reject) => {
      rejectLoading = reject;
      loadTimer = setTimeout(
        () => fail(Error("Engine initialization timed out")),
        120000,
      );
      const start = (bytes = null) => {
        if (disposed || token !== generation) return;
        let blobUrl;
        try {
          const source = bytes
            ? WorkTimeApp.games.pikafishResources.url(
                "assets/vendor/pikafish/worker.js",
              )
            : (blobUrl = URL.createObjectURL(
                new Blob([WorkTimeApp.games.pikafishWorkerSource], {
                  type: "text/javascript",
                }),
              ));
          worker = new Worker(source);
          worker.onerror = (event) => {
            if (token === generation)
              fail(Error(event.message || "Engine failed"));
          };
          worker.onmessage = ({ data }) => {
            if (token !== generation) return;
            if (data.type === "ready") {
              clearTimeout(loadTimer);
              rejectLoading = null;
              resolve();
            } else if (data.type === "error") fail(Error(data.message));
            else if (data.type === "move") {
              const request = pending.get(data.id);
              pending.delete(data.id);
              request?.resolve(data.move);
            }
          };
          if (bytes)
            worker.postMessage({ type: "init", ...bytes }, [
              bytes.wasm,
              bytes.net,
            ]);
        } catch (error) {
          fail(error);
          reject(error);
        } finally {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
        }
      };
      if (location.protocol !== "file:") {
        WorkTimeApp.games.pikafishResources
          .load()
          .then(start)
          .catch((error) => {
            if (token === generation) fail(error);
          });
      } else if (WorkTimeApp.games.pikafishWorkerSource) start();
      else {
        const script = document.createElement("script");
        resourceScript = script;
        script.src = WorkTimeApp.games.pikafishResources.url(
          "assets/vendor/pikafish/engine.js",
        );
        script.onload = () => {
          script.remove();
          if (token !== generation) return;
          resourceScript = null;
          start();
        };
        script.onerror = () => {
          if (token === generation)
            fail(Error("Unable to load local Pikafish resources"));
        };
        document.head.append(script);
      }
    });
    return loading;
  }
  return {
    load,
    get busy() {
      return pending.size > 0;
    },
    async search(fen, difficulty) {
      await load();
      if (disposed) throw Error("Engine disposed");
      if (!worker) throw Error("Engine unavailable");
      if (pending.size) throw Error("Search already running");
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: "search", id, fen, difficulty });
      });
    },
    dispose() {
      disposed = true;
      fail(Error("Engine disposed"));
    },
  };
};
