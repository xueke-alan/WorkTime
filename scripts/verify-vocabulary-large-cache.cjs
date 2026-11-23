"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");

async function install(page, url) {
  url = new URL(url).origin;
  await page.route("**/cache-index-test.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Cache index test</title>",
    }),
  );
  await page.goto(url + "/cache-index-test.html");
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    window.audioRoot = await root.getDirectoryHandle("large-cache", {
      create: true,
    });
    window.legacyRoot = await root.getDirectoryHandle("legacy-cache", {
      create: true,
    });
    window.WorkTimeApp = {
      data: { vocabularyCatalog: { entries: [{ word: "target" }] } },
      services: {
        vocabularyStorage: { read: () => ({ settings: { accent: "us" } }) },
        vocabularyIdle: {
          profile: (accent) =>
            accent === "us"
              ? { engine: "supertonic", voice: "F1", speed: 1, steps: 5 }
              : {
                  engine: "piper",
                  voice: "en_GB-jenny_dioco-medium",
                  speed: 1,
                  speaker: 0,
                  noiseScale: 0.5,
                  noiseW: 0.333,
                },
        },
        runtimeFolder: {
          state: { revision: 1 },
          withEnglish: (action, options) => {
            if (options?.migrateLegacy !== false)
              throw Error("Unexpected eager migration");
            return navigator.locks.request("large-cache-files", () =>
              action(window.audioRoot, { legacy: window.legacyRoot }),
            );
          },
        },
      },
    };
    window.enumerations = 0;
    for (const method of ["entries", "values", "keys"]) {
      const original = FileSystemDirectoryHandle.prototype[method];
      FileSystemDirectoryHandle.prototype[method] = function (...args) {
        window.enumerations++;
        return original.apply(this, args);
      };
    }
    window.wav = () => {
      const buffer = new ArrayBuffer(244),
        v = new DataView(buffer);
      const label = (offset, text) =>
        [...text].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
      label(0, "RIFF");
      label(8, "WAVEfmt ");
      label(36, "data");
      for (const [offset, value] of [
        [4, 236],
        [16, 16],
        [24, 44100],
        [28, 88200],
        [40, 200],
      ])
        v.setUint32(offset, value, true);
      for (const [offset, value] of [
        [20, 1],
        [22, 1],
        [32, 2],
        [34, 16],
      ])
        v.setUint16(offset, value, true);
      return new Blob([buffer], { type: "audio/wav" });
    };
    window.save = async (dir, name, bytes) => {
      const stream = await (
        await dir.getFileHandle(name, { create: true })
      ).createWritable();
      await stream.write(bytes);
      await stream.close();
    };
    window.seedAudio = async (word, root, sharded = true) => {
      const cache = WorkTimeApp.services.vocabularyAudioCache;
      const identity = cache.key({ word }, "us"),
        name = await cache.hash(new TextEncoder().encode(identity));
      let dir = root;
      for (const part of [
        "audio",
        "supertonic-3-v1",
        "us",
        ...(sharded ? [name.slice(0, 2)] : []),
      ])
        dir = await dir.getDirectoryHandle(part, { create: true });
      const blob = window.wav(),
        sha256 = await cache.hash(await blob.arrayBuffer());
      await window.save(dir, name + ".wav", blob);
      await window.save(
        dir,
        name + ".json",
        JSON.stringify({ key: identity, sha256 }),
      );
      return {
        path:
          (root === window.audioRoot ? "current" : "legacy") +
          "/audio/supertonic-3-v1/us/" +
          (sharded ? name.slice(0, 2) + "/" : "") +
          name,
        identity,
        bytes: blob.size,
        sha256,
        modified: (await (await dir.getFileHandle(name + ".wav")).getFile())
          .lastModified,
      };
    };
  });
  for (const name of ["vocabulary-file-index", "vocabulary-audio-cache"])
    await page.addScriptTag({
      url: url + "/assets/js/services/" + name + ".js",
    });
}

