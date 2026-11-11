"use strict";
/** One background engine at a time. Foreground consumers keep sharing resource promises. */
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
  async function drain() {
    if (running || abort.signal.aborted) return;
    running = true;
    try {
      while (!abort.signal.aborted && navigator.onLine !== false) {
        const job = [...jobs.values()].find((item) => item.state === "queued");
        if (!job) break;
        job.state = "running";
        const attempt = reconnect;
        try {
          const assets = WorkTimeApp.services.assets;
          await assets.whenIdle({ signal: abort.signal });
          if (abort.signal.aborted) break;
          if (navigator.onLine === false) throw Error("Offline");
          const [script, resource] = definitions[job.id];
          await assets.script("assets/js/games/" + script + ".js", {
            fetchPriority: "low",
          });
          await assets.whenIdle({ signal: abort.signal });
          if (abort.signal.aborted) break;
          if (navigator.onLine === false) throw Error("Offline");
          await WorkTimeApp.games[resource].prefetch();
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
      if (abort.signal.aborted || !/^https?:$/.test(location.protocol)) return;
      for (const key of id ? [id] : Object.keys(definitions)) {
        if (!definitions[key]) throw Error("Unknown prefetch job: " + key);
        if (!jobs.has(key))
          jobs.set(key, { id: key, state: "queued", retried: false });
      }
      void drain();
    },
    prioritize(id) {
      const key = id.replace(/^game-/, "");
      const job = jobs.get(key);
      if (job?.state !== "queued") return;
      const rest = [...jobs].filter(([name]) => name !== key);
      jobs.clear();
      jobs.set(key, job);
      for (const [name, item] of rest) jobs.set(name, item);
    },
    get status() {
      return Object.fromEntries([...jobs].map(([id, job]) => [id, job.state]));
    },
  };
})();
