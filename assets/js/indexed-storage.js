"use strict";
/** Authoritative database; revision checks and writes share one transaction. */
WorkTimeApp.services.indexedStorage = (() => {
  const DB_NAME = "worktime-archive",
    DB_VERSION = 1,
    LIMIT = 100 * 1024 * 1024;
  const A = WorkTimeApp.services.archive;
  const request = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.transaction?.done?.catch(reject);
    });
  function create({
    key,
    defaultState,
    getStorage,
    indexedDB,
    transactionTimeout = 120000,
  }) {
    let db,
      active,
      revision = 0,
      loadIssue = null,
      originalText = null,
      readSucceeded = false,
      canWrite = true,
      released = false,
      releaseLock,
      lockPending,
      abortLock,
      queue = Promise.resolve();
    let lastResult = { ok: true, persisted: true, dirty: false, error: null };
    function fail(error) {
      if (typeof error.code !== "string")
        error = A.error(
          error.message,
          error.name === "QuotaExceededError"
            ? "QUOTA_EXCEEDED"
            : "STORAGE_UNAVAILABLE",
        );
      return (lastResult = { ok: false, persisted: false, dirty: true, error });
    }
    function transaction(stores, mode = "readonly") {
      if (!db)
        throw A.error(
          "IndexedDB 不可用；当前修改仅保留在本页，请导出备份。",
          "STORAGE_UNAVAILABLE",
        );
      const tx = db.transaction(stores, mode);
      tx.done = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const error = A.error(
            "存档事务长时间未完成，已取消本次保存；原存档保留，请导出本页修改并刷新重试。",
            "STORAGE_TIMEOUT",
          );
          tx._error = error;
          try {
            tx.abort();
          } catch {}
          reject(error);
        }, transactionTimeout);
        tx.oncomplete = () => {
          clearTimeout(timer);
          resolve();
        };
        tx.onabort = () => {
          clearTimeout(timer);
          reject(tx._error || tx.error || Error("事务已取消。"));
        };
        tx.onerror = () => {};
      });
      return tx;
    }
    async function open() {
      if (db) return;
      if (indexedDB === undefined) indexedDB = window.indexedDB;
      if (!indexedDB) throw Error("浏览器不支持 IndexedDB。");
      db = await new Promise((resolve, reject) => {
        let blocked = false;
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore("archives", { keyPath: "key" });
          d.createObjectStore("modules", {
            keyPath: ["archiveId", "id"],
          }).createIndex("archive", "archiveId");
          const records = d.createObjectStore("records", {
            keyPath: ["archiveId", "moduleId", "id"],
          });
          records.createIndex("archive", "archiveId");
          records.createIndex("module", ["archiveId", "moduleId"]);
          records.createIndex("owner", ["archiveId", "moduleId", "owner"]);
          for (const name of ["snapshots", "migrations", "cache"]) {
            const store = d.createObjectStore(name, { keyPath: "id" });
            if (name === "snapshots")
              store.createIndex("typeDay", ["type", "day"]);
          }
        };
        r.onsuccess = () => {
          if (released || blocked) {
            r.result.close();
            reject(Error("页面已关闭。"));
          } else resolve(r.result);
        };
        r.onerror = () => reject(r.error);
        r.onblocked = () => {
          blocked = true;
          reject(
            A.error(
              "数据库升级被其他页面阻止，请关闭旧页面后刷新。",
              "DATABASE_BLOCKED",
            ),
          );
        };
      });
      db.onversionchange = () => {
        db.close();
        db = null;
        loadIssue = "unavailable";
        canWrite = false;
      };
    }
    function legacy() {
      const s = getStorage();
      return {
        text: s.getItem(key),
        preferences: {
          pageTheme: s.getItem("worktime.pageTheme"),
          forecastMode: s.getItem("worktime.weather.forecastMode"),
        },
      };
    }
    async function documentFromDatabase({
      partial = false,
      adopt = false,
    } = {}) {
      const tx = transaction(["archives", "modules", "records"]);
      const metadata = await request(tx.objectStore("archives").get("active"));
      if (!metadata) {
        const leftover = await request(tx.objectStore("records").count());
        await tx.done;
        if (leftover)
          throw A.error(
            "主存档元信息缺失，已保留数据库记录，请导出恢复资料。",
            "INVALID_BACKUP",
          );
        if (adopt) active = null;
        return null;
      }
      if (adopt) {
        active = metadata;
        revision = metadata.revision;
      }
      const headers = await request(
        tx.objectStore("modules").index("archive").getAll(metadata.archive.id),
      );
      const modules = await Promise.all(
        headers.map(async ({ archiveId, ...module }) => {
          const omit =
            partial && [A.ids.observations, A.ids.evidence].includes(module.id);
          const rows = omit
            ? []
            : await request(
                tx
                  .objectStore("records")
                  .index("module")
                  .getAll([archiveId, module.id]),
              );
          return {
            ...module,
            records: rows.map(({ archiveId, moduleId, owner, ...row }) => row),
          };
        }),
      );
      await tx.done;
      return {
        ...metadata.envelope,
        format: A.FORMAT,
        formatVersion: metadata.formatVersion,
        archive: metadata.archive,
        modules,
      };
    }
    async function readArchive(options) {
      const doc = await documentFromDatabase(options);
      return doc ? A.decode(doc, options) : null;
    }
    function storeDocument(tx, doc) {
      for (const { records, ...module } of doc.modules) {
        tx.objectStore("modules").put({ ...module, archiveId: doc.archive.id });
        for (const row of records)
          tx.objectStore("records").put({
            ...row,
            archiveId: doc.archive.id,
            moduleId: module.id,
            owner: row.data.importId || row.id,
          });
      }
    }
    function metadata(doc, rev, extra = {}) {
      const {
        modules,
        archive,
        format,
        formatVersion,
        exportedAt,
        ...envelope
      } = doc;
      return {
        key: "active",
        archive,
        formatVersion,
        envelope,
        revision: rev,
        updatedAt: new Date().toISOString(),
        ...extra,
      };
    }
    async function migrate(source) {
      if (!canWrite)
        throw A.error("另一页面正在迁移，请关闭后重新检查。", "LOCK_BUSY");
      const state = A.migrate(
          source.text === null ? defaultState() : JSON.parse(source.text),
          source.preferences,
        ),
        doc = A.encode(state);
      const tx = transaction(
        ["archives", "modules", "records", "migrations"],
        "readwrite",
      );
      try {
        const existing = await request(
          tx.objectStore("archives").get("active"),
        );
        if (!existing) {
          if (legacy().text !== source.text)
            throw A.error(
              "旧存档在迁移时被更新，请刷新重试。",
              "EXTERNAL_UPDATE",
            );
          storeDocument(tx, doc);
          const migration = {
            id: A.uuid(),
            text: source.text,
            preferences: source.preferences,
            sourceVersion:
              source.text === null
                ? null
                : JSON.parse(source.text).schemaVersion,
            at: new Date().toISOString(),
            converterVersion: 1,
          };
          tx.objectStore("migrations").put(migration);
          tx.objectStore("archives").put(
            metadata(doc, 0, { migrationId: migration.id }),
          );
        }
      } catch (error) {
        tx._error = error;
        tx.abort();
      }
      await tx.done;
      const verified = await readArchive({ adopt: true });
      if (!verified) throw Error("迁移回读失败。");
      return verified;
    }
    async function checkLegacy() {
      if (!active?.migrationId) return;
      const tx = transaction(["migrations"]),
        entry = await request(
          tx.objectStore("migrations").get(active.migrationId),
        );
      await tx.done;
      if (
        entry &&
        legacy().text !== (active.legacyAcknowledgedText ?? entry.text)
      )
        throw A.error(
          "旧页面已修改迁移前存档；请导出当前备份及旧原文，再选择恢复。",
          "LEGACY_CONFLICT",
        );
    }
    async function load() {
      readSucceeded = false;
      try {
        await open();
        let raw = await documentFromDatabase({ partial: true, adopt: true });
        if (raw && A.needsMigration(raw)) {
          raw = await documentFromDatabase();
          const upgraded = A.decode(raw);
          if (!canWrite)
            throw A.error(
              "存档模块需要升级，请关闭正在编辑的另一页面后重试。",
              "LOCK_BUSY",
            );
          loadIssue = null;
          lastResult = { ok: true, persisted: true, dirty: false, error: null };
          const saved = await write(upgraded, {}, true, false, true);
          if (!saved.persisted) throw saved.error;
          raw = await documentFromDatabase({ partial: true, adopt: true });
        }
        let state = raw ? A.decode(raw, { partial: true }) : null;
        if (!state) {
          const source = legacy();
          originalText = source.text;
          readSucceeded = true;
          await migrate(source);
          state = await readArchive({ partial: true, adopt: true });
        }
        readSucceeded = true;
        loadIssue = null;
        try {
          await checkLegacy();
        } catch (error) {
          originalText = legacy().text;
          fail(error);
          return {
            state,
            error,
            corrupt: false,
            loadIssue: null,
            readSucceeded: true,
          };
        }
        try {
          const storage = getStorage(),
            keys = [];
          for (let index = 0; index < storage.length; index++) {
            const name = storage.key(index);
            if (name?.startsWith("worktime.weather.baidu.v1.")) keys.push(name);
          }
          const records = keys
            .map((name) => {
              try {
                return { name, value: JSON.parse(storage.getItem(name)) };
              } catch {
                return { name };
              }
            })
            .filter(
              (row) =>
                row.value && Number.isFinite(Date.parse(row.value.fetchedAt)),
            )
            .sort(
              (a, b) =>
                Date.parse(b.value.fetchedAt) - Date.parse(a.value.fetchedAt),
            )
            .slice(0, 10);
          for (const row of records)
            if (Date.now() - Date.parse(row.value.fetchedAt) <= 7 * 86400000)
              await cache.set("weather:" + row.value.cityId, row.value);
          keys.forEach((name) => storage.removeItem(name));
          await cache.prune();
        } catch {}
        return { state, error: null, corrupt: false, loadIssue, readSucceeded };
      } catch (error) {
        loadIssue =
          error.code === "UNSUPPORTED_VERSION" || error.name === "VersionError"
            ? "unsupported"
            : error.name === "SyntaxError" ||
                ["INVALID_BACKUP", "INVALID_SCHEDULE"].includes(error.code)
              ? "corrupt"
              : "unavailable";
        fail(error);
        let state = A.migrate(defaultState());
        if (!db || !active)
          try {
            const source = legacy();
            originalText = source.text;
            if (source.text)
              state = A.migrate(JSON.parse(source.text), source.preferences);
          } catch {}
        else if (originalText === null)
          try {
            const raw = await documentFromDatabase();
            originalText = raw ? JSON.stringify(raw) : legacy().text;
          } catch {}
        if (originalText === null && db)
          try {
            originalText = JSON.stringify(await rawDatabase());
          } catch {}
        return { state, error, corrupt: true, loadIssue, readSucceeded };
      }
    }
    async function guard(tx, replacement = false) {
      if (released || !canWrite)
        throw A.error("另一页面正在编辑，当前修改可导出备份。", "LOCK_BUSY");
      if (loadIssue && !(replacement && loadIssue === "corrupt"))
        throw A.error(
          "存档读取未通过校验，当前修改仅保留在本页。",
          "CORRUPT_STORAGE",
        );
      const stored = await request(tx.objectStore("archives").get("active"));
      if (
        !stored &&
        replacement &&
        loadIssue === "corrupt" &&
        originalText !== null
      ) {
        if (legacy().text !== originalText)
          throw A.error(
            "旧存档已被更新，请导出原文并刷新。",
            "EXTERNAL_UPDATE",
          );
        return null;
      }
      if (!stored || stored.revision !== revision)
        throw A.error(
          "其他页面已更新存档，请导出本页修改并刷新。",
          "EXTERNAL_UPDATE",
        );
      return stored;
    }
    const today = () => WorkTimeApp.domain.time.businessDate(new Date());
    async function needsDaily() {
      const tx = transaction(["snapshots"]),
        count = await request(
          tx
            .objectStore("snapshots")
            .index("typeDay")
            .count(["daily", today()]),
        );
      await tx.done;
      return count === 0;
    }
    function snapshot(doc, type) {
      const bytes = new TextEncoder().encode(JSON.stringify(doc)).length;
      if (bytes > LIMIT)
        throw A.error(
          "快照超过 100 MiB，请先导出并清理数据。",
          "SNAPSHOT_LIMIT",
        );
      return {
        id: A.uuid(),
        type,
        day: today(),
        at: new Date().toISOString(),
        bytes,
        document: doc,
      };
    }
    async function retain(tx, incoming) {
      const store = tx.objectStore("snapshots"),
        old = await request(store.getAll());
      if (
        incoming.type === "daily" &&
        old.some((row) => row.type === "daily" && row.day === incoming.day)
      )
        return;
      store.put(incoming);
      let bytes = 0;
      const counts = { daily: 0, operation: 0 };
      const all = [incoming, ...old].sort((a, b) => b.at.localeCompare(a.at));
      for (const row of all) {
        counts[row.type]++;
        if (
          counts[row.type] > (row.type === "daily" ? 7 : 3) ||
          bytes + row.bytes > LIMIT
        )
          store.delete(row.id);
        else bytes += row.bytes;
      }
    }
    function patchModules(state, changes) {
      const subset = {
          ...state,
          days: {},
          imports: [],
          scheduleRanges: [],
          timeTemplates: [],
        },
        selected = new Set();
      if (changes.days) {
        for (const date of changes.days)
          if (state.days[date]) subset.days[date] = state.days[date];
        selected.add(A.ids.days);
      }
      if (changes.imports) {
        subset.imports = state.imports.filter((log) =>
          changes.imports.includes(log.id),
        );
        ["imports", "observations", "evidence"].forEach((name) =>
          selected.add(A.ids[name]),
        );
      }
      if (changes.personal) selected.add(A.ids.profile);
      if (changes.settings || changes.overtimeRequirements || changes.oaUrl)
        selected.add(A.ids.rules);
      if (changes.preferences) selected.add(A.ids.preferences);
      if (changes.scheduleRanges) {
        subset.scheduleRanges = state.scheduleRanges;
        selected.add(A.ids.schedule);
      }
      if (changes.timeTemplates) {
        subset.timeTemplates = state.timeTemplates;
        selected.add(A.ids.templates);
      }
      const modules = A.encode(subset).modules.filter((module) =>
        selected.has(module.id),
      );
      const dayModule = modules.find((module) => module.id === A.ids.days);
      if (dayModule) {
        const order = new Map(
          Object.keys(state.days).map((id, index) => [id, index]),
        );
        for (const row of dayModule.records) row.order = order.get(row.id);
      }
      return modules;
    }
    async function write(
      state,
      changes,
      replacement = false,
      retried = false,
      moduleMigration = false,
    ) {
      try {
        if (
          replacement &&
          lastResult.persisted === false &&
          !loadIssue &&
          lastResult.error?.code !== "LEGACY_CONFLICT"
        )
          throw A.error("请先保存或导出未保存修改，再恢复。", "UNSAVED");
        if (!replacement) await checkLegacy();
        const before =
          replacement || (await needsDaily())
            ? await documentFromDatabase()
            : null;
        const recovery = before
          ? snapshot(before, replacement ? "operation" : "daily")
          : null;
        const doc = replacement ? A.encode(state) : null,
          modules = replacement ? doc.modules : patchModules(state, changes);
        const tx = transaction(
          ["archives", "modules", "records", "snapshots", "migrations"],
          "readwrite",
        );
        let next;
        try {
          const stored = await guard(tx, replacement);
          if (recovery) await retain(tx, recovery);
          if (moduleMigration)
            tx.objectStore("migrations").put({
              id: A.uuid(),
              text: JSON.stringify(before),
              sourceVersion: before.modules.map((module) => ({
                id: module.id,
                version: module.version,
              })),
              at: new Date().toISOString(),
              converterVersion: 1,
            });
          if (replacement) {
            if (stored) {
              const keys = await request(
                tx
                  .objectStore("records")
                  .index("archive")
                  .getAllKeys(stored.archive.id),
              );
              const headers = await request(
                tx
                  .objectStore("modules")
                  .index("archive")
                  .getAllKeys(stored.archive.id),
              );
              keys.forEach((key) => tx.objectStore("records").delete(key));
              headers.forEach((key) => tx.objectStore("modules").delete(key));
            }
            const migrationId = stored?.migrationId || A.uuid();
            if (!stored)
              tx.objectStore("migrations").put({
                id: migrationId,
                text: originalText,
                at: new Date().toISOString(),
                sourceVersion: null,
                converterVersion: 1,
              });
            storeDocument(tx, doc);
            next = metadata(doc, revision + 1, {
              migrationId,
              legacyAcknowledgedText: legacy().text,
            });
          } else {
            for (const module of modules) {
              const store = tx.objectStore("records");
              if (module.id === A.ids.days) {
                for (const id of changes.days)
                  if (!state.days[id])
                    store.delete([stored.archive.id, module.id, id]);
              } else if (
                [A.ids.imports, A.ids.observations, A.ids.evidence].includes(
                  module.id,
                )
              ) {
                if (module.id === A.ids.imports)
                  for (const id of changes.imports)
                    store.delete([stored.archive.id, module.id, id]);
                else {
                  for (const id of changes.imports) {
                    const keys = await request(
                      store
                        .index("owner")
                        .getAllKeys([stored.archive.id, module.id, id]),
                    );
                    keys.forEach((key) => store.delete(key));
                  }
                }
              } else if (
                [A.ids.schedule, A.ids.templates].includes(module.id)
              ) {
                const keys = await request(
                  store
                    .index("module")
                    .getAllKeys([stored.archive.id, module.id]),
                );
                keys.forEach((key) => store.delete(key));
              }
              for (const row of module.records)
                store.put({
                  ...row,
                  archiveId: stored.archive.id,
                  moduleId: module.id,
                  owner: row.data.importId || row.id,
                });
            }
            next = {
              ...stored,
              revision: revision + 1,
              updatedAt: new Date().toISOString(),
            };
          }
          tx.objectStore("archives").put(next);
        } catch (error) {
          tx._error = error;
          tx.abort();
        }
        await tx.done;
        active = next;
        revision = next.revision;
        loadIssue = null;
        readSucceeded = true;
        return (lastResult = {
          ok: true,
          persisted: true,
          dirty: false,
          error: null,
        });
      } catch (error) {
        if (error.name === "QuotaExceededError" && !retried) {
          try {
            await cache.clear();
            return await write(
              state,
              changes,
              replacement,
              true,
              moduleMigration,
            );
          } catch {}
        }
        return fail(error);
      }
    }
    function enqueue(operation) {
      const task = queue.then(operation);
      queue = task.catch(() => {});
      return task;
    }
    async function rawDatabase() {
      const tx = transaction(["archives", "modules", "records"]);
      const [archives, modules, records] = await Promise.all(
        ["archives", "modules", "records"].map((name) =>
          request(tx.objectStore(name).getAll()),
        ),
      );
      await tx.done;
      return {
        format: "worktime-database-recovery",
        version: 1,
        archives,
        modules,
        records,
      };
    }
    const cache = {
      async get(id) {
        try {
          const tx = transaction(["cache"]),
            row = await request(tx.objectStore("cache").get(id));
          await tx.done;
          return row && Date.now() - row.at <= 7 * 86400000 ? row.value : null;
        } catch {
          return null;
        }
      },
      async set(id, value) {
        try {
          const tx = transaction(["cache"], "readwrite"),
            store = tx.objectStore("cache");
          const rows = await request(store.getAll());
          const entry = {
            id,
            value,
            at: Date.parse(value.fetchedAt) || Date.now(),
          };
          const all = [entry, ...rows.filter((row) => row.id !== id)].sort(
            (a, b) => b.at - a.at,
          );
          store.put(entry);
          for (const [index, row] of all.entries())
            if (index >= 10 || Date.now() - row.at > 7 * 86400000)
              store.delete(row.id);
          await tx.done;
        } catch {}
      },
      async clear() {
        const tx = transaction(["cache"], "readwrite");
        tx.objectStore("cache").clear();
        await tx.done;
      },
      async prune() {
        const tx = transaction(["cache"], "readwrite"),
          store = tx.objectStore("cache");
        const rows = await request(store.getAll());
        rows.sort((a, b) => b.at - a.at);
        rows.forEach((row, index) => {
          if (index >= 10 || Date.now() - row.at > 7 * 86400000)
            store.delete(row.id);
        });
        await tx.done;
      },
    };
    return {
      cache,
      load,
      migrate,
      checkLegacy,
      commit(state, changes) {
        return enqueue(() => write(state, changes));
      },
      restore(state) {
        return enqueue(() => write(state, {}, true));
      },
      async export(state) {
        await queue;
        if (loadIssue === "unsupported" && originalText !== null)
          return JSON.parse(originalText);
        const full =
          state.imports.some((log) => log._lazy) && db && active
            ? await readArchive()
            : null;
        const logs = new Map(full?.imports.map((log) => [log.id, log]));
        const hydrated = {
          ...state,
          imports: state.imports.map((log) =>
            log._lazy ? logs.get(log.id) || log : log,
          ),
        };
        if (hydrated.imports.some((log) => log._lazy))
          throw Error("导入历史无法读取，请下载原存档。");
        return A.clone(
          A.encode(hydrated, { exportedAt: new Date().toISOString() }),
        );
      },
      async hydrateImports(state) {
        await queue;
        if (!state.imports.some((log) => log._lazy)) return state;
        const full = await readArchive();
        const logs = new Map(full.imports.map((log) => [log.id, log]));
        return {
          ...state,
          _archive: {
            ...state._archive,
            recordExtras: full._archive.recordExtras,
            dataExtras: full._archive.dataExtras,
          },
          imports: state.imports.map((log) =>
            log._lazy ? logs.get(log.id) : log,
          ),
        };
      },
      async recoveryData() {
        await queue;
        const tx = transaction(["snapshots", "migrations"]);
        const [snapshots, migrations] = await Promise.all([
          request(tx.objectStore("snapshots").getAll()),
          request(tx.objectStore("migrations").getAll()),
        ]);
        await tx.done;
        let currentArchive;
        try {
          currentArchive = await documentFromDatabase();
        } catch {
          currentArchive = await rawDatabase();
        }
        return {
          format: "worktime-recovery",
          version: 1,
          snapshots,
          migrations,
          legacyText: legacy().text,
          currentArchive,
        };
      },
      async snapshots() {
        await queue;
        const tx = transaction(["snapshots"]);
        const rows = await request(tx.objectStore("snapshots").getAll());
        await tx.done;
        return rows.sort((a, b) => b.at.localeCompare(a.at));
      },
      async clearSnapshots() {
        await queue;
        const tx = transaction(["snapshots"], "readwrite");
        tx.objectStore("snapshots").clear();
        await tx.done;
      },
      async hasExternalUpdate() {
        const tx = transaction(["archives"]),
          value = await request(tx.objectStore("archives").get("active"));
        await tx.done;
        return value?.revision !== revision;
      },
      async acquireWriteAccess(locks, { wait = false, retry = false } = {}) {
        if (released) return fail(Error("页面已关闭。"));
        if (releaseLock) return { ok: true, persisted: true };
        if (!locks?.request) {
          canWrite = true;
          return { ok: true, persisted: true };
        }
        if (lockPending && !retry) return lockPending;
        abortLock?.abort();
        abortLock = new AbortController();
        canWrite = false;
        lockPending = new Promise((resolve) => {
          locks
            .request(
              DB_NAME + ":writer",
              wait ? { signal: abortLock.signal } : { ifAvailable: true },
              async (lock) => {
                if (!lock || released) {
                  resolve(
                    fail(
                      A.error(
                        "另一页面正在编辑；关闭后自动重试，当前修改可导出备份。",
                        "LOCK_BUSY",
                      ),
                    ),
                  );
                  return;
                }
                canWrite = true;
                const lifetime = new Promise((release) => {
                  releaseLock = release;
                });
                resolve({ ok: true, persisted: true });
                await lifetime;
              },
            )
            .catch((error) => resolve(fail(error)));
        });
        const result = await lockPending;
        lockPending = null;
        return result;
      },
      releaseWriteAccess() {
        released = true;
        canWrite = false;
        abortLock?.abort();
        releaseLock?.();
        db?.close();
        db = null;
      },
      get canWrite() {
        return canWrite && !released;
      },
      get readSucceeded() {
        return readSucceeded;
      },
      get originalText() {
        return originalText;
      },
      get loadIssue() {
        return loadIssue;
      },
      get status() {
        return { ...lastResult };
      },
    };
  }
  return { create, DB_NAME, DB_VERSION };
})();
