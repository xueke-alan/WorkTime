"use strict";
/** Warm optional workspaces first, then engines; foreground consumers share the bytes. */
WorkTimeApp.services.gamePrefetch = (() => {
  const definitions = {
    xiangqi: ["xiangqi-engine", "pikafishResources"],
    "ultimate-ttt": ["ultimate-ttt-engine", "utttaiResources"],
    gomoku: ["gomoku-engine", "rapfiResources"],
    jungle: ["jungle-resources", "jungleResources"],
  };
  const jobs = new Map();
  const abort = new AbortController();
  let running = false,
    reconnect = 0;
  async function waitForIdle() {
    const { assets, vocabularyIdle } = WorkTimeApp.services;
    await vocabularyIdle.whenIdle({ signal: abort.signal });
    await assets.whenIdle({ signal: abort.signal });
    // Input may have started while a foreground resource was still loading.
    await vocabularyIdle.whenIdle({ signal: abort.signal });
  }
  function queueAssets() {
    const add = (id, paths) => {
      if (!jobs.has(id))
        jobs.set(id, {
          id,
          paths: [...new Set(paths)],
          state: "queued",
          retried: false,
        });
    };
    add("shared", [
      "assets/js/ui/secondary-runtime.min.js",
      "assets/css/game-session.css",
    ]);
    for (const game of WorkTimeApp.games.resources())
      add(game.id, [...game.rules, game.style, game.source]);
    for (const app of ["music", "typing", "reader"])
      add("app-" + app, [
        "assets/css/" + app + ".css",
        "assets/js/ui/" + app + "-runtime.min.js",
      ]);
    add(
      "typing-lessons",
      Array.from(
        { length: 12 },
        (_, i) => "assets/data/typing/en-" + (i + 1) + ".js",
      ),
    );
  }
  async function drain() {
    if (running || abort.signal.aborted) return;
    running = true;
    try {
      while (!abort.signal.aborted) {
        const job = [...jobs.values()].find((item) => item.state === "queued");
        if (!job) break;
        job.state = "running";
        const attempt = reconnect;
        try {
          const assets = WorkTimeApp.services.assets;
          await waitForIdle();
          if (abort.signal.aborted) break;
          if (/^https?:$/.test(location.protocol) && navigator.onLine === false)
            throw Error("Offline");
          if (job.paths) {
            for (const path of job.paths) {
              await waitForIdle();
              await assets.preload(path, path.endsWith(".css"));
            }
          } else {
            const [script, resource] = definitions[job.id];
            await assets.script("assets/js/games/" + script + ".js", {
              fetchPriority: "low",
            });
            await waitForIdle();
            await WorkTimeApp.games[resource].prefetch(undefined, {
              waitForIdle,
            });
          }
          job.state = abort.signal.aborted ? "cancelled" : "complete";
        } catch {
          job.state = abort.signal.aborted ? "cancelled" : "failed";
          // A reconnect can arrive while a failed request is still settling.
          if (!job.retried && reconnect > attempt) {
            job.retried = true;
            job.state = "queued";
          }
        }
      }
    } finally {
      running = false;
    }
  }
  window.addEventListener(
    "online",
    () => {
      reconnect++;
      for (const job of jobs.values())
        if (job.state === "failed" && !job.retried) {
          job.retried = true;
          job.state = "queued";
        }
      void drain();
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    "pagehide",
    () => {
      abort.abort();
      for (const job of jobs.values())
        if (job.state === "running" || job.state === "queued")
          job.state = "cancelled";
    },
    { once: true },
  );
  return {
    start(id) {
      if (abort.signal.aborted) return;
      if (!id) queueAssets();
      if (!/^https?:$/.test(location.protocol)) {
        void drain();
        return;
      }
      for (const key of id ? [id] : Object.keys(definitions)) {
        if (!definitions[key]) throw Error("Unknown prefetch job: " + key);
        if (!jobs.has(key))
          jobs.set(key, { id: key, state: "queued", retried: false });
      }
      void drain();
    },
    prioritize(id) {
      const key = id.replace(/^game-/, "");
      for (const candidate of [key, "game-" + key]) {
        const job = jobs.get(candidate);
        if (job?.state !== "queued") continue;
        const rest = [...jobs].filter(([name]) => name !== candidate);
        jobs.clear();
        jobs.set(candidate, job);
        for (const [name, item] of rest) jobs.set(name, item);
      }
    },
    get status() {
      return Object.fromEntries([...jobs].map(([id, job]) => [id, job.state]));
    },
  };
})();
