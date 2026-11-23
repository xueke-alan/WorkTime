"use strict";
// Deterministic worker scheduling tests; real WAV/cache tests live separately.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const stored = new Map();
  const idleApp = { services: {} };
  const idleContext = vm.createContext({
    WorkTimeApp: idleApp,
    localStorage: {
      getItem: (key) => stored.get(key),
      setItem: (key, value) => stored.set(key, value),
    },
    setTimeout,
    clearTimeout,
  });
  const idleSource = fs.readFileSync(
    path.join(__dirname, "../assets/js/services/vocabulary-idle.js"),
    "utf8",
  );
  vm.runInContext(idleSource, idleContext);
  assert.equal(idleApp.services.vocabularyIdle.settings.poolSize, "auto");
  idleApp.services.vocabularyIdle.configure({ poolSize: 8 });
  vm.runInContext(idleSource, idleContext);
  assert.equal(idleApp.services.vocabularyIdle.settings.poolSize, 8);
  idleApp.services.vocabularyIdle.configure({ poolSize: 0 });
  assert.equal(idleApp.services.vocabularyIdle.settings.poolSize, 8);
  let running = 0,
    peak = 0,
    generated = 0,
    cleared = 0;
  const starts = [],
    values = new Map();
  const settings = { poolSize: 2, limit: 1000000 };
  const cache = {
    key: (entry, accent) => accent + ":" + entry.word,
    read: async (entry, accent) => values.get(cache.key(entry, accent)),
    write: async (entry, accent, blob, limit, valid) => {
      if (!valid()) return false;
      values.set(cache.key(entry, accent), blob);
      return true;
    },
    validWav: () => true,
    part: async () => new Uint8Array(1),
    clear: async () => {
      values.clear();
      cleared++;
      return true;
    },
    state: { available: true, bytes: 0 },
  };
  class Worker {
    postMessage(data) {
      if (data.type === "init") {
        setTimeout(
          () => this.onmessage?.({ data: { id: data.id, type: "ready" } }),
          0,
        );
        return;
      }
      assert(!this.busy, "one inference per Worker");
      this.busy = true;
      running++;
      generated++;
      peak = Math.max(peak, running);
      starts.push(data.text);
      this.timer = setTimeout(() => {
        this.busy = false;
        running--;
        this.onmessage?.({
          data:
            data.text === "fail"
              ? { id: data.id, type: "error", message: "Resource failure" }
              : { id: data.id, type: "audio", buffer: new ArrayBuffer(100) },
        });
      }, 30);
    }
    terminate() {
      clearTimeout(this.timer);
      if (this.busy) {
        running--;
        this.busy = false;
      }
    }
  }
  const app = {
    services: {
      vocabularyAudioCache: cache,
      vocabularyIdle: {
        settings,
        profile: (accent) => (accent === "us" ? { engine: "supertonic" } : {}),
        configure: (value) => Object.assign(settings, value),
      },
      assets: { scripts: async () => {} },
    },
    data: {
      vocabularyWorkers: { piper: "", supertonic: "" },
      vocabularySpeech: {
        groups: { piper: [], supertonic: [] },
        files: { mjs: {}, wasm: {} },
      },
    },
  };
  const context = vm.createContext({
    WorkTimeApp: app,
    Worker,
    URL,
    Blob,
    Uint8Array,
    ArrayBuffer,
    document: {
      currentScript: {
        src: "https://example.test/assets/js/services/vocabulary-speech.js",
      },
    },
    navigator: { hardwareConcurrency: 8 },
    localStorage: { removeItem() {} },
    indexedDB: {
      open() {
        throw Error("No browser cache in this fixture");
      },
    },
    setTimeout,
    clearTimeout,
    performance,
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../assets/js/services/vocabulary-speech.js"),
      "utf8",
    ),
    context,
  );
  const speech = app.services.vocabularySpeech;
  const synth = (word, options = { background: true }) =>
    speech.synthesize({ word }, "us", options);
  try {
    await Promise.all([synth("a"), synth("b"), synth("c")]);
    assert.equal(peak, 2);
    const before = generated;
    await Promise.all([synth("same"), synth("same"), synth("same", {})]);
    assert.equal(generated - before, 1, "same-key requests share generation");
    const first = synth("occupied1"),
      second = synth("occupied2");
    while (!starts.includes("occupied2")) await wait();
    const background = synth("queued-background");
    const foreground = synth("queued-foreground", {});
    await Promise.all([first, second, background, foreground]);
    assert(starts.includes("queued-foreground"));
    assert(
      !starts.includes("queued-background") ||
        starts.indexOf("queued-foreground") <
          starts.indexOf("queued-background"),
    );
    await synth("queued-background");
    settings.poolSize = 1;
    peak = 0;
    await Promise.all([synth("serial1"), synth("serial2")]);
    assert.equal(peak, 1);
    settings.poolSize = 8;
    peak = 0;
    await Promise.all(Array.from({ length: 8 }, (_, i) => synth("eight" + i)));
    assert(peak <= 8);
    peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => synth("warm-eight" + i)),
    );
    assert.equal(peak, 8);
    const shrinking = Array.from({ length: 8 }, (_, i) => synth("shrink" + i));
    while (running < 8) await wait();
    settings.poolSize = 1;
    const afterShrink = synth("after-shrink");
    await wait();
    assert(!starts.includes("after-shrink"));
    await Promise.all([...shrinking, afterShrink]);
    let valid = true;
    const cancelled = synth("cancelled", {
      background: true,
      valid: () => valid,
    });
    await wait();
    valid = false;
    assert.equal(await cancelled, null);
    assert(!values.has("us:cancelled"));
    const active = synth("clear-active"),
      queued = synth("clear-queued");
    const clearing = speech.clear();
    assert.equal(await synth("during-clear"), null);
    await Promise.allSettled([active, queued, clearing]);
    assert.equal(cleared, 1);
    assert.equal(values.size, 0);
    settings.poolSize = "auto";
    assert.equal(speech.poolSize, 2);
    speech.recordBatch({ count: 8, milliseconds: 100, cold: false, lag: 0 });
    assert.equal(speech.poolSize, 3);
    speech.recordBatch({ count: 8, milliseconds: 100, cold: false, lag: 0 });
    assert.equal(speech.poolSize, 2, "no throughput gain rolls back");
    speech.recordBatch({ count: 8, milliseconds: 100, cold: false, lag: 200 });
    assert.equal(speech.poolSize, 1, "response delay reduces concurrency");
    await assert.rejects(synth("fail"), /Resource failure/);
    assert(await synth("recovery"));
    console.log(
      "Worker pool: 1/2/8 concurrency, deduplication, foreground priority, cancellation, clear, Auto adjustment and error recovery passed.",
    );
  } finally {
    speech.dispose();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
