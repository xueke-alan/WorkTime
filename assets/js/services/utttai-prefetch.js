"use strict";
WorkTimeApp.services.utttaiPrefetch = (() => {
  let started = false,
    done = false,
    running = null,
    failed = false,
    retried = false,
    retryRequested = false,
    closed = false;
  const abort = new AbortController();
  function schedule() {
    if (running || done || closed) return;
    running = (async () => {
      await WorkTimeApp.services.assets.whenIdle({ signal: abort.signal });
      if (closed || navigator.onLine === false) throw Error("Offline");
      await WorkTimeApp.services.assets.script(
        "assets/js/games/ultimate-ttt-engine.js",
        { fetchPriority: "low" },
      );
      await WorkTimeApp.services.assets.whenIdle({ signal: abort.signal });
      if (closed) return;
      await WorkTimeApp.games.utttaiResources.prefetch();
      done = true;
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
    if (retried || closed || done) return;
    retryRequested = true;
    if (failed && !running) {
      retried = true;
      failed = false;
      schedule();
    }
  }
  return {
    start() {
      if (started || !/^https?:$/.test(location.protocol)) return;
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
    },
  };
})();
