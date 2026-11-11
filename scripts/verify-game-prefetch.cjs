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
    navigator: { onLine: true },
    location: { protocol: "https:" },
    window: {
      addEventListener: (name, handler) => handlers.set(name, handler),
    },
    WorkTimeApp: {
      games: resources,
      services: {
        assets: {
          whenIdle: async () => {},
          script: async () => {},
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