async function main() {
  const server = await runtimeServer(path.resolve(__dirname, ".."));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(),
      page = await context.newPage();
    await install(page, server.url);
    if (!process.argv.includes("--recovery-only")) {
      const large = await page.evaluate(async () => {
        const cache = WorkTimeApp.services.vocabularyAudioCache,
          index = WorkTimeApp.services.vocabularyFileIndex;
        await cache.clear();
        const folder = await index.connect(window.audioRoot);
        // Virtual payloads: persist real metadata for 200,000 files totalling
        // exactly 20 GiB, without allocating or writing 20 GiB of audio.
        const total = 20 * 1024 ** 3,
          count = 200000;
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("worktime-vocabulary-file-index");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const summary = await index.get(folder.id),
          prefix = index.prefix(cache.key({ word: "" }, "us"));
        const started = performance.now();
        for (let offset = 0; offset < count; offset += 2000) {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(["entries", "identities"], "readwrite");
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
            for (let i = offset; i < Math.min(count, offset + 2000); i++) {
              const identity = cache.key({ word: "virtual-" + i }, "us");
              tx.objectStore("entries").put({
                folder: folder.id,
                path: "virtual/" + String(i).padStart(6, "0"),
                identity,
                bytes: Math.floor(total / count) + Number(i < total % count),
                modified: 1,
              });
              tx.objectStore("identities").put({
                folder: folder.id,
                path: identity,
                count: 1,
              });
            }
          });
        }
        summary.bytes = total;
        summary.counts[prefix] = count;
        summary.revision++;
        await new Promise((resolve, reject) => {
          const tx = db.transaction("folders", "readwrite");
          tx.oncomplete = resolve;
          tx.onabort = () => reject(tx.error);
          tx.objectStore("folders").put(summary);
        });
        db.close();
        await window.seedAudio("target", window.audioRoot);
        await cache.info();
        window.enumerations = 0;
        const startRead = performance.now();
        if ((await cache.read({ word: "target" }, "us"))?.size !== 244)
          throw Error("Large index direct read failed");
        if (window.enumerations)
          throw Error("Direct read enumerated directories");
        let capacity = false;
        try {
          await cache.write({ word: "over-limit" }, "us", window.wav(), total);
        } catch (error) {
          capacity = error.cacheCode === "capacity";
        }
        if (!capacity) throw Error("20 GiB capacity guard failed");
        return {
          count,
          bytes: total,
          seedMs: Math.round(startRead - started),
          readMs: Math.round(performance.now() - startRead),
          enumerations: window.enumerations,
        };
      });
      assert.equal(large.enumerations, 0);
      console.log("20 GiB / 200,000-entry index:", large);
      // A new document must reuse the persisted folder index, without a disk scan.
      await install(page, server.url);
      assert.deepEqual(
        await page.evaluate(async () => {
          const cache = WorkTimeApp.services.vocabularyAudioCache;
          const info = await cache.info();
          const audio = await cache.read({ word: "target" }, "us");
          return {
            exact: info.bytesExact,
            readable: audio?.size === 244,
            enumerations: window.enumerations,
          };
        }),
        { exact: true, readable: true, enumerations: 0 },
      );
    }
    const recovery = await page.evaluate(async () => {
      const cache = WorkTimeApp.services.vocabularyAudioCache,
        index = WorkTimeApp.services.vocabularyFileIndex;
      await cache.clear();
      const folder = await index.connect(window.audioRoot);
      const row = await window.seedAudio("pending", window.audioRoot);
      // Simulate a crash after writing disk files but before committing metadata.
      await index.reserve(folder.id, row, 10000);
      await cache.info();
      if ((await index.pending(folder.id)).length)
        throw Error("Pending journal not recovered");
      await window.seedAudio("legacy", window.legacyRoot, false);
      await cache.verify();
      window.enumerations = 0;
      if (
        (await cache.read({ word: "legacy" }, "us"))?.size !== 244 ||
        window.enumerations
      )
        throw Error("Legacy read blocked by rebuild");
      if (await cache.write({ word: "blocked" }, "us", window.wav(), 10000))
        throw Error("Unknown byte count allowed new writes");
      let batches = 0;
      while (!(await cache.info()).bytesExact) {
        if (++batches > 100) throw Error("Rebuild did not finish");
      }
      // Duplicate physical files consume bytes but only one progress identity.
      const duplicate = await window.seedAudio(
        "pending",
        window.legacyRoot,
        false,
      );
      await index.apply(folder.id, [duplicate]);
      const before = await index.get(folder.id);
      await index.apply(folder.id, [{ path: duplicate.path, remove: true }]);
      const after = await index.get(folder.id);
      const prefix = index.prefix(row.identity);
      if (before.counts[prefix] !== after.counts[prefix])
        throw Error("Duplicate identity counted twice");
      return {
        bytes: after.bytes,
        count: after.counts[prefix],
        batches,
        pending: (await index.pending(folder.id)).length,
      };
    });
    assert.equal(recovery.pending, 0);
    assert.equal(recovery.bytes, 488);
    assert.equal(recovery.count, 2);
    console.log(
      "Persistence, pending recovery, legacy reads and identity deduplication:",
      recovery,
    );
    await page.evaluate(async () => {
      const index = WorkTimeApp.services.vocabularyFileIndex;
      const folder = await index.connect(window.audioRoot);
      const row = await window.seedAudio("reload-pending", window.audioRoot);
      await index.reserve(folder.id, row, 10000);
    });
    await install(page, server.url);
    assert.deepEqual(
      await page.evaluate(async () => {
        const cache = WorkTimeApp.services.vocabularyAudioCache,
          index = WorkTimeApp.services.vocabularyFileIndex;
        const info = await cache.info(),
          folder = await index.connect(window.audioRoot);
        return {
          readable:
            (await cache.read({ word: "reload-pending" }, "us"))?.size === 244,
          pending: (await index.pending(folder.id)).length,
          exact: info.bytesExact,
          enumerations: window.enumerations,
        };
      }),
      { readable: true, pending: 0, exact: true, enumerations: 0 },
    );
    const bounded = await page.evaluate(async () => {
      const cache = WorkTimeApp.services.vocabularyAudioCache;
      for (let i = 0; i < 35; i++)
        await window.seedAudio("batch-" + i, window.audioRoot);
      await cache.verify();
      let waveReads = 0;
      const original = FileSystemFileHandle.prototype.getFile;
      FileSystemFileHandle.prototype.getFile = function (...args) {
        if (this.name.endsWith(".wav")) waveReads++;
        return original.apply(this, args);
      };
      const first = await cache.info(),
        firstReads = waveReads;
      FileSystemFileHandle.prototype.getFile = original;
      let batches = 1;
      while (!(await cache.info()).bytesExact) {
        if (++batches > 100) throw Error("Incremental verification stalled");
      }
      if (first.bytesExact || firstReads > 32)
        throw Error("Verification failed to yield after a bounded batch");
      const before = cache.state;
      const name = await cache.hash(
        new TextEncoder().encode(cache.key({ word: "batch-0" }, "us")),
      );
      let dir = window.audioRoot;
      for (const part of ["audio", "supertonic-3-v1", "us", name.slice(0, 2)])
        dir = await dir.getDirectoryHandle(part);
      await dir.removeEntry(name + ".wav");
      await dir.removeEntry(name + ".json");
      await cache.verify();
      while (!(await cache.info()).bytesExact) {
        /* Incremental rescan. */
      }
      if (
        cache.state.bytes !== before.bytes - 244 ||
        cache.state.count !== before.count - 1
      )
        throw Error("Manual verification did not reconcile external deletion");
      return { firstReads, batches, bytes: cache.state.bytes };
    });
    console.log("Bounded manual verification:", bounded);
    const peer = await context.newPage();
    await install(peer, server.url);
    await peer.evaluate(() => WorkTimeApp.services.vocabularyAudioCache.info());
    const enumerations = await Promise.all(
      [page, peer].map((tab) => tab.evaluate(() => window.enumerations)),
    );
    const limit = bounded.bytes + 244;
    const writes = await Promise.allSettled(
      [page, peer].map((tab, i) =>
        tab.evaluate(
          async ({ limit, i }) =>
            WorkTimeApp.services.vocabularyAudioCache.write(
              { word: "concurrent-" + i },
              "us",
              window.wav(),
              limit,
            ),
          { limit, i },
        ),
      ),
    );
    assert.equal(
      writes.filter((result) => result.status === "fulfilled" && result.value)
        .length,
      1,
    );
    assert.equal(
      writes.filter(
        (result) =>
          result.status === "rejected" &&
          /capacity/.test(result.reason.message),
      ).length,
      1,
    );
    for (const [i, tab] of [page, peer].entries()) {
      await tab.waitForFunction(
        (limit) =>
          WorkTimeApp.services.vocabularyAudioCache.state.bytes === limit,
        limit,
      );
      assert.equal(
        await tab.evaluate(() => window.enumerations),
        enumerations[i],
      );
    }
    assert.equal(await peer.evaluate(() => window.enumerations), 0);
    console.log(
      "Reload recovery, cross-tab quota serialization and incremental broadcasts verified.",
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
