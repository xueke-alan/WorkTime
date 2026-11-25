"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const root = path.resolve(__dirname, "..");

async function main() {
  const server = await runtimeServer(root);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() =>
      localStorage.setItem(
        "worktime.vocabulary.audio-settings",
        JSON.stringify({ enabled: true, paused: true, limit: 2147483648 }),
      ),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.equal(
      await page.evaluate(() => !!WorkTimeApp.services.vocabularySpeech),
      false,
    );
    await page.evaluate(() => WorkTimeApp.services.vocabularyIdle.load());
    const result = await page.evaluate(async () => {
      const S = WorkTimeApp.services,
        cache = S.vocabularyAudioCache,
        idle = S.vocabularyIdle,
        speech = S.vocabularySpeech;
      idle.dispose();
      const check = (condition, message) => {
        if (!condition) throw Error(message);
      };
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("vocabulary-cache-test", {
        create: true,
      });
      let available = true,
        revision = 1;
      S.runtimeFolder = {
        initialize: async () => {},
        get state() {
          return {
            status: available ? "available" : "permission",
            revision,
            busy: false,
          };
        },
        withEnglish: async (action) =>
          available
            ? navigator.locks.request("vocabulary-cache-test-files", () =>
                action(directory),
              )
            : null,
        subscribe: () => () => {},
      };
      await cache.clear();
      function wav(sampleRate = 44100) {
        const bytes = new ArrayBuffer(244),
          v = new DataView(bytes);
        const label = (offset, text) =>
          [...text].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
        label(0, "RIFF");
        v.setUint32(4, 236, true);
        label(8, "WAVEfmt ");
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, sampleRate, true);
        v.setUint32(28, sampleRate * 2, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        label(36, "data");
        v.setUint32(40, 200, true);
        return new Blob([bytes], { type: "audio/wav" });
      }
      const entry = { word: "cache-fixture", books: ["daily"] },
        blob = wav();
      const currentKey = JSON.parse(cache.key(entry, "us"));
      check(
        currentKey[0] === "supertonic-3-v1",
        "Fixed US Supertonic identity",
      );
      const legacyKey = [...currentKey];
      legacyKey[4] = "obsolete-voice";
      check(
        cache.progress([JSON.stringify(legacyKey)]).generatedTotal === 0,
        "Unselected audio is excluded from progress",
      );
      for (const property of ["speaker", "noiseScale", "noiseW", "speed"]) {
        const profile = WorkTimeApp.services.vocabularyIdle.profile("uk");
        profile[property] += 0.1;
        check(
          cache.key(entry, "uk", profile) !== cache.key(entry, "uk"),
          "Piper parameter changes isolate audio: " + property,
        );
      }
      check(await cache.write(entry, "us", blob, 100000), "File cache write");
      check(
        (await cache.read(entry, "us"))?.size === blob.size,
        "File cache read",
      );
      const audioRoot = await directory.getDirectoryHandle("audio");
      const retiredDir = await (
        await audioRoot.getDirectoryHandle("piper-amy-aru-v1", { create: true })
      ).getDirectoryHandle("uk", { create: true });
      const retiredKey = cache.key(entry, "uk", {
        voice: "en_GB-aru-medium",
        speed: 1,
        speaker: 0,
        noiseScale: 0.5,
        noiseW: 0.333,
      });
      const retiredName = await cache.hash(
        new TextEncoder().encode(retiredKey),
      );
      async function seed(dir, name, value) {
        const stream = await (
          await dir.getFileHandle(name, { create: true })
        ).createWritable();
        await stream.write(value);
        await stream.close();
      }
      await seed(retiredDir, retiredName + ".wav", wav(22050));
      await seed(
        retiredDir,
        retiredName + ".json",
        JSON.stringify({ key: retiredKey }),
      );
      await seed(retiredDir, "notes.json", "keep");
      const modelDir = await directory.getDirectoryHandle("resources-piper", {
        create: true,
      });
      const retiredModel =
        "en-en_GB-aru-medium-en_GB-aru-medium.onnx-" + "a".repeat(64) + ".bin";
      const currentModel =
        "en-en_GB-jenny_dioco-medium-en_GB-jenny_dioco-medium.onnx-" +
        "a".repeat(64) +
        ".bin";
      await seed(modelDir, retiredModel, "retired");
      await seed(modelDir, currentModel, "current");
      revision++;
      await cache.verify();
      while (!(await cache.info()).bytesExact)
        await new Promise((resolve) => setTimeout(resolve, 0));
      const exists = async (dir, name) => {
        try {
          await dir.getFileHandle(name);
          return true;
        } catch (error) {
          if (error.name === "NotFoundError") return false;
          throw error;
        }
      };
      check(
        !(await exists(retiredDir, retiredName + ".wav")) &&
          !(await exists(retiredDir, retiredName + ".json")),
        "Retired voice audio is cleaned up",
      );
      check(
        !(await exists(modelDir, retiredModel)),
        "Retired model resource is cleaned up",
      );
      check(
        await exists(modelDir, currentModel),
        "Current Jenny resource is preserved",
      );
      check(
        await exists(retiredDir, "notes.json"),
        "Unknown files are preserved",
      );
      check(
        (await cache.read(entry, "us"))?.size === blob.size,
        "Current Supertonic audio is preserved",
      );
      check((await cache.read(entry, "uk")) === null, "Accent isolation");
      check(
        cache.key(entry, "us") !== cache.key(entry, "uk"),
        "Accent-specific cache identities",
      );
      check(
        cache.key(entry, "uk", { voice: "M1", speed: 1, steps: 16 }) !==
          cache.key(entry, "uk"),
        "Voice changes isolate cached audio",
      );
      await cache.write(entry, "uk", wav(22050), 100000);
      check(
        (await cache.read(entry, "uk"))?.size === blob.size,
        "UK file cache read",
      );
      check(
        (await cache.read(entry, "us"))?.size === blob.size,
        "UK cache preserves US audio",
      );
      check(
        cache.state.available,
        "Cache miss must not mark directory unavailable",
      );
      let capacity = false;
      try {
        await cache.write({ word: "over-limit" }, "us", blob, blob.size);
      } catch (error) {
        capacity = error.cacheCode === "capacity";
      }
      check(capacity, "Capacity stops rather than evicts");
      check(
        (await cache.read(entry, "us")) !== null,
        "Capacity preserves cached audio",
      );
      const name = await cache.hash(
        new TextEncoder().encode(cache.key(entry, "us")),
      );
      const vocabulary = directory;
      const audio = await vocabulary.getDirectoryHandle("audio");
      const version = await audio.getDirectoryHandle("supertonic-3-v1");
      const accent = await version.getDirectoryHandle("us");
      const bucket = await accent.getDirectoryHandle(name.slice(0, 2));
      const corrupt = await (
        await bucket.getFileHandle(name + ".wav")
      ).createWritable();
      const damaged = new Uint8Array(await blob.arrayBuffer());
      damaged[100] = 99;
      await corrupt.write(damaged);
      await corrupt.close();
      check(
        (await cache.read(entry, "us")) === null,
        "PCM corruption detected by checksum",
      );
      await cache.write(entry, "us", blob, 100000);
      const originalCatalog = WorkTimeApp.data.vocabularyCatalog.entries;
      WorkTimeApp.data.vocabularyCatalog.entries = [
        entry,
        { ...entry, id: "duplicate" },
      ];
      check(
        cache.progress().generatedTotal === 2 &&
          cache.progress().audioTotal === 2,
        "Global progress combines UK and US and deduplicates shared words",
      );
      S.vocabularyIdle.configure({ models: { us: "piper", uk: "aru" } });
      check(
        S.vocabularyIdle.profile("us").voice === "F1" &&
          S.vocabularyIdle.profile("uk").voice === "en_GB-jenny_dioco-medium",
        "Removed model choices cannot change fixed voices",
      );
      check(
        S.vocabularyIdle.settings.models === undefined,
        "Removed model choices are not saved",
      );
      const oldSpeed = cache.key(entry, "us", {
        voice: "F1",
        speed: 1,
        steps: 16,
      });
      check(
        cache.progress([cache.key(entry, "us"), oldSpeed]).generatedTotal === 2,
        "Browser and file caches do not double-count; old parameters are excluded",
      );
      WorkTimeApp.data.vocabularyCatalog.entries = originalCatalog;
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const spec = { bytes: 4, sha256: await cache.hash(bytes) };
      let loads = 0;
      const load = async () => {
        loads++;
        return bytes;
      };
      await cache.part("fixture", spec, load);
      await cache.part("fixture", spec, load);
      check(loads === 1, "Model resource reused from disk");
      const resources = await vocabulary.getDirectoryHandle("resources-piper");
      const stream = await (
        await resources.getFileHandle("fixture-" + spec.sha256 + ".bin")
      ).createWritable();
      await stream.write(new Uint8Array([9, 9, 9, 9]));
      await stream.close();
      await cache.part("fixture", spec, load);
      check(loads === 2, "Corrupt model resource repaired");
      let workers = 0,
        terminated = 0,
        generated = 0;
      let hold = false,
        began,
        finish;
      const order = [];
      const assets = S.assets;
      S.assets = {
        ...assets,
        scripts: async (paths) => {
          if (paths.includes("assets/vendor/vocabulary/manifest.js")) {
            const empty = {
              bytes: 0,
              sha256: await cache.hash(new Uint8Array()),
              parts: [],
            };
            WorkTimeApp.data.vocabularySpeech = {
              groups: { supertonic: [] },
              files: { mjs: empty, wasm: empty },
            };
            WorkTimeApp.data.vocabularyWorkers = {
              supertonic: "// test worker",
            };
          } else await assets.scripts(paths);
        },
      };
      window.Worker = class {
        constructor() {
          workers++;
        }
        terminate() {
          terminated++;
        }
        async postMessage(data) {
          if (data.type === "init")
            this.onmessage({ data: { id: data.id, type: "ready" } });
          else {
            generated++;
            order.push(data.text);
            if (hold) {
              hold = false;
              await new Promise((resolve) => {
                finish = resolve;
                began();
              });
            }
            this.onmessage({
              data: {
                id: data.id,
                type: "audio",
                buffer: await blob.arrayBuffer(),
              },
            });
          }
        }
      };
      await speech.synthesize(entry, "us");
      check(
        workers === 0 && generated === 0,
        "Cache hit does not initialize model",
      );
      const missing = { word: "missing-fixture" };
      const phases = new Set();
      const unsubscribePhases = speech.subscribe(() =>
        phases.add(speech.phase),
      );
      await speech.synthesize(missing, "us");
      await speech.synthesize(missing, "us");
      check(
        speech.currentWord === "",
        "Completed synthesis clears current word",
      );
      check(
        workers === 1 && generated === 1,
        "Missing audio generated once and reused",
      );
      await speech.synthesize({ word: "background-fixture" }, "us", {
        background: true,
      });
      check(generated === 2, "Background inference fills missing audio");
      const oldProfile = { voice: "F1", speed: 1, steps: 16 };
      check(
        cache.key(missing, "us", oldProfile) !== cache.key(missing, "us"),
        "Old speed cache is isolated",
      );
      check(
        (await cache.read(missing, "us", oldProfile)) === null,
        "Old speed cannot match current audio",
      );
      available = false;
      revision++;
      await speech.synthesize({ word: "browser-fallback" }, "us");
      await speech.synthesize({ word: "browser-fallback" }, "us");
      unsubscribePhases();
      for (const phase of [
        "checkingFiles",
        "checkingBrowser",
        "loadingResources",
        "initializingModel",
        "generating",
        "savingFiles",
        "savingBrowser",
      ])
        check(phases.has(phase), "Speech lifecycle reports " + phase);
      check(
        generated === 3,
        "Browser fallback cache avoids repeated inference",
      );
      available = true;
      revision++;
      hold = true;
      const started = new Promise((resolve) => {
        began = resolve;
      });
      let current = true;
      const stale = speech.synthesize({ word: "stale-profile" }, "us", {
        valid: () => current,
      });
      await started;
      check(
        speech.currentWord === "stale-profile",
        "Current word is exposed during synthesis",
      );
      current = false;
      check(
        speech.currentWord === "",
        "Cancelled synthesis hides current word",
      );
      finish();
      check(
        (await stale) === null,
        "An in-flight old voice result is discarded",
      );
      check(
        (await cache.read({ word: "stale-profile" }, "us", {
          voice: "F1",
          speed: 1.05,
          steps: 16,
        })) === null,
        "Stale voice audio is not written",
      );

      hold = true;
      const bgStarted = new Promise((resolve) => {
        began = resolve;
      });
      const background = speech.synthesize({ word: "held-background" }, "us", {
        background: true,
      });
      await bgStarted;
      const NativeAudio = window.Audio;
      let finishPlayback;
      window.Audio = class {
        paused = false;
        ended = false;
        addEventListener(type, listener) {
          if (type === "ended") finishPlayback = listener;
        }
        async play() {}
        pause() {
          this.paused = true;
        }
      };
      let playbackNotifications = 0;
      const unsubscribePlayback = speech.subscribe(
        () => playbackNotifications++,
      );
      check(
        await speech.play(missing, "us"),
        "Cached file plays while background inference is held",
      );
      check(
        speech.currentWord === "held-background" && playbackNotifications === 0,
        "Cached playback does not touch background status or its queue",
      );
      unsubscribePlayback();
      check(!speech.active, "Cached playback leaves idle generation eligible");
      const skipped = speech.synthesize({ word: "queued-background" }, "us", {
        background: true,
      });
      const foreground = speech.synthesize(
        { word: "priority-foreground" },
        "us",
      );
      check(
        speech.currentWord === "held-background",
        "Queued requests do not replace the active word",
      );
      finish();
      await Promise.all([background, skipped, foreground]);
      check(
        !order.includes("queued-background") &&
          order.at(-1) === "priority-foreground",
        "Foreground waits for only the active background job",
      );
      for (const entry of [missing, { word: "browser-fallback" }]) {
        const count = generated;
        check(await speech.play(entry, "us"), "Cached audio plays");
        check(
          generated === count,
          "Playback uses existing file or browser audio",
        );
        check(
          await speech.synthesize({ word: `idle-during-${entry.word}` }, "us", {
            background: true,
            canStart: () => !speech.active,
          }),
          "Next background word starts before cached playback ends",
        );
      }
      check(
        await speech.play({ word: "fresh-playback" }, "us"),
        "Uncached audio plays",
      );
      check(speech.active, "Fresh playback retains foreground priority");
      finishPlayback();
      check(!speech.active, "Playback ending clears foreground priority");
      await speech.play({ word: "fresh-playback-stop" }, "us");
      speech.stop();
      check(!speech.active, "Stopping playback clears foreground priority");
      window.Audio = NativeAudio;
      window.speechCounters = () => ({ workers, terminated, generated });
      return { workers, terminated, generated, resourceLoads: loads };
    });
    console.log(
      "Stored cache preservation, resource hashes and on-demand model isolation:",
      result,
    );
    await page.clock.install();
    await page.evaluate(() =>
      WorkTimeApp.services.vocabularySpeech.synthesize(
        { word: "release-timer" },
        "us",
      ),
    );
    const before = await page.evaluate(
      () => window.speechCounters().terminated,
    );
    await page.clock.runFor(59999);
    assert.equal(
      await page.evaluate(() => window.speechCounters().terminated),
      before,
    );
    await page.clock.runFor(2);
    assert.equal(
      await page.evaluate(() => window.speechCounters().terminated),
      before + 1,
      "Idle model is released",
    );
    await page.evaluate(() => {
      const S = WorkTimeApp.services;
      window.cacheCalls = [];
      const data = S.vocabularyStorage.defaults();
      data.settings.dailyTotal = 1;
      S.vocabularyStorage.read = () => data;
      WorkTimeApp.data.vocabularyCatalog.entries = [
        { id: "a", word: "alpha", books: ["daily"] },
        { id: "b", word: "beta", books: ["daily"] },
        { id: "c", word: "alpha", books: ["daily"] },
      ];
      S.vocabularySpeech = {
        active: false,
        poolSize: 1,
        metrics: { generatedCount: 0, coldCount: 0 },
        recordBatch() {},
        subscribe: () => () => {},
        stop() {},
        release() {},
        async synthesize(entry, accent, options) {
          if (options.valid()) window.cacheCalls.push([entry.word, accent]);
          return new Blob(["audio"]);
        },
      };
      S.vocabularyIdle.dispose();
      S.vocabularyIdle.configure({ enabled: true, paused: false });
      S.vocabularyIdle.start();
    });
    await page.clock.runFor(1999);
    assert.equal(await page.evaluate(() => window.cacheCalls.length), 0);
    await page.clock.runFor(5000);
    assert.deepEqual(await page.evaluate(() => window.cacheCalls), [
      ["alpha", "us"],
      ["alpha", "uk"],
      ["beta", "us"],
      ["beta", "uk"],
    ]);
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.vocabularyIdle.state.status,
      ),
      "complete",
    );
    await page.evaluate(() => {
      const S = WorkTimeApp.services;
      window.savedPriorityRead = S.vocabularyStorage.read;
      window.savedPriorityEntries = WorkTimeApp.data.vocabularyCatalog.entries;
      const data = S.vocabularyStorage.defaults();
      data.settings.accent = "uk";
      data.settings.dailyTotal = 4;
      data.logs = [
        { id: "learned", at: new Date().toISOString(), first: false },
      ];
      data.cards["recall:due"] = {
        due: new Date(Date.now() - 1000).toISOString(),
      };
      WorkTimeApp.data.vocabularyCatalog.entries = [
        {
          id: "new",
          word: "new-word",
          books: ["daily"],
          examples: [
            { en: "new-example" },
            { en: "shared-example" },
            { en: "a simple phrase", kind: "phrase" },
            { en: "new-word" },
          ],
        },
        {
          id: "global",
          word: "global-word",
          books: ["ielts"],
          examples: [{ en: "global-example" }, { en: "shared-example" }],
        },
        {
          id: "due",
          word: "due-word",
          books: ["daily"],
          examples: [{ en: "due-example" }, { en: "shared-example" }],
        },
        {
          id: "learned",
          word: "learned-word",
          books: ["ielts"],
          examples: [{ en: "learned-example" }],
        },
      ];
      S.vocabularyStorage.read = () => data;
      S.vocabularyIdle.configure({ paused: false });
    });
    await page.clock.runFor(5000);
    const priorityOrder = [
      ["due-word", "uk"],
      ["new-word", "uk"],
      ["learned-word", "uk"],
      ["due-word", "us"],
      ["new-word", "us"],
      ["learned-word", "us"],
      ["due-example", "uk"],
      ["shared-example", "uk"],
      ["new-example", "uk"],
      ["a simple phrase", "uk"],
      ["learned-example", "uk"],
      ["due-example", "us"],
      ["shared-example", "us"],
      ["new-example", "us"],
      ["a simple phrase", "us"],
      ["new-word", "us"],
      ["learned-example", "us"],
      ["global-word", "uk"],
      ["global-word", "us"],
      ["global-example", "uk"],
      ["global-example", "us"],
    ];
    assert.deepEqual(
      await page.evaluate(() => window.cacheCalls.slice(-21)),
      priorityOrder,
      "Eight phases prioritize both word accents, then today's examples, all words, and remaining examples",
    );
    assert.deepEqual(
      await page.evaluate(() => {
        const S = WorkTimeApp.services;
        const keys = window.cacheCalls
          .slice(-21)
          .map(([word, accent], index, calls) => {
            const example =
              word.includes("example") ||
              word === "a simple phrase" ||
              calls
                .slice(0, index)
                .some(([w, a]) => w === word && a === accent);
            return S.vocabularyAudioCache.key(
              { word, ...(example ? { kind: "example" } : {}) },
              accent,
            );
          });
        return {
          completed: S.vocabularyIdle.state.completed,
          total: S.vocabularyIdle.state.total,
          progress: S.vocabularyAudioCache.progress([
            ...keys,
            ...keys,
            S.vocabularyAudioCache.key({ word: "unrelated-audio" }, "uk"),
          ]),
        };
      }),
      {
        completed: 21,
        total: 21,
        progress: { generatedTotal: 21, audioTotal: 21, progressExact: true },
      },
      "Progress counts unique word and example audio across both accents",
    );
    console.log("Background priority and exact audio progress verified.");
    await page.evaluate(() => {
      WorkTimeApp.services.vocabularyStorage.read().settings.accent = "us";
      WorkTimeApp.services.vocabularyIdle.configure({ paused: false });
    });
    await page.clock.runFor(5000);
    assert.deepEqual(
      await page.evaluate(() => window.cacheCalls.slice(-21)),
      priorityOrder
        .filter(
          ([word, accent], index) =>
            !(word === "new-word" && accent === "us" && index > 10),
        )
        .map(([word, accent]) => [word, accent === "uk" ? "us" : "uk"])
        .flatMap((item) =>
          item[0] === "learned-example" && item[1] === "us"
            ? [["new-word", "us"], item]
            : [item],
        ),
      "Changing the selected accent rebuilds all eight phases",
    );
    await page.evaluate(() => {
      const S = WorkTimeApp.services;
      const speech = S.vocabularySpeech;
      const cache = S.vocabularyAudioCache;
      const originalSynthesize = speech.synthesize;
      const originalInfo = cache.info;
      window.studyCacheChecks = 0;
      cache.info = async (...args) => {
        window.studyCacheChecks++;
        return originalInfo(...args);
      };
      speech.synthesize = async (entry, accent, options) => {
        speech.synthesize = originalSynthesize;
        await new Promise((resolve) => {
          window.finishStudyBatch = resolve;
        });
        window.studyBatchStillValid = options.valid();
        return originalSynthesize(entry, accent, options);
      };
      window.restoreStudyCacheInfo = () => {
        cache.info = originalInfo;
      };
      S.vocabularyIdle.configure({ paused: false });
    });
    await page.clock.runFor(1500);
    await page.waitForFunction(() => !!window.finishStudyBatch);
    await page.evaluate(() => {
      const S = WorkTimeApp.services;
      S.vocabularyStorage.read().logs.push({
        id: "global",
        at: new Date().toISOString(),
        first: false,
      });
      window.dispatchEvent(new Event("pageshow"));
      window.studyQueueAfterReview = S.vocabularyIdle.state.status;
      window.finishStudyBatch();
    });
    await page.clock.runFor(5000);
    assert.deepEqual(
      await page.evaluate(() => {
        window.restoreStudyCacheInfo();
        return [
          window.studyBatchStillValid,
          window.studyQueueAfterReview,
          window.studyCacheChecks,
        ];
      }),
      [true, "running", 1],
      "Study updates preserve in-flight results and reuse folder preparation",
    );
    const learnedOrder = [
      ...["us", "uk"].flatMap((accent) =>
        ["due-word", "new-word", "global-word", "learned-word"].map((word) => [
          word,
          accent,
        ]),
      ),
      ...["us", "uk"].flatMap((accent) =>
        [
          "due-example",
          "shared-example",
          "new-example",
          "a simple phrase",
          ...(accent === "us" ? ["new-word"] : []),
          "global-example",
          "learned-example",
        ].map((word) => [word, accent]),
      ),
    ];
    assert.deepEqual(
      await page.evaluate(() => window.cacheCalls.slice(-21)),
      learnedOrder,
      "A newly studied word and its examples move into today's phases",
    );
    const priorityTime = await page.evaluate(() => Date.now());
    const completedCalls = await page.evaluate(() => window.cacheCalls.length);
    await page.clock.setSystemTime(priorityTime + 86400000);
    await page.clock.runFor(11000);
    assert.equal(
      await page.evaluate(() => window.cacheCalls.length),
      completedCalls,
      "A new day does not replay a fully processed audio queue",
    );
    await page.evaluate(() =>
      WorkTimeApp.services.vocabularyIdle.configure({ paused: false }),
    );
    await page.clock.runFor(5000);
    const nextDayOrder = [
      ...["us", "uk"].flatMap((accent) =>
        ["due-word", "new-word"].map((word) => [word, accent]),
      ),
      ...["us", "uk"].flatMap((accent) =>
        [
          "due-example",
          "shared-example",
          "new-example",
          "a simple phrase",
          ...(accent === "us" ? ["new-word"] : []),
        ].map((word) => [word, accent]),
      ),
      ...["us", "uk"].flatMap((accent) =>
        ["global-word", "learned-word"].map((word) => [word, accent]),
      ),
      ...["us", "uk"].flatMap((accent) =>
        ["global-example", "learned-example"].map((word) => [word, accent]),
      ),
    ];
    assert.deepEqual(
      await page.evaluate(() => window.cacheCalls.slice(-21)),
      nextDayOrder,
      "After midnight yesterday's learned examples return behind all words",
    );
    console.log("Accent changes and midnight queue refresh verified.");
    await page.clock.setSystemTime(priorityTime);
    await page.evaluate(() => {
      WorkTimeApp.services.vocabularyStorage.read = window.savedPriorityRead;
      WorkTimeApp.data.vocabularyCatalog.entries = window.savedPriorityEntries;
    });
    // A new queue for each scenario, without resetting the interaction cooldown.
    const beforeCachedBatch = await page.evaluate(() => {
      window.savedIdleEntries = WorkTimeApp.data.vocabularyCatalog.entries;
      WorkTimeApp.data.vocabularyCatalog.entries = Array.from(
        { length: 600 },
        (_, i) => ({
          id: "cached-" + i,
          word: "cached-" + i,
          books: ["daily"],
        }),
      );
      WorkTimeApp.services.vocabularyIdle.configure({ paused: false });
      return window.cacheCalls.length;
    });
    await page.clock.runFor(5000);
    assert.equal(
      await page.evaluate(() => window.cacheCalls.length),
      beforeCachedBatch + 1200,
      "Cached batches do not incur a 250 ms delay per word",
    );
    await page.evaluate(() => {
      WorkTimeApp.data.vocabularyCatalog.entries = window.savedIdleEntries;
    });
    async function restartQueue() {
      await page.evaluate(() =>
        WorkTimeApp.services.vocabularyIdle.configure({ paused: false }),
      );
    }
    async function calls() {
      return page.evaluate(() => window.cacheCalls.length);
    }
    let baseline = await calls();
    await restartQueue();
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => {
        window.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 40, clientY: 40 }),
        );
        window.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: 2,
            clientX: 40,
            clientY: 40,
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            pointerId: 2,
            clientX: 40,
            clientY: 40,
          }),
        );
        window.dispatchEvent(new Event("click"));
        window.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new WheelEvent("wheel"));
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown" }),
        );
      });
      await page.clock.runFor(1000);
    }
    assert.equal(
      await calls(),
      baseline + 4,
      "Browsing never resets the generation cooldown",
    );
    await page.evaluate(() => {
      const input = document.createElement("textarea");
      input.id = "idleEditFixture";
      document.body.append(input);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    baseline = await calls();
    await restartQueue();
    await page.clock.runFor(1500);
    assert.equal(await calls(), baseline, "Editing defers next word");
    await page.clock.runFor(4000);
    assert.equal(
      await calls(),
      baseline + 4,
      "Editing resumes after a short cooldown",
    );
    await page.evaluate(() =>
      document
        .getElementById("idleEditFixture")
        .dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        ),
    );
    baseline = await calls();
    await restartQueue();
    await page.clock.runFor(6000);
    assert.equal(
      await calls(),
      baseline,
      "Composition remains blocked until it ends",
    );
    await page.evaluate(() =>
      document
        .getElementById("idleEditFixture")
        .dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true }),
        ),
    );
    await page.clock.runFor(1500);
    assert.equal(await calls(), baseline);
    await page.clock.runFor(4000);
    assert.equal(await calls(), baseline + 4);
    for (const kind of ["pointer", "native", "agenda", "model"]) {
      baseline = await calls();
      await page.evaluate((kind) => {
        if (kind === "pointer") {
          window.dispatchEvent(
            new PointerEvent("pointerdown", {
              pointerId: 7,
              clientX: 0,
              clientY: 0,
            }),
          );
          window.dispatchEvent(
            new PointerEvent("pointermove", {
              pointerId: 7,
              clientX: 20,
              clientY: 0,
            }),
          );
        }
        if (kind === "native") window.dispatchEvent(new Event("dragstart"));
        if (kind === "agenda")
          document.body.classList.add("agenda-is-resizing");
        if (kind === "model")
          window.finishModelTask =
            WorkTimeApp.services.vocabularyIdle.beginModelTask();
      }, kind);
      await restartQueue();
      await page.clock.runFor(6000);
      assert.equal(await calls(), baseline, kind + " blocks new jobs");
      await page.evaluate((kind) => {
        if (kind === "pointer")
          window.dispatchEvent(
            new PointerEvent("pointercancel", { pointerId: 7 }),
          );
        if (kind === "native") window.dispatchEvent(new Event("dragend"));
        if (kind === "agenda")
          document.body.classList.remove("agenda-is-resizing");
        if (kind === "model") window.finishModelTask();
      }, kind);
      await page.clock.runFor(1500);
      assert.equal(await calls(), baseline);
      await page.clock.runFor(4000);
      assert.equal(await calls(), baseline + 4, kind + " resumes");
    }
    // Interaction during synthesis must preserve the current result, but defer the next item.
    baseline = await calls();
    await page.evaluate(() => {
      window.savedDuringEdit = 0;
      window.bgStarted = false;
      WorkTimeApp.services.vocabularySpeech.synthesize = async (
        entry,
        accent,
        options,
      ) => {
        window.cacheCalls.push([entry.word, accent]);
        window.bgStarted = true;
        if (window.savedDuringEdit > 0) return new Blob(["audio"]);
        await new Promise((resolve) => {
          window.finishBackground = resolve;
        });
        if (options.valid()) window.savedDuringEdit++;
        return new Blob(["audio"]);
      };
    });
    await restartQueue();
    await page.clock.runFor(1500);
    await page.waitForFunction(() => window.bgStarted);
    await page.evaluate(() => {
      document
        .getElementById("idleEditFixture")
        .dispatchEvent(new InputEvent("input", { bubbles: true }));
      window.finishBackground();
    });
    await page.clock.runFor(500);
    assert.equal(
      await page.evaluate(() => window.savedDuringEdit),
      1,
      "Active word saved despite input",
    );
    assert.equal(await calls(), baseline + 1);
    await page.clock.runFor(5000);
    assert.equal(await calls(), baseline + 4, "Active word is not regenerated");
    await page.evaluate(() => {
      WorkTimeApp.services.vocabularySpeech.synthesize = async (
        entry,
        accent,
        options,
      ) => {
        if (options.valid()) window.cacheCalls.push([entry.word, accent]);
        return new Blob(["audio"]);
      };
    });
    await page.evaluate(() =>
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true }),
    );
    const count = await page.evaluate(() => window.cacheCalls.length);
    await page.clock.runFor(20000);
    assert.equal(await page.evaluate(() => window.cacheCalls.length), count);
    const other = await context.newPage();
    await other.goto(server.url);
    await other.evaluate(() => {
      window.lockReady = false;
      void navigator.locks.request(
        "worktime-vocabulary-generation",
        async () => {
          window.lockReady = true;
          await new Promise((resolve) => {
            window.unlock = resolve;
          });
        },
      );
    });
    await other.waitForFunction(() => window.lockReady);
    await page.evaluate(() =>
      WorkTimeApp.services.vocabularyIdle.configure({ paused: false }),
    );
    await page.clock.runFor(2500);
    assert.equal(
      await page.evaluate(() => window.cacheCalls.length),
      count,
      "Another tab owns the generation lock",
    );
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.vocabularyIdle.state.status,
      ),
      "otherTab",
    );
    await other.evaluate(() => window.unlock());
    await page.clock.runFor(5000);
    assert.equal(
      await page.evaluate(() => window.cacheCalls.length),
      count + 4,
      "Generation resumes after lock release",
    );
    await other.close();
    await page.evaluate(() => {
      WorkTimeApp.services.vocabularySpeech.active = true;
      WorkTimeApp.services.vocabularyIdle.configure({ paused: false });
    });
    const beforePlayback = await page.evaluate(() => window.cacheCalls.length);
    await page.clock.runFor(5000);
    assert.equal(
      await page.evaluate(() => window.cacheCalls.length),
      beforePlayback,
      "No new background work during foreground synthesis or fresh playback",
    );
    await page.evaluate(() => {
      WorkTimeApp.services.vocabularySpeech.active = false;
    });
    await page.clock.runFor(5000);
    assert.equal(
      await page.evaluate(() => window.cacheCalls.length),
      beforePlayback + 4,
    );
    await page.evaluate(() => {
      window.capacityCalls = 0;
      WorkTimeApp.services.vocabularySpeech.synthesize = async () => {
        window.capacityCalls++;
        throw Object.assign(Error("full"), { cacheCode: "capacity" });
      };
      WorkTimeApp.services.vocabularyIdle.configure({ paused: false });
    });
    await page.clock.runFor(2500);
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.vocabularyIdle.state.status,
      ),
      "capacity",
    );
    await page.clock.runFor(20000);
    assert.equal(
      await page.evaluate(() => window.capacityCalls),
      1,
      "Capacity exhaustion pauses without a retry loop",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Idle generation, deduplication, completion and pause verified.",
    );
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
