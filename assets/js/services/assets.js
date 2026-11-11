"use strict";
/** Shared classic-script loader: works over file:// and HTTP without fetch/import. */
WorkTimeApp.services.assets = (() => {
  // The source lives in services/, while the published bundle lives in js/.
  const source = document.currentScript.src;
  const root = new URL(source.slice(0, source.lastIndexOf("/assets/js/") + 1));
  const versions = WorkTimeApp.data.assetVersions || {};
  const pending = new Map();
  const elements = new Map();
  const idleListeners = new Set();
  const changed = () => idleListeners.forEach((listener) => listener());
  function whenIdle({ signal } = {}) {
    return new Promise((resolve, reject) => {
      let timer;
      function finish(error) {
        clearTimeout(timer);
        idleListeners.delete(check);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      }
      function abort() {
        finish(new DOMException("Cancelled", "AbortError"));
      }
      function check() {
        clearTimeout(timer);
        if (!elements.size) timer = setTimeout(() => finish(), 250);
      }
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      idleListeners.add(check);
      check();
    });
  }
  function load(path, style = false, { fetchPriority = "auto", before } = {}) {
    if (pending.has(path)) {
      if (fetchPriority === "high" && elements.has(path))
        elements.get(path).fetchPriority = "high";
      return pending.get(path);
    }
    const task = new Promise((resolve, reject) => {
      const element = document.createElement(style ? "link" : "script");
      element.fetchPriority = fetchPriority;
      elements.set(path, element);
      changed();
      const url = new URL(path, root);
      if (versions[path]) url.searchParams.set("v", versions[path]);
      if (style) {
        element.rel = "stylesheet";
        element.href = url.href;
      } else element.src = url.href;
      const timer = setTimeout(
        () => finish(Error("Asset timed out: " + path)),
        15000,
      );
      function finish(error) {
        clearTimeout(timer);
        element.onload = element.onerror = null;
        elements.delete(path);
        changed();
        if (error) {
          element.remove();
          reject(error);
        } else resolve();
      }
      element.onload = () => finish();
      element.onerror = () => finish(Error("Asset failed: " + path));
      if (before?.parentNode === document.head)
        document.head.insertBefore(element, before);
      else document.head.append(element);
    });
    pending.set(path, task);
    // A failed load is retryable; successful scripts execute only once.
    task.catch(() => pending.delete(path));
    return task;
  }
  async function scripts(paths) {
    for (const path of paths) await load(path);
  }
  return {
    script: (path, options) => load(path, false, options),
    style: (path, options) => load(path, true, options),
    scripts,
    whenIdle,
  };
})();
