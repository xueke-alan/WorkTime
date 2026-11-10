"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function verify() {
  const scripts = [],
    workers = [],
    timers = new Set();
  const context = vm.createContext({
    WorkTimeApp: { games: {}, data: {} },
    document: {
      baseURI: "file:///worktime/index.html",
      createElement: () => ({
        remove() {
          this.removed = true;
        },
      }),
      head: { append: (script) => scripts.push(script) },
    },
    Blob: class {},
    location: { protocol: "file:" },
    URL: class extends URL {
      static createObjectURL() {
        return "blob:engine";
      }
      static revokeObjectURL() {}
    },
    Worker: class {
      constructor() {
        workers.push(this);
      }
      terminate() {
        this.terminated = true;
      }
      postMessage(message) {
        this.message = message;
      }
    },
    setTimeout(callback) {
      timers.add(callback);
      return callback;
    },
    clearTimeout(callback) {
      timers.delete(callback);
    },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../assets/js/games/xiangqi-engine.js"),
      "utf8",
    ),
    context,
  );
  const engine = context.WorkTimeApp.games.createXiangqiEngine();
  const first = engine.load();
  assert.equal(engine.load(), first, "concurrent callers share initialization");
  const late = scripts[0].onload;
  const timedOut = assert.rejects(first, /timed out/);
  [...timers][0]();
  await timedOut;
  assert.equal(scripts[0].removed, true);
  const retry = engine.load();
  late();
  assert.equal(
    workers.length,
    0,
    "timed-out resources cannot start a worker during retry",
  );
  scripts[1].onload();
  assert.equal(workers.length, 1);
  workers[0].onmessage({ data: { type: "ready" } });
  await retry;
  const search = engine.search("position", "normal");
  const disposed = assert.rejects(search, /disposed/);
  await Promise.resolve();
  engine.dispose();
  await disposed;
  assert.equal(workers[0].terminated, true);
  assert.equal(timers.size, 0);
  await assert.rejects(engine.load(), /disposed/);

  const another = context.WorkTimeApp.games.createXiangqiEngine();
  const pending = another.load();
  const callback = scripts[2].onload;
  const rejected = assert.rejects(pending, /disposed/);
  another.dispose();
  callback();
  await rejected;
  assert.equal(
    workers.length,
    1,
    "disposing during resource loading prevents late workers",
  );
  assert.equal(timers.size, 0);
  console.log(
    "Xiangqi engine timeout, retry, late resources and disposal verified.",
  );
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
