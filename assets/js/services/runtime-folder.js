"use strict";
/** Device-local directory capability; deliberately excluded from archive serialization. */
WorkTimeApp.services.runtimeFolder = (() => {
  let database,
    initialization,
    handle = null,
    status = "loading",
    busy = false,
    layoutVersion = 0,
    candidate = null,
    revision = 0,
    progress = "",
    detail = "",
    imports = 0,
    importQueue = Promise.resolve(),
    reloadPending = false,
    closed = false;
  let migration = [];
  const listeners = new Set();
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel("worktime-runtime-folder")
      : null;
  window.addEventListener(
    "pagehide",
    () => {
      closed = true;
      channel?.close();
      void database?.then((db) => db.close()).catch(() => {});
    },
    { once: true },
  );
  channel?.addEventListener("message", () => {
    reloadPending = true;
    void reload();
  });
  const supported = () => typeof window.showDirectoryPicker === "function";
  function notify() {
    listeners.forEach((listener) => listener());
    void reload();
  }
  async function reload() {
    if (closed || !reloadPending || busy || imports) return;
    reloadPending = false;
    try {
      // Coalesce broadcasts and serialize reloading with local and remote writes.
      await run(() =>
        locked(async () => {
          initialization = null;
          candidate = null;
          await initialize();
          revision++;
          document.dispatchEvent(new Event("worktime:runtimefolderchange"));
        }),
      );
    } catch {
      status = "storageFailed";
      notify();
    }
  }
  function fail(code, message = "") {
    detail = message;
    status = code;
    notify();
    return Object.assign(Error(code), { folderCode: code });
  }
  function open() {
    if (!database)
      database = new Promise((resolve, reject) => {
        let failed = false;
        const request = indexedDB.open("worktime-backup-folder", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("settings");
        request.onsuccess = () => {
          const db = request.result;
          if (failed) {
            db.close();
            return;
          }
          db.onversionchange = () => {
            db.close();
            database = null;
          };
          resolve(db);
        };
        request.onerror = () => {
          failed = true;
          reject(request.error || Error("Storage unavailable"));
        };
        request.onblocked = () => {
          failed = true;
          reject(Error("Storage blocked"));
        };
      }).catch((error) => {
        database = null;
        throw error;
      });
    return database;
  }
  async function store(value, aliases = []) {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      const settings = tx.objectStore("settings");
      if (value)
        settings.put(
          { handle: value, layoutVersion: 1, migration: aliases },
          "runtime",
        );
      else {
        settings.delete("runtime");
        settings.delete("directory");
      }
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () =>
        reject(tx.error || Error("Storage unavailable"));
    });
  }
  async function refreshPermission() {
    if (!supported()) {
      status = "unsupported";
      return;
    }
    if (!handle) {
      status = "needsInitialization";
      return;
    }
    try {
      status =
        (await handle.queryPermission({ mode: "readwrite" })) === "granted"
          ? layoutVersion === 1
            ? "available"
            : "needsInitialization"
          : "permission";
    } catch {
      status = "failed";
    }
  }
  function initialize() {
    if (!initialization)
      initialization = (async () => {
        try {
          const db = await open();
          handle = await new Promise((resolve, reject) => {
            const tx = db.transaction("settings");
            const request = tx.objectStore("settings").get("runtime");
            let value;
            request.onsuccess = () => {
              value = request.result;
              if (!value) {
                const legacy = tx.objectStore("settings").get("directory");
                legacy.onsuccess = () => {
                  value = legacy.result
                    ? { handle: legacy.result, layoutVersion: 0 }
                    : null;
                };
              }
            };
            tx.oncomplete = () => resolve(value || null);
            tx.onabort = tx.onerror = () =>
              reject(tx.error || Error("Storage unavailable"));
          });
          layoutVersion = handle?.layoutVersion || 0;
          migration = handle?.migration || [];
          handle = handle?.handle || null;
          await refreshPermission();
        } catch {
          status = "storageFailed";
        }
        notify();
      })();
    return initialization;
  }
  async function run(action, importing = false) {
    if (busy || (imports && !importing))
      throw Object.assign(Error("busy"), { folderCode: "busy" });
    busy = true;
    notify();
    try {
      return await action();
    } finally {
      busy = false;
      notify();
    }
  }
  // Call picker/permission APIs before awaiting anything to preserve the click gesture.
  function choose() {
    if (!supported()) return Promise.reject(fail("unsupported"));
    return run(async () => {
      let selected;
      try {
        selected = await window.showDirectoryPicker({
          mode: "readwrite",
          id: "worktime-auto-backup",
        });
      } catch (error) {
        if (error.name === "AbortError") return false;
        throw fail(
          ["SecurityError", "NotSupportedError"].includes(error.name)
            ? "unsupported"
            : error.name === "NotAllowedError"
              ? "permission"
              : "failed",
        );
      }
      await initialize();
      return locked(() => configure(selected));
    });
  }
  function reset() {
    return run(() =>
      locked(async () => {
        await initialize();
        try {
          await store(null);
        } catch {
          throw fail("storageFailed");
        }
        handle = candidate = null;
        migration = [];
        layoutVersion = 0;
        status = "needsInitialization";
        changed();
        document.dispatchEvent(new Event("worktime:folderreset"));
        return true;
      }),
    );
  }
  // A selection is a proposal, never the active handle or recovery candidate.
  function pickReplacement() {
    if (!supported()) return Promise.reject(Error("unsupported"));
    return run(async () => {
      let selected;
      try {
        selected = await window.showDirectoryPicker({
          mode: "readwrite",
          id: "worktime-auto-backup",
        });
      } catch (error) {
        if (error.name === "AbortError") return null;
        throw error;
      }
      await initialize();
      return { selected, source: handle };
    });
  }
  function changeFolder(
    selection,
    { migrate = false, signal, progress: report = () => {} } = {},
  ) {
    return run(() =>
      locked(async () => {
        initialization = null;
        await initialize();
        const source = handle;
        const previousStatus = status;
        const check = () => {
          if (signal?.aborted)
            throw new DOMException("Cancelled", "AbortError");
        };
        try {
          if (
            !source ||
            !selection?.source ||
            !(await source.isSameEntry(selection.source))
          )
            throw Object.assign(Error("sourceChanged"), {
              folderCode: "sourceChanged",
            });
          const target = selection.selected;
          if (await source.isSameEntry(target))
            throw Object.assign(Error("sameFolder"), {
              folderCode: "sameFolder",
            });
          if (
            (await source.resolve(target)) !== null ||
            (await target.resolve(source)) !== null
          )
            throw Object.assign(Error("nestedFolder"), {
              folderCode: "nestedFolder",
            });
          if (
            (await target.queryPermission({ mode: "readwrite" })) !== "granted"
          )
            throw Object.assign(Error("permission"), {
              folderCode: "permission",
            });
          if (
            migrate &&
            (await source.queryPermission({ mode: "readwrite" })) !== "granted"
          )
            throw Object.assign(Error("sourcePermission"), {
              folderCode: "sourcePermission",
            });
          await WorkTimeApp.services.assets.script(
            "assets/js/services/runtime-migration.js",
          );
          const result = await WorkTimeApp.services.runtimeMigration.copy(
            source,
            target,
            { migrate, signal, progress: report },
          );
          check();
          const aliases = migrate
            ? result.music.map((item) => ({
                path: item.path,
                fingerprints: [
                  ...new Set([
                    ...(migration.find(
                      (old) =>
                        old.path === item.path &&
                        old.fingerprints.includes(item.before),
                    )?.fingerprints || []),
                    item.before,
                    item.after,
                  ]),
                ],
              }))
            : [];
          report({ ...result, phase: "saving" });
          check();
          // No cancellation after the atomic IndexedDB commit begins.
          try {
            await store(target, aliases);
          } catch (error) {
            error.folderCode = "storageFailed";
            throw error;
          }
          handle = target;
          candidate = null;
          migration = aliases;
          layoutVersion = 1;
          status = "available";
          detail = progress = "";
          changed();
          notify();
          return result;
        } catch (error) {
          // Replacement failures never turn a proposal into the recovery target.
          status = previousStatus;
          notify();
          throw error;
        }
      }),
    );
  }
  function authorize() {
    return run(async () => {
      const selected = candidate || handle;
      if (!selected) throw fail("needsInitialization");
      try {
        if (
          (await selected.requestPermission({ mode: "readwrite" })) !==
          "granted"
        )
          throw fail("permission");
      } catch (error) {
        throw fail(error.folderCode || "permission");
      }
      return locked(() => configure(selected));
    });
  }
  function write(name, text, { kind } = {}) {
    if (!["automatic", "manual"].includes(kind))
      return Promise.reject(Error("Invalid backup kind"));
    if (
      !name ||
      /[\\/\u0000-\u001f]/.test(name) ||
      name === "." ||
      name === ".."
    )
      return Promise.reject(Error("Invalid backup filename"));
    return run(() =>
      locked(async () => {
        if (candidate || status === "storageFailed")
          throw fail(
            status === "available" ? "needsInitialization" : status,
            detail,
          );
        // Read the committed root while holding the same lock as folder switching.
        initialization = null;
        await initialize();
        const backups = await getDirectory("backups");
        const directory = await prepareBackups(backups, kind);
        let writable;
        let uniqueName;
        try {
          // A UUID also protects files created in the same second or another page.
          const dot = name.lastIndexOf(".");
          uniqueName =
            name.slice(0, dot) + "-" + crypto.randomUUID() + name.slice(dot);
          const file = await directory.getFileHandle(uniqueName, {
            create: true,
          });
          writable = await file.createWritable();
          await writable.write(text);
          await writable.close();
          status = "available";
          detail = "";
          return true;
        } catch (error) {
          try {
            await writable?.abort();
          } catch {}
          try {
            if (uniqueName) await directory.removeEntry(uniqueName);
          } catch {}
          throw fail(
            error.name === "NotAllowedError" ? "permission" : "failed",
            "backups/" + kind,
          );
        }
      }),
    );
  }
  async function prepareBackups(backups, selectedKind) {
    let selected;
    for (const kind of ["automatic", "manual"]) {
      try {
        const directory = await backups.getDirectoryHandle(kind, {
          create: true,
        });
        if (kind === selectedKind) selected = directory;
      } catch (error) {
        throw fail(
          error.name === "TypeMismatchError"
            ? "conflict"
            : error.name === "NotAllowedError"
              ? "permission"
              : "failed",
          "backups/" + kind,
        );
      }
    }
    return selected;
  }
  function locked(action) {
    return navigator.locks
      ? navigator.locks.request("worktime-runtime-folder", action)
      : action();
  }
  function changed() {
    revision++;
    if (closed) return;
    channel?.postMessage("changed");
    document.dispatchEvent(new Event("worktime:runtimefolderchange"));
  }
  async function configure(selected) {
    candidate = selected;
    if ((await selected.queryPermission({ mode: "readwrite" })) !== "granted")
      throw fail("permission");
    status = "initializing";
    detail = "";
    notify();
    for (const name of ["backups", "ebooks", "music"]) {
      progress = name;
      notify();
      try {
        const directory = await selected.getDirectoryHandle(name, {
          create: true,
        });
        if (name === "backups") await prepareBackups(directory);
      } catch (error) {
        if (error.folderCode) throw error;
        throw fail(
          error.name === "TypeMismatchError"
            ? "conflict"
            : error.name === "NotAllowedError"
              ? "permission"
              : "failed",
          name,
        );
      }
    }
    const aliases =
      handle && (await handle.isSameEntry(selected)) ? migration : [];
    try {
      await store(selected, aliases);
    } catch {
      throw fail("storageFailed");
    }
    handle = selected;
    migration = aliases;
    candidate = null;
    layoutVersion = 1;
    progress = "";
    await refreshPermission();
    changed();
    notify();
    if (status !== "available") throw fail(status, selected.name);
    return true;
  }
  async function getDirectory(kind) {
    if (!["backups", "ebooks", "music"].includes(kind))
      throw Error("Invalid runtime directory");
    await initialize();
    if (status === "storageFailed") throw fail("storageFailed");
    if (candidate)
      throw fail(
        status === "initializing"
          ? "busy"
          : ["conflict", "permission", "failed"].includes(status)
            ? status
            : "needsInitialization",
        detail || progress,
      );
    await refreshPermission();
    if (status !== "available") throw fail(status);
    try {
      return await handle.getDirectoryHandle(kind);
    } catch (error) {
      throw fail(
        error.name === "NotAllowedError" ? "permission" : "needsInitialization",
        kind,
      );
    }
  }
  // Optional, disposable dependencies never request permission or alter media status.
  async function withDependencies(action) {
    await initialize();
    if (
      closed ||
      busy ||
      imports ||
      candidate ||
      !handle ||
      layoutVersion !== 1
    )
      return null;
    const selected = handle;
    return locked(async () => {
      if (busy || imports || candidate || handle !== selected) return null;
      if ((await selected.queryPermission({ mode: "readwrite" })) !== "granted")
        return null;
      const directory = await selected.getDirectoryHandle("dependencies", {
        create: true,
      });
      return action(directory);
    });
  }
  function importFiles(kind, files, options = {}) {
    if (busy)
      return Promise.reject(
        Object.assign(Error("busy"), { folderCode: "busy" }),
      );
    if (!["music", "ebooks"].includes(kind))
      return Promise.reject(Error("Invalid media kind"));
    const selected = [...files];
    imports++;
    notify();
    const operation = async () => {
      if (busy)
        await new Promise((resolve) => {
          const listener = () => {
            if (!busy) {
              listeners.delete(listener);
              resolve();
            }
          };
          listeners.add(listener);
        });
      return run(
        () =>
          locked(async () => {
            initialization = null;
            await initialize();
            const directory = await getDirectory(kind);
            await WorkTimeApp.services.assets.script(
              "assets/js/services/runtime-import.js",
            );
            return WorkTimeApp.services.runtimeImport.copy(
              directory,
              kind,
              selected,
              options,
            );
          }),
        true,
      );
    };
    const task = importQueue.catch(() => {}).then(operation);
    importQueue = task;
    return task.finally(() => {
      imports--;
      notify();
    });
  }
  return {
    initialize,
    choose,
    pickReplacement,
    changeFolder,
    reset,
    authorize,
    write,
    getDirectory,
    withDependencies,
    importFiles,
    get state() {
      return {
        name: (handle || candidate)?.name || "",
        pendingName: candidate?.name || "",
        status,
        busy: busy || imports > 0,
        supported: supported(),
        layoutVersion,
        revision,
        progress,
        detail,
        migration,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();
