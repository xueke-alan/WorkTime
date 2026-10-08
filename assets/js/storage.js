"use strict";
/** Persistence adapter. Memory edits remain available for export after a failed write. */
WorkTimeApp.services.storage = (() => {
  function storageError(code, message) {
    return Object.assign(Error(message), { code });
  }
  function create({ key, validate, defaultState, getStorage }) {
    let dirty = false;
    let loadIssue = null;
    let readSucceeded = false;
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
      if (typeof error.code !== "string")
        error = Object.assign(Error(error.message), {
          name: error.name,
          code:
            error.name === "QuotaExceededError"
              ? "QUOTA_EXCEEDED"
              : "STORAGE_UNAVAILABLE",
        });
      dirty = true;
      lastResult = { ok: false, persisted: false, dirty, error };
      return lastResult;
    }
    function write(state, replacement = false) {
      dirty = true;
      try {
        if (!writeAccess)
          throw (
            accessError || storageError("LOCK_REQUIRED", "未取得安全写入权")
          );
        if (!readSucceeded)
          throw storageError(
            "STORAGE_UNAVAILABLE",
            "尚未成功读取存档，请先重新检查",
          );
        if (loadIssue && !replacement)
          throw storageError(
            "CORRUPT_STORAGE",
            "存档尚未恢复，请先恢复有效备份或处理读取异常",
          );
        const candidate = replacement ? validate(state) : state;
        const storage = getStorage();
        if (storage.getItem(key) !== expectedText)
          throw storageError(
            "EXTERNAL_UPDATE",
            "浏览器数据已被外部更新，请先备份当前改动并刷新，避免覆盖其他记录",
          );
        const text = JSON.stringify(candidate);
        storage.setItem(key, text);
        expectedText = text;
        if (replacement) loadIssue = null;
        dirty = false;
        lastResult = { ok: true, persisted: true, dirty, error: null };
        return lastResult;
      } catch (error) {
        return failure(error);
      }
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
          accessError = storageError(
            "LOCK_UNSUPPORTED",
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
                  accessError = storageError(
                    "LOCK_BUSY",
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
              accessError = storageError(
                "LOCK_FAILED",
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
        accessError = storageError(
          "LOCK_RELEASED",
          "页面写入锁已释放，请刷新后继续保存",
        );
        lockRequest?.abort();
        lockRequest = null;
        releaseLock?.();
        releaseLock = null;
      },
      load() {
        readSucceeded = false;
        try {
          originalText = getStorage().getItem(key);
          expectedText = originalText;
          readSucceeded = true;
          const state =
            originalText === null
              ? defaultState()
              : validate(JSON.parse(originalText));
          loadIssue = null;
          return {
            state,
            error: null,
            corrupt: false,
            loadIssue,
            readSucceeded,
          };
        } catch (error) {
          loadIssue = !readSucceeded
            ? "unavailable"
            : error.code === "UNSUPPORTED_VERSION"
              ? "unsupported"
              : "corrupt";
          failure(error);
          return {
            state: defaultState(),
            error,
            corrupt: true,
            loadIssue,
            readSucceeded,
          };
        }
      },
      save(state) {
        return write(state);
      },
      /** Validate and replace without lifting read protection until the write succeeds. */
      replace(state) {
        return write(state, true);
      },
      get loadIssue() {
        return loadIssue;
      },
      get readSucceeded() {
        return readSucceeded;
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
