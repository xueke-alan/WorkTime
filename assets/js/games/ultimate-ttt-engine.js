"use strict";

// Raw binary resources are shared across engine instances, never serialized as Base64.
WorkTimeApp.games.utttaiResources = (() => {
  const base = "assets/vendor/utttai/";
  const cacheName = "worktime-utttai-binaries-v1";
  let manifestLoading;
  const inFlight = new Map();
  function url(path) {
    const version = WorkTimeApp.data.assetVersions?.[path];
    return new URL(path + (version ? "?v=" + version : ""), document.baseURI)
      .href;
  }
  function manifest(priority = "auto") {
    if (!manifestLoading)
      manifestLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.fetchPriority = priority;
        const timer = setTimeout(() => {
          script.onload = script.onerror = null;
          script.remove();
          reject(Error("Engine manifest timed out"));
        }, 30000);
        script.src = url(base + "manifest.js");
        script.onload = () => {
          clearTimeout(timer);
          script.remove();
          resolve(WorkTimeApp.games.utttaiAssets);
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
          action(await root.getDirectoryHandle("utttai", { create: true })),
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
  async function readResource(info, priority) {
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
        priority,
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
      else if (storage)
        await storage.put(
          target,
          new Response(blob, {
            headers: { "Content-Length": String(info.size) },
          }),
        );
      else throw Error("Unable to persist engine resources");
    })();
    return { bytes, persistence };
  }
  function resource(info, priority) {
    if (inFlight.has(info.name)) return inFlight.get(info.name);
    const task = readResource(info, priority);
    inFlight.set(info.name, task);
    const release = () => {
      if (inFlight.get(info.name) === task) inFlight.delete(info.name);
    };
    // Retain shared bytes until saving ends, including when a foreground load joins.
    task.then((result) => result.persistence).then(release, release);
    return task;
  }
  async function cached(info) {
    const target = url(base + info.name);
    const disk = await directory(async (folder) => {
      try {
        return (
          (await (await folder.getFileHandle(info.name)).getFile()).size ===
          info.size
        );
      } catch {
        return false;
      }
    });
    const storage = await cache();
    if (disk) {
      await storage?.delete(target).catch(() => {});
      return true;
    }
    try {
      const response = await storage?.match(target);
      if (!response) return false;
      const size = response.headers.get("Content-Length");
      return size !== null
        ? Number(size) === info.size
        : (await response.blob()).size === info.size;
    } catch {
      return false;
    }
  }
  async function cleanup(assets) {
    const keep = new Set(
      Object.values(assets)
        .filter((info) => info && typeof info.name === "string")
        .map((info) => info.name),
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
          /^(ort-wasm.*\.wasm|policy_value_net.*\.onnx)$/.test(name) &&
          !keep.has(name)
        )
          await folder.removeEntry(name);
    });
  }
  async function prefetch() {
    if (!/^https?:$/.test(location.protocol)) return;
    const assets = await manifest("low");
    await Promise.all(
      Object.values(assets)
        .filter((info) => info && typeof info.name === "string")
        .map(async (info) => {
          if (!inFlight.has(info.name) && (await cached(info))) return;
          const result = await resource(info, "low");
          await result.persistence;
        }),
    );
    await cleanup(assets);
  }
  async function load() {
    const assets = await manifest("high");
    const [wasm, model] = await Promise.all([
      resource(assets.wasm, "high"),
      resource(assets.model, "high"),
    ]);
    void Promise.all([wasm.persistence, model.persistence])
      .then(() => cleanup(assets))
      .catch(() => {});
    // Every consumer owns its buffers; one transfer must not detach another load.
    return { wasm: wasm.bytes.slice(0), model: model.bytes.slice(0) };
  }
  return { load, prefetch, url };
})();

WorkTimeApp.games.createUltimateTttEngine = function () {
  let worker = null,
    loading = null,
    pending = null,
    disposed = false,
    sequence = 0,
    generation = 0;
  let rejectLoad = null,
    timer = null;
  const budgets = { easy: 200, normal: 1000, hard: 3000 };
  function cancel() {
    generation++;
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
    loading = null;
    rejectLoad?.(Error("Engine cancelled"));
    rejectLoad = null;
    pending?.reject(Error("Search cancelled"));
    pending = null;
  }
  function load() {
    if (disposed) return Promise.reject(Error("Engine disposed"));
    if (loading) return loading;
    const token = ++generation;
    loading = new Promise((resolve, reject) => {
      rejectLoad = reject;
      timer = setTimeout(
        () => fail(Error("Engine initialization timed out")),
        120000,
      );
      async function start() {
        const assets = WorkTimeApp.services.assets;
        await assets.script("assets/vendor/utttai/worker-source.js");
        if (disposed || token !== generation) return;
        let bytes, offline;
        if (location.protocol === "file:") {
          await assets.script("assets/vendor/utttai/offline.js");
          offline = WorkTimeApp.games.utttaiAssets.offline;
        } else bytes = await WorkTimeApp.games.utttaiResources.load();
        if (disposed || token !== generation) return;
        const url = URL.createObjectURL(
          new Blob([WorkTimeApp.games.utttaiAssets.worker], {
            type: "text/javascript",
          }),
        );
        try {
          worker = new Worker(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        worker.onerror = (event) => {
          event.preventDefault();
          fail(Error(event.message || "Worker failed"));
        };
        worker.onmessage = ({ data }) => {
          if (token !== generation) return;
          if (data.type === "ready") {
            clearTimeout(timer);
            rejectLoad = null;
            resolve(data);
          } else if (data.type === "error") fail(Error(data.message));
          else if (data.type === "result" && pending?.id === data.id) {
            clearTimeout(timer);
            const request = pending;
            pending = null;
            if (
              !WorkTimeApp.games.ultimateTttRules
                .legal(request.state)
                .includes(data.move) ||
              !data.simulations ||
              data.model !== "stage2-100000"
            ) {
              request.reject(Error("Invalid engine move"));
              cancel();
            } else request.resolve(data);
          }
        };
        if (offline) worker.postMessage({ type: "init", offline });
        else
          worker.postMessage({ type: "init", ...bytes }, [
            bytes.wasm,
            bytes.model,
          ]);
      }
      function fail(error) {
        if (token !== generation) return;
        reject(error);
        pending?.reject(error);
        cancel();
      }
      start().catch(fail);
    });
    return loading;
  }
  return {
    load,
    cancel,
    budgets,
    async search(state, difficulty) {
      const token = generation;
      await load();
      if (disposed || !worker || (token && token !== generation))
        throw Error("Engine cancelled");
      if (pending) throw Error("Search already running");
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending = { id, resolve, reject, state };
        timer = setTimeout(() => {
          reject(Error("Search timed out"));
          cancel();
        }, budgets[difficulty] + 15000);
        worker.postMessage({
          type: "search",
          id,
          path: state.path,
          chain: state.chain,
          difficulty,
          budget: budgets[difficulty],
        });
      });
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
};
