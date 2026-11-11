"use strict";
WorkTimeApp.services.rapfiPrefetch = (() => {
  const abort = new AbortController();
  let started = false;

  async function prefetch() {
    const { assets } = WorkTimeApp.services;
    await assets.whenIdle({ signal: abort.signal });
    if (navigator.onLine === false) throw Error("Offline");
    await assets.script("assets/js/games/gomoku-engine.js", {
      fetchPriority: "low",
    });
    await assets.whenIdle({ signal: abort.signal });
    await WorkTimeApp.games.rapfiResources.prefetch();
  }

  function start() {
    if (started || !/^https?:$/.test(location.protocol)) return;
    started = true;
    const { signal } = abort;
    let reconnected = false;
    const onOnline = () => {
      reconnected = true;
    };
    const retry = () => {
      if (!signal.aborted) void prefetch().catch(() => {});
    };
    window.addEventListener("pagehide", () => abort.abort(), { once: true });
    window.addEventListener("online", onOnline, { signal });
    void prefetch()
      .catch(() => {
        if (signal.aborted) return;
        if (reconnected) retry();
        else window.addEventListener("online", retry, { once: true, signal });
      })
      .finally(() => window.removeEventListener("online", onOnline));
  }

  return { start };
})();
