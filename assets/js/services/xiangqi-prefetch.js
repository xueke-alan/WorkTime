"use strict";
/** Warm disk resources after startup network requests settle, without running chess. */
WorkTimeApp.services.xiangqiPrefetch = (() => {
  const abort = new AbortController();
  let started = false,
    closed = false,
    complete = false,
    running = null;
  let failed = false,
    retried = false,
    retryRequested = false;
  function schedule() {
    if (closed || complete || running) return;
    if (navigator.onLine === false) {
      failed = true;
      return;
    }
    running = (async () => {
      const assets = WorkTimeApp.services.assets;
      await assets.whenIdle({ signal: abort.signal });
      if (closed) return;
      if (navigator.onLine === false) throw Error("Offline");
      await assets.script("assets/js/games/xiangqi-engine.js", {
        fetchPriority: "low",
      });
      await assets.whenIdle({ signal: abort.signal });
      if (closed) return;
      await WorkTimeApp.games.pikafishResources.prefetch();
      complete = true;
      window.removeEventListener("online", online);
    })()
      .catch(() => {
        failed = true;
      })
      .finally(() => {
        running = null;
        if (failed && retryRequested && !retried && !closed) {
          retried = true;
          failed = false;
          schedule();
        }
      });
  }
  function online() {
    if (closed || complete || retried) return;
    retryRequested = true;
    if (failed && !running) {
      retried = true;
      failed = false;
      schedule();
    }
  }
  function start() {
    if (started || closed || !/^https?:$/.test(location.protocol)) return;
    started = true;
    window.addEventListener("online", online);
    window.addEventListener(
      "pagehide",
      () => {
        closed = true;
        abort.abort();
        window.removeEventListener("online", online);
      },
      { once: true },
    );
    schedule();
  }
  return { start };
})();
