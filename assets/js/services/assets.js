"use strict";
/** Shared classic-script loader: works over file:// and HTTP without fetch/import. */
WorkTimeApp.services.assets = (() => {
  // The source lives in services/, while the published bundle lives in js/.
  const source = document.currentScript.src;
  const root = new URL(source.slice(0, source.lastIndexOf("/assets/js/") + 1));
  const versions = WorkTimeApp.data.assetVersions || {};
  const pending = new Map();
  function load(path, style = false) {
    if (pending.has(path)) return pending.get(path);
    const task = new Promise((resolve, reject) => {
      const element = document.createElement(style ? "link" : "script");
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
        if (error) {
          element.remove();
          reject(error);
        } else resolve();
      }
      element.onload = () => finish();
      element.onerror = () => finish(Error("Asset failed: " + path));
      document.head.append(element);
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
    script: (path) => load(path),
    style: (path) => load(path, true),
    scripts,
  };
})();
