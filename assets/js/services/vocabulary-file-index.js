"use strict";
// Metadata only. Audio payloads stay in the selected runtime folder.
WorkTimeApp.services.vocabularyFileIndex = (() => {
  let database;
  const request = (value) =>
    new Promise((resolve, reject) => {
      value.onsuccess = () => resolve(value.result);
      value.onerror = () => reject(value.error);
    });
  async function open() {
    if (!database)
      database = new Promise((resolve, reject) => {
        const value = indexedDB.open("worktime-vocabulary-file-index", 2);
        value.onupgradeneeded = (event) => {
          const db = value.result;
          const stores = ["entries", "pending", "directories", "identities"];
          const rebuild =
            event.oldVersion > 0 &&
            stores.some((name) => !db.objectStoreNames.contains(name));
          if (!db.objectStoreNames.contains("folders"))
            db.createObjectStore("folders", {
              keyPath: "id",
              autoIncrement: true,
            });
          for (const name of stores)
            if (!db.objectStoreNames.contains(name))
              db.createObjectStore(name, { keyPath: ["folder", "path"] });
          if (rebuild) {
            // Derived metadata can be rebuilt incrementally from the untouched
            // audio files. Old checkpoints must not skip those files on upgrade.
            for (const name of stores)
              value.transaction.objectStore(name).clear();
            const cursor = value.transaction
              .objectStore("folders")
              .openCursor();
            cursor.onsuccess = () => {
              const row = cursor.result;
              if (!row) return;
              row.update({
                ...row.value,
                bytes: 0,
                counts: {},
                revision: (row.value.revision || 0) + 1,
                indexStatus: "rebuilding",
              });
              row.continue();
            };
          }
        };
        value.onsuccess = () => {
          const db = value.result;
          db.onversionchange = () => {
            db.close();
            database = null;
          };
          resolve(db);
        };
        value.onerror = () => {
          database = null;
          reject(value.error);
        };
        value.onblocked = () => {
          database = null;
          reject(Error("Audio index is blocked"));
        };
      });
    return database;
  }
  async function transaction(names, mode, action) {
    const db = await open(),
      tx = db.transaction(names, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () =>
        reject(tx.error || Error("Audio index transaction failed"));
    });
    // Attach rejection handling before issuing requests, including aborts.
    void done.catch(() => {});
    try {
      const result = await action(tx);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already completed. */
      }
      await done.catch(() => {});
      throw error;
    }
  }
  const range = (folder, after = "") =>
    IDBKeyRange.bound([folder, after], [folder + 1], !!after, true);
  const prefix = (identity) => {
    try {
      return JSON.stringify(JSON.parse(identity).slice(0, -1));
    } catch {
      return "";
    }
  };
  async function accountIdentity(tx, summary, identity, sign) {
    if (!identity) return false;
    const store = tx.objectStore("identities"),
      id = [summary.id, identity],
      old = (await request(store.get(id)))?.count || 0,
      count = Math.max(0, old + sign);
    if (count) store.put({ folder: summary.id, path: identity, count });
    else store.delete(id);
    const name = prefix(identity);
    summary.counts[name] =
      (summary.counts[name] || 0) + Number(count > 0) - Number(old > 0);
    return count > 0;
  }
  async function update(tx, summary, rows) {
    const entries = tx.objectStore("entries"),
      changes = [];
    for (const row of rows) {
      const id = [summary.id, row.path];
      const old = await request(entries.get(id));
      // A delayed playback observation must not replace a newer disk write.
      if (row.observed && old?.modified > row.modified) continue;
      const nextIdentity = row.remove ? null : row.identity;
      let oldPresent = old?.identity === nextIdentity && !!nextIdentity;
      if (old?.identity !== nextIdentity) {
        oldPresent = await accountIdentity(tx, summary, old?.identity, -1);
        await accountIdentity(tx, summary, nextIdentity, 1);
      }
      summary.bytes -= old?.bytes || 0;
      if (row.remove) entries.delete(id);
      else {
        const next = { ...row, folder: summary.id };
        delete next.observed;
        entries.put(next);
        summary.bytes += next.bytes;
      }
      changes.push({
        old: old?.identity || null,
        next: row.remove ? null : row.identity,
        oldPresent,
      });
    }
    summary.revision++;
    tx.objectStore("folders").put(summary);
    return { summary, changes };
  }
  const locked = (name, action) =>
    navigator.locks ? navigator.locks.request(name, action) : action();
  return {
    prefix,
    async connect(handle) {
      return locked("worktime-vocabulary-index-folders", async () => {
        const folders = await transaction(["folders"], "readonly", (tx) =>
          request(tx.objectStore("folders").getAll()),
        );
        for (const folder of folders)
          if (await handle.isSameEntry(folder.handle)) return folder;
        return transaction(["folders"], "readwrite", async (tx) => {
          const folder = {
            handle,
            bytes: 0,
            counts: {},
            revision: 0,
            indexStatus: "rebuilding",
          };
          folder.id = await request(tx.objectStore("folders").add(folder));
          return folder;
        });
      });
    },
    get: (id) =>
      transaction(["folders"], "readonly", (tx) =>
        request(tx.objectStore("folders").get(id)),
      ),
    record: (id, path) =>
      transaction(["entries"], "readonly", (tx) =>
        request(tx.objectStore("entries").get([id, path])),
      ),
    list: (id, after = "", limit = 256) =>
      transaction(["entries"], "readonly", (tx) =>
        request(tx.objectStore("entries").getAll(range(id, after), limit)),
      ),
    pending: (id) =>
      transaction(["pending"], "readonly", (tx) =>
        request(tx.objectStore("pending").getAll(range(id))),
      ),
    directories: (id) =>
      transaction(["directories"], "readonly", (tx) =>
        request(tx.objectStore("directories").getAll(range(id))),
      ),
    checkpoint: (id, path) =>
      transaction(["directories"], "readwrite", (tx) =>
        request(tx.objectStore("directories").put({ folder: id, path })),
      ),
    apply: (id, rows) =>
      transaction(
        ["folders", "entries", "identities"],
        "readwrite",
        async (tx) =>
          update(tx, await request(tx.objectStore("folders").get(id)), rows),
      ),
    async status(id, indexStatus) {
      return transaction(["folders"], "readwrite", async (tx) => {
        const folder = await request(tx.objectStore("folders").get(id));
        folder.indexStatus = indexStatus;
        folder.revision++;
        tx.objectStore("folders").put(folder);
        return folder;
      });
    },
    async reserve(id, row, limit) {
      return transaction(
        ["folders", "entries", "pending"],
        "readwrite",
        async (tx) => {
          const summary = await request(tx.objectStore("folders").get(id));
          if (summary.indexStatus !== "ready") return null;
          const key = [id, row.path];
          if (await request(tx.objectStore("pending").get(key)))
            throw Error("Audio write recovery required");
          const old = await request(tx.objectStore("entries").get(key));
          const reserved = Math.max(0, row.bytes - (old?.bytes || 0));
          if (summary.bytes + reserved > limit)
            throw Object.assign(Error("Audio cache capacity reached"), {
              cacheCode: "capacity",
            });
          summary.bytes += reserved;
          summary.revision++;
          tx.objectStore("pending").put({
            folder: id,
            path: row.path,
            next: row,
            reserved,
          });
          tx.objectStore("folders").put(summary);
          return summary;
        },
      );
    },
    async commit(id, row) {
      return transaction(
        ["folders", "entries", "pending", "identities"],
        "readwrite",
        async (tx) => {
          const summary = await request(tx.objectStore("folders").get(id));
          const pending = await request(
            tx.objectStore("pending").get([id, row.path]),
          );
          if (pending) {
            summary.bytes -= pending.reserved;
            tx.objectStore("pending").delete([id, row.path]);
          }
          return update(tx, summary, [row]);
        },
      );
    },
    async reset(id, indexStatus = "rebuilding") {
      return transaction(
        ["folders", "entries", "pending", "directories", "identities"],
        "readwrite",
        async (tx) => {
          for (const name of [
            "entries",
            "pending",
            "directories",
            "identities",
          ])
            tx.objectStore(name).delete(range(id));
          const summary = await request(tx.objectStore("folders").get(id));
          Object.assign(summary, {
            bytes: 0,
            counts: {},
            indexStatus,
            revision: summary.revision + 1,
          });
          tx.objectStore("folders").put(summary);
          return summary;
        },
      );
    },
  };
})();
