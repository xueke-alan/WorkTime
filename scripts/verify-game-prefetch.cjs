"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const tick = () => new Promise(setImmediate);
async function verify() {
  const handlers = new Map(),
    calls = [],
    gates = [];
  let active = 0,
    maximum = 0,
    fail = false;
  const warmed = [],
    idleWaiters = [];
  let idleAllowed = true;
  const resources = Object.fromEntries(
    [
      "pikafishResources",
      "utttaiResources",
      "rapfiResources",
      "jungleResources",
    ].map((name) => [
      name,
      {
        async prefetch() {
          calls.push(name);
          maximum = Math.max(maximum, ++active);
          try {
            await new Promise((resolve, reject) =>
              gates.push({ resolve, reject }),
            );
            if (fail) throw Error("offline");
          } finally {
            active--;
          }
        },
      },
    ]),
  );
  const context = vm.createContext({
    AbortController,
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null },
    navigator: { onLine: true },
    location: { protocol: "https:" },
    window: {
      addEventListener: (name, handler) => handlers.set(name, handler),
    },
    WorkTimeApp: {
      games: {
        ...resources,
        resources: () => [
          {
            id: "game-snake",
            rules: ["rules.js"],
            style: "snake.css",
            source: "snake.js",
          },
        ],
      },
      services: {
        vocabularyIdle: {
          whenIdle: () =>
            idleAllowed
              ? Promise.resolve()
              : new Promise((resolve) => idleWaiters.push(resolve)),
        },
        assets: {
          whenIdle: async () => {},
          script: async () => {},
          preload: async (path) => {
            warmed.push(path);
            if (warmed.length === 1) idleAllowed = false;
          },
        },
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../assets/js/services/game-prefetch.js"),
      "utf8",
    ),
    context,
  );
  const scheduler = context.WorkTimeApp.services.gamePrefetch;
  scheduler.start();
  scheduler.start();
  await tick();
  assert.equal(warmed.length, 1);
  assert.deepEqual(
    calls,
    [],
    "Interaction pauses warming before any engine download",
  );
  idleAllowed = true;
  idleWaiters.splice(0).forEach((resolve) => resolve());
  await tick();
  assert(warmed.includes("snake.js"));
  assert(warmed.includes("assets/js/ui/music-runtime.min.js"));
  assert(warmed.includes("assets/js/ui/typing-runtime.min.js"));
  assert(warmed.includes("assets/js/ui/reader-runtime.min.js"));
  assert.equal(
    new Set(warmed).size,
    warmed.length,
    "Repeated start deduplicates workspace resources",
  );
  assert.deepEqual(calls, ["pikafishResources"]);
  scheduler.prioritize("game-jungle");
  gates.shift().resolve();
  await tick();
  assert.deepEqual(calls, ["pikafishResources", "jungleResources"]);
  // Reconnection during a still-pending failure must not lose the one retry.
  fail = true;
  handlers.get("online")();
  gates.shift().resolve();
  await tick();
  fail = false;
  assert.equal(calls.at(-1), "jungleResources");
  gates.shift().resolve();
  await tick();
  assert.equal(calls.at(-1), "utttaiResources");
  gates.shift().resolve();
  await tick();
  assert.equal(calls.at(-1), "rapfiResources");
  gates.shift().reject(Error("503"));
  await tick();
  assert.equal(scheduler.status.gomoku, "failed");
  handlers.get("online")();
  await tick();
  gates.shift().reject(Error("503"));
  await tick();
  handlers.get("online")();
  await tick();
  assert.equal(calls.filter((name) => name === "rapfiResources").length, 2);
  assert.equal(maximum, 1, "background engines must not overlap");
  handlers.get("pagehide")();
  scheduler.start();
  await tick();
  assert.equal(active, 0);
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../assets/js/services/vocabulary-idle.js"),
      "utf8",
    ),
    context,
  );
  const idle = context.WorkTimeApp.services.vocabularyIdle;
  let finishLoad;
  const engine = idle.trackModel({
    load: () =>
      new Promise((resolve) => {
        finishLoad = resolve;
      }),
    search: () => Promise.reject(Error("cancelled search")),
  });
  assert.notEqual(
    idle.state.audioPhase,
    "waitingGame",
    "Creating an engine does not pause idle work",
  );
  const loading = engine.load();
  assert.equal(
    idle.state.audioPhase,
    "waitingGame",
    "Actual model loading pauses idle work",
  );
  const finishOther = idle.beginModelTask();
  finishLoad();
  await loading;
  assert.equal(
    idle.state.audioPhase,
    "waitingGame",
    "One completed model cannot release another active model",
  );
  finishOther();
  assert.notEqual(idle.state.audioPhase, "waitingGame");
  await assert.rejects(engine.search(), /cancelled search/);
  assert.notEqual(
    idle.state.audioPhase,
    "waitingGame",
    "Model errors and cancellation release the idle gate",
  );
  let downloadCount = 0,
    idleRequested = false;
  const jungleContext = vm.createContext({
    URL,
    AbortSignal,
    Blob,
    crypto: require("node:crypto").webcrypto,
    document: { baseURI: "https://example.com/" },
    fetch: async () => {
      downloadCount++;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    },
    WorkTimeApp: {
      data: {},
      services: { assets: { script: async () => {} } },
      games: {
        mistyJungleResources: {
          name: "engine.wasm",
          size: 0,
          hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../assets/js/games/jungle-resources.js"),
      "utf8",
    ),
    jungleContext,
  );
  const jungle = jungleContext.WorkTimeApp.games.jungleResources;
  const background = jungle.load("low", () => {
    idleRequested = true;
    return new Promise(() => {});
  });
  await tick();
  assert(idleRequested);
  assert.equal(downloadCount, 0);
  const foreground = jungle.load();
  await tick();
  assert.equal(
    downloadCount,
    1,
    "Foreground Jungle loading releases the shared idle wait without duplicating downloads",
  );
  const buffers = await Promise.all([background, foreground]);
  assert.notEqual(
    buffers[0],
    buffers[1],
    "Workers receive independent buffers",
  );
  console.log(
    "Shared game prefetch: serial work, deduplication, foreground priority and bounded reconnect retries passed.",
  );
}
if (require.main === module)
  verify().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { verify };
