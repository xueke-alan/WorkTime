"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
module.exports = async function adapterTests(R, site) {
  let created = 0,
    terminated = 0,
    revoked = 0,
    results = 0,
    errors = 0;
  let load = () => Promise.resolve(),
    message;
  let instance;
  class FakeWorker {
    constructor() {
      created++;
      instance = this;
    }
    terminate() {
      terminated++;
    }
    postMessage(data) {
      message = data;
    }
  }
  const context = vm.createContext({
    WorkTimeApp: {
      games: { jungleRules: R, mistyJungleAssets: { worker: "", wasm: "" } },
      services: { assets: { script: () => load() } },
    },
    Worker: FakeWorker,
    location: { protocol: "file:" },
    Blob,
    URL: {
      createObjectURL: () => "blob:test",
      revokeObjectURL: () => revoked++,
    },
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(site, "assets/js/games/jungle-engine.js"),
      "utf8",
    ),
    context,
  );
  const A = context.WorkTimeApp.games.jungleEngine;
  const callbacks = { onResult: () => results++, onError: () => errors++ };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  assert.equal(created, 0, "loading adapter does not load engine");
  A.search(R.create(), "hard", callbacks);
  await tick();
  assert.equal(message.budget, 3000);
  const legal = R.legal(R.create().board, 1)[0];
  const reply = {
    data: {
      engine: "MistyJungle",
      move: Array.from(legal, A.flip),
      depth: 4,
      nodes: 1000,
    },
  };
  instance.onmessage(reply);
  assert.equal(results, 1);
  assert.equal(terminated, 1);
  assert.equal(revoked, 1);
  A.search(R.create(), "easy", callbacks);
  await tick();
  instance.onmessage({ data: { ...reply.data, move: [3, 3] } });
  assert.equal(errors, 1, "illegal move pauses instead of falling back");
  A.search(R.create(), "normal", callbacks);
  await tick();
  instance.onmessage({ data: { error: "WASM initialization failed" } });
  assert.equal(errors, 2);
  const pending = A.search(R.create(), "hard", callbacks);
  await tick();
  pending.cancel();
  instance.onmessage(reply);
  assert.equal(results, 1, "late reply after cancellation is ignored");
  load = () => Promise.reject(Error("local resource missing"));
  A.search(R.create(), "normal", callbacks);
  await tick();
  assert.equal(errors, 3);
  load = () => Promise.resolve();
  A.search(R.create(), "normal", callbacks);
  await tick();
  instance.onmessage(reply);
  assert.equal(
    results,
    2,
    "retry recovers after a local resource load failure",
  );
  let resolveLoad;
  load = () =>
    new Promise((resolve) => {
      resolveLoad = resolve;
    });
  const count = created,
    loading = A.search(R.create(), "hard", callbacks);
  loading.cancel();
  resolveLoad();
  await tick();
  assert.equal(created, count, "cancel during loading creates no worker");
  assert.equal(created, terminated);
  assert.equal(created, revoked);
};
