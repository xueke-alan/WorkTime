"use strict";
/** Device-local directory capability; deliberately excluded from archive serialization. */
WorkTimeApp.services.autoBackupFolder = (() => {
  let database,
    initialization,
    handle = null,
    status = "loading",
    busy = false;
  const listeners = new Set();
  const supported = () => typeof window.showDirectoryPicker === "function";
  const notify = () => listeners.forEach((listener) => listener());
  function fail(code) {
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
  async function store(value) {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      const settings = tx.objectStore("settings");
      if (value) settings.put(value, "directory");
      else settings.delete("directory");
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () =>
        reject(tx.error || Error("Storage unavailable"));
    });
  }
  async function refreshPermission() {
    if (!handle) {
      status = "download";
      return;
    }
    if (!supported()) {
      status = "unsupported";
      return;
    }
    try {
      status =
        (await handle.queryPermission({ mode: "readwrite" })) === "granted"
          ? "available"
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
            const request = tx.objectStore("settings").get("directory");
            let value;
            request.onsuccess = () => {
              value = request.result;
            };
            tx.oncomplete = () => resolve(value || null);
            tx.onabort = tx.onerror = () =>
              reject(tx.error || Error("Storage unavailable"));
          });
          await refreshPermission();
        } catch {
          status = "storageFailed";
        }
        notify();
      })();
    return initialization;
  }
  async function run(action) {
    if (busy) throw Object.assign(Error("busy"), { folderCode: "busy" });
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
      let candidate;
      try {
        candidate = await window.showDirectoryPicker({
          mode: "readwrite",
          id: "worktime-auto-backup",
        });
      } catch (error) {
        if (error.name === "AbortError") return false;
        throw fail("failed");
      }
      await initialize();
      try {
        await store(candidate);
      } catch {
        throw fail("storageFailed");
      }
      handle = candidate;
      await refreshPermission();
      return true;
    });
  }
  function reset() {
    return run(async () => {
      await initialize();
      try {
        await store(null);
      } catch {
        throw fail("storageFailed");
      }
      handle = null;
      status = "download";
      document.dispatchEvent(new Event("worktime:folderreset"));
      return true;
    });
  }
  function authorize() {
    return run(async () => {
      if (!handle) throw fail("failed");
      try {
        if (
          (await handle.requestPermission({ mode: "readwrite" })) !== "granted"
        )
          throw fail("permission");
      } catch (error) {
        throw fail(error.folderCode || "permission");
      }
      status = "available";
      return true;
    });
  }
  function write(name, text) {
    return run(async () => {
      await initialize();
      if (status === "storageFailed") throw fail("storageFailed");
      if (!handle) return false;
      await refreshPermission();
      if (status !== "available") throw fail(status);
      let writable;
      try {
        // A UUID also protects files created in the same second or another page.
        const dot = name.lastIndexOf(".");
        const uniqueName =
          name.slice(0, dot) + "-" + crypto.randomUUID() + name.slice(dot);
        const file = await handle.getFileHandle(uniqueName, { create: true });
        writable = await file.createWritable();
        await writable.write(text);
        await writable.close();
        status = "available";
        return true;
      } catch (error) {
        try {
          await writable?.abort();
        } catch {}
        throw fail(error.name === "NotAllowedError" ? "permission" : "failed");
      }
    });
  }
  return {
    initialize,
    choose,
    reset,
    authorize,
    write,
    get state() {
      return { name: handle?.name || "", status, busy, supported: supported() };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();
