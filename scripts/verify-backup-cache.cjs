"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const result = await page.evaluate(async () => {
      const S = WorkTimeApp.services,
        D = WorkTimeApp.domain,
        A = S.archive;
      const check = (value, message) => {
        if (!value) throw Error(message);
      };
      const decode = (text, options) =>
        S.backup.decode(text, (v) => v, options);
      const memo = (doc) =>
        doc.work.modules.find((m) => m.id === A.ids.memo).records[0].data.text;
      const storage = new Map([[S.gameArchive.keys["game-jump"], "42"]]);
      const getGames = () => ({ getItem: (key) => storage.get(key) ?? null });
      const persistence = S.indexedStorage.create({
        key: "cache-test",
        defaultState: D.state.defaultState,
        getStorage: () => localStorage,
        indexedDB,
      });
      let state = D.state.defaultState(),
        fail = false,
        gate = null;
      state._archive = {
        header: {
          id: "00000000-0000-4000-8000-000000000001",
          createdAt: "2026-01-01T00:00:00Z",
        },
        envelope: { futureField: "retained" },
        unknownModules: [
          {
            id: "future.module",
            version: 1,
            records: [
              {
                id: "future",
                order: 0,
                extra: 42,
                data: { text: "future data" },
              },
            ],
          },
        ],
      };
      state.days = {
        "2026-01-02": { kind: "work" },
        "2026-02-02": { kind: "rest" },
        "2026-01-03": { kind: "work" },
      };
      const source = {
        snapshot: () => state,
        export: (value) => persistence.export(value),
        async exportChanges(value, changes) {
          if (gate) await gate;
          if (fail) throw Error("simulated export failure");
          return persistence.exportChanges(value, changes);
        },
      };
      const cache = S.backupCache.create({ source, getGames });
      await cache.warm();
      let before = { ...cache.stats };
      const text = await cache.capture(),
        full = await decode(text);
      check(
        cache.stats.fullExports === before.fullExports &&
          cache.stats.compressions === before.compressions,
        "warm capture must not export or compress",
      );
      check(
        full.work.futureField === "retained" &&
          full.games.games["game-jump"] === 42,
        "unknown/game preservation",
      );
      check(
        JSON.stringify(full.work.modules) ===
          JSON.stringify(A.encode(state).modules),
        "all modules exact roundtrip",
      );
      const roundtrip = A.migrate(full.work);
      check(
        roundtrip.days["2026-02-02"].kind === "rest",
        "migrate reconstructed work archive",
      );
      state = { ...state, memo: "latest edit" };
      cache.invalidate({ memo: true });
      before = { ...cache.stats };
      check(
        memo(await decode(await cache.capture())) === "latest edit",
        "immediate edit included",
      );
      check(
        cache.stats.compressions === before.compressions + 1 &&
          cache.stats.fullExports === before.fullExports,
        "memo edit recompresses exactly one part without full export",
      );
      const days = { ...state.days };
      delete days["2026-01-02"];
      state = { ...state, days };
      cache.invalidate({ days: ["2026-01-02"] });
      const deleted = await decode(await cache.capture());
      check(
        JSON.stringify(deleted.work.modules) ===
          JSON.stringify(A.encode(state).modules),
        "deleted day/order roundtrip",
      );
      state = { ...state, memo: "captured" };
      cache.invalidate({ memo: true });
      let release;
      gate = new Promise((resolve) => {
        release = resolve;
      });
      const captured = cache.capture();
      state = { ...state, memo: "later edit" };
      cache.invalidate({ memo: true });
      storage.set(S.gameArchive.keys["game-jump"], "99");
      cache.invalidate();
      release();
      gate = null;
      const old = await decode(await captured);
      check(
        memo(old) === "captured" && old.games.games["game-jump"] === 42,
        "consistent click snapshot during edits/game ticks",
      );
      check(
        memo(await decode(await cache.capture())) === "later edit",
        "later edit next capture",
      );
      state = { ...state, memo: "retry" };
      cache.invalidate({ memo: true });
      fail = true;
      let rejected = false;
      try {
        await cache.capture();
      } catch {
        rejected = true;
      }
      check(rejected, "failed part must reject, never copy stale data");
      fail = false;
      check(
        memo(await decode(await cache.capture())) === "retry",
        "failed update recoverable",
      );
      state = { ...D.state.defaultState(), memo: "restored" };
      cache.invalidate({}, true);
      const restored = await decode(await cache.capture());
      check(
        memo(restored) === "restored" && !restored.work.futureField,
        "reset invalidates envelope and deleted modules",
      );
      // Large batches split at 512 records and deletions remove all related modules.
      const batch = (id, count) => ({
        id,
        records: Array.from({ length: count }, (_, i) => ({
          date: "2026-01-02",
          index: i,
        })),
        sources: Array.from({ length: count }, (_, i) => ({
          raw: "source-" + i,
        })),
        label: id,
      });
      state = { ...state, imports: [batch("a", 1030), batch("b", 2)] };
      cache.invalidate({ imports: ["a", "b"] });
      const batches = await cache.capture(),
        batchDoc = await decode(batches);
      check(
        JSON.stringify(batchDoc.work.modules) ===
          JSON.stringify(A.encode(state).modules),
        "large batches and evidence roundtrip",
      );
      const manifest = JSON.parse(batches.slice(S.backupChunks.PREFIX.length));
      check(
        manifest.modules.find((m) => m.header.id === A.ids.observations).parts
          .length === 4,
        "512 record sharding",
      );
      state = { ...state, imports: [state.imports[1]] };
      cache.invalidate({ imports: ["a"] });
      const withoutBatch = await decode(await cache.capture());
      check(
        JSON.stringify(withoutBatch.work.modules) ===
          JSON.stringify(A.encode(state).modules),
        "batch deletion removes observations/evidence and updates order",
      );
      storage.set(S.gameArchive.JOURNAL, "pending restore");
      let journalRejected = false;
      try {
        await cache.capture();
      } catch {
        journalRejected = true;
      }
      check(
        journalRejected,
        "game transaction journal blocks inconsistent snapshot",
      );
      storage.delete(S.gameArchive.JOURNAL);
      state = { ...state, memo: "slow export" };
      cache.invalidate({ memo: true });
      gate = new Promise((resolve) => {
        release = resolve;
      });
      const slowWarm = cache.warm();
      // Let the pending batch's max-wait deadline expire during this export.
      for (let i = 0; i < 23; i++) {
        state = { ...state, memo: "queued-" + i };
        cache.invalidate({ memo: true });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      release();
      await slowWarm;
      gate = null;
      const count = cache.stats.compressions;
      for (let i = 0; i < 22; i++) {
        state = { ...state, memo: "stream-" + i };
        cache.invalidate({ memo: true });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      check(
        cache.stats.compressions > count,
        "max debounce wait processes continuous updates",
      );
      check(
        memo(await decode(await cache.capture())) === "stream-21",
        "continuous updates end at newest snapshot",
      );
      const serial = JSON.parse(text.slice(S.backupChunks.PREFIX.length));
      async function rejects(doc, message, options) {
        let ok = false;
        try {
          await decode(S.backupChunks.PREFIX + JSON.stringify(doc), options);
        } catch {
          ok = true;
        }
        check(ok, message);
      }
      const missing = structuredClone(serial);
      missing.chunks.pop();
      await rejects(missing, "missing part rejected");
      const duplicate = structuredClone(serial);
      duplicate.chunks.push(duplicate.chunks[0]);
      await rejects(duplicate, "duplicate part rejected");
      const encoding = structuredClone(serial);
      encoding.chunks[0].encoding = "unknown";
      await rejects(encoding, "unknown encoding rejected");
      const version = structuredClone(serial);
      version.version = 2;
      await rejects(version, "unsupported version rejected");
      const bad = structuredClone(serial);
      bad.chunks[0].payload = "invalid!";
      await rejects(bad, "corrupt part rejected");
      state = { ...state, memo: "a".repeat(10000) };
      cache.invalidate({ memo: true });
      const bomb = await cache.capture();
      let limited = false;
      try {
        await decode(bomb, {
          maxBytes: new TextEncoder().encode(bomb).length + 20,
        });
      } catch (error) {
        limited = error.code === "tooLarge";
      }
      check(limited, "cumulative decompression limit");
      cache.dispose();
      // State notifications must include edits whose browser save failed.
      const owner = S.application.createState({
        state: D.state.defaultState(),
        persistence: {
          commit: async () => ({ persisted: false, error: Error("disk full") }),
        },
        core: D.state,
      });
      let notices = 0;
      const unsub = owner.subscribe(() => notices++);
      const failed = await owner.saveMemo("unsaved but visible");
      check(
        !failed.persisted &&
          notices === 1 &&
          owner.state.memo === "unsaved but visible",
        "failed save still notifies cache",
      );
      owner.reload(D.state.defaultState());
      check(notices === 2, "reload invalidates cache");
      unsub();
      // Browser fallback: no Worker and no CompressionStream.
      const NativeWorker = window.Worker,
        NativeCompression = window.CompressionStream;
      window.Worker = function () {
        throw Error("blocked");
      };
      window.CompressionStream = undefined;
      const fallback = S.backupCache.create({ source, getGames });
      const plain = await fallback.capture();
      check(
        memo(await decode(plain)) === state.memo,
        "raw JSON fallback roundtrip",
      );
      check(
        JSON.parse(plain.slice(S.backupChunks.PREFIX.length)).chunks.every(
          (c) => c.encoding === "json",
        ),
        "raw JSON encoding fallback",
      );
      fallback.dispose();
      window.Worker = NativeWorker;
      window.CompressionStream = NativeCompression;
      return {
        assertions:
          "roundtrip, invalidation, concurrency, deletion, reset, failed saves, failure recovery, corruption, limits, fallback",
      };
    });
    console.log(result.assertions + ": PASS");
    const measurements = await page.evaluate(async () => {
      const S = WorkTimeApp.services,
        D = WorkTimeApp.domain;
      const results = [];
      for (const mib of [1, 10, 50]) {
        let seed = 12345;
        const word = () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed.toString(36);
        };
        const rows = Array.from(
          { length: Math.ceil((mib * 1024 * 1024) / 2048) },
          (_, i) => ({
            id: "record-" + i,
            order: i,
            data: { text: Array.from({ length: 290 }, word).join(" ") },
          }),
        );
        let state = D.state.defaultState();
        state._archive = {
          unknownModules: [{ id: "future.history", version: 1, records: rows }],
        };
        const persistence = S.indexedStorage.create({
          key: "benchmark",
          defaultState: D.state.defaultState,
          getStorage: () => localStorage,
          indexedDB,
        });
        const cache = S.backupCache.create({
          source: {
            snapshot: () => state,
            export: (s) => persistence.export(s),
            exportChanges: (s, c) => persistence.exportChanges(s, c),
          },
          getGames: () => ({ getItem: () => null }),
        });
        let start = performance.now();
        await cache.warm();
        const warmMs = performance.now() - start;
        const before = { ...cache.stats };
        start = performance.now();
        const text = await cache.capture();
        const captureMs = performance.now() - start;
        if (
          before.fullExports !== cache.stats.fullExports ||
          before.compressions !== cache.stats.compressions
        )
          throw Error("warm benchmark capture performed export/compression");
        start = performance.now();
        state = { ...state, memo: "small update" };
        cache.invalidate({ memo: true });
        await cache.warm();
        const updateMs = performance.now() - start;
        const decoded = await S.backup.decode(text, (v) => v);
        if (
          decoded.work.modules.find((m) => m.id === "future.history").records
            .length !== rows.length
        )
          throw Error("large roundtrip lost records");
        results.push({
          rawMiB: +(
            new TextEncoder().encode(JSON.stringify(decoded)).length /
            1024 /
            1024
          ).toFixed(2),
          warmMs: +warmMs.toFixed(1),
          captureMs: +captureMs.toFixed(1),
          updateMs: +updateMs.toFixed(1),
          backupMiB: +(text.length / 1024 / 1024).toFixed(2),
        });
        cache.dispose();
      }
      return results;
    });
    console.table(measurements);
    // Measure immediate controller feedback independently of clipboard system latency.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            window.backupClipboardStarted = performance.now();
            await new Promise((resolve) => setTimeout(resolve, 30));
            window.backupClipboardFinished = performance.now();
          },
        },
      });
      window.backupClickAt = performance.now();
      document.getElementById("backup").click();
      window.backupFeedbackMs = performance.now() - window.backupClickAt;
      window.backupWasBusy =
        document.getElementById("backup").getAttribute("aria-busy") === "true";
    });
    await page.waitForFunction(() => window.backupClipboardFinished);
    const ui = await page.evaluate(() => ({
      feedbackMs: window.backupFeedbackMs,
      busy: window.backupWasBusy,
      totalMs: window.backupClipboardFinished - window.backupClickAt,
      clipboardMs:
        window.backupClipboardFinished - window.backupClipboardStarted,
    }));
    assert.ok(ui.busy && ui.feedbackMs < 100, JSON.stringify(ui));
    console.log("Controller timing (ms):", ui);
    await page.waitForFunction(
      () => !document.getElementById("backup").disabled,
    );
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new DOMException("denied", "NotAllowedError");
      };
      document.getElementById("backup").classList.remove("is-copying");
      document.getElementById("backup").click();
    });
    await page.waitForFunction(
      () => !document.getElementById("backup").disabled,
    );
    assert.equal(await page.locator("#backup").getAttribute("aria-busy"), null);
    assert.ok(
      await page.evaluate(() =>
        document
          .getElementById("feedbackList")
          .textContent.includes(WorkTimeApp.i18n.t("copy.ee57d577cd")),
      ),
    );
    console.log(
      "Clipboard write denial does not report success; busy state cleared: PASS",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
