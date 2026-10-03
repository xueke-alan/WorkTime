"use strict";
/** Persistence adapter. Memory edits remain available for export after a failed write. */
const WorkStorage = (() => {
  function create({ key, validate, defaultState, getStorage }) {
    let dirty = false;
    let corrupt = false;
    let originalText = null;
    let expectedText = null;
    let writeAccess = true;
    let accessError = null;
    let releaseLock = null;
    let lockRequest = null;
    let released = false;
    let requestVersion = 0;
    let lastResult = { ok: true, persisted: true, dirty: false, error: null };
    function failure(error) {
      dirty = true;
      lastResult = { ok: false, persisted: false, dirty, error };
      return lastResult;
    }
    return {
      /** Hold one native origin-scoped writer lock for this page's lifetime. */
      async acquireWriteAccess(locks, { wait = false, retry = false } = {}) {
        if (released) return failure(accessError);
        if (retry && writeAccess)
          return { ok: true, persisted: true, dirty, error: null };
        const version = ++requestVersion;
        if (retry) lockRequest?.abort();
        writeAccess = false;
        if (!locks?.request) {
          accessError = Error(
            "当前浏览器不支持安全写入锁，请使用新版 Edge 或 Chrome；当前修改可导出备份",
          );
          return failure(accessError);
        }
        const request = new AbortController();
        lockRequest = request;
        return new Promise((resolve) => {
          locks
            .request(
              key + ":writer",
              wait ? { signal: request.signal } : { ifAvailable: true },
              async (lock) => {
                if (released || version !== requestVersion) {
                  resolve({
                    ok: false,
                    persisted: false,
                    dirty,
                    error: accessError,
                  });
                  return;
                }
                if (!lock) {
                  accessError = Error(
                    "另一页面正在编辑；关闭该页面后会自动重试保存，当前修改可先导出备份",
                  );
                  resolve(failure(accessError));
                  return;
                }
                writeAccess = true;
                lockRequest = null;
                accessError = null;
                const lifetime = new Promise((release) => {
                  releaseLock = release;
                });
                resolve({ ok: true, persisted: true, dirty, error: null });
                await lifetime;
              },
            )
            .catch((error) => {
              if (released || version !== requestVersion) {
                resolve({ ok: false, persisted: false, dirty, error });
                return;
              }
              writeAccess = false;
              accessError = Error(
                "无法取得安全写入锁：" + error.message + "；当前修改可导出备份",
              );
              resolve(failure(accessError));
            });
        });
      },
      releaseWriteAccess() {
        released = true;
        requestVersion++;
        writeAccess = false;
        accessError = Error("页面写入锁已释放，请刷新后继续保存");
        lockRequest?.abort();
        lockRequest = null;
        releaseLock?.();
        releaseLock = null;
      },
      load() {
        try {
          originalText = getStorage().getItem(key);
          expectedText = originalText;
          const state = originalText
            ? validate(JSON.parse(originalText))
            : defaultState();
          corrupt = false;
          return { state, error: null, corrupt: false };
        } catch (error) {
          corrupt = true;
          failure(error);
          return { state: defaultState(), error, corrupt: true };
        }
      },
      save(state) {
        dirty = true;
        try {
          if (!writeAccess) throw accessError || Error("未取得安全写入权");
          if (corrupt) throw Error("存储数据无法读取，请先恢复有效备份");
          const storage = getStorage();
          if (storage.getItem(key) !== expectedText)
            throw Error(
              "浏览器数据已被外部更新，请先备份当前改动并刷新，避免覆盖其他记录",
            );
          const text = JSON.stringify(state);
          storage.setItem(key, text);
          expectedText = text;
          dirty = false;
          lastResult = { ok: true, persisted: true, dirty, error: null };
          return lastResult;
        } catch (error) {
          return failure(error);
        }
      },
      /** Used only after a backup has been decoded, validated and confirmed. */
      allowValidatedRestore() {
        corrupt = false;
      },
      get status() {
        return { ...lastResult };
      },
      get canWrite() {
        return writeAccess && !released;
      },
      hasExternalUpdate() {
        return getStorage().getItem(key) !== expectedText;
      },
      get originalText() {
        return originalText;
      },
    };
  }
  return { create };
})();
