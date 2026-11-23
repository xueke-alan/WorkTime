"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
(async () => {
  const site = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const server = await runtimeServer(site);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route("**/index-upgrade-test.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Index upgrade</title>",
      }),
    );
    await page.goto(new URL("index-upgrade-test.html", server.url).href);
    await page.evaluate(async () => {
      const dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("upgrade-test", { create: true });
      window.testRoot = dir;
      const buffer = new ArrayBuffer(244),
        v = new DataView(buffer);
      for (const [offset, text] of [
        [0, "RIFF"],
        [8, "WAVEfmt "],
        [36, "data"],
      ])
        [...text].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
      v.setUint32(4, 236, true);
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, 44100, true);
      v.setUint32(28, 88200, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      v.setUint32(40, 200, true);
      window.testWav = buffer;
      const key = JSON.stringify([
        "supertonic-3-v1",
        "aafc6e32416a594460b32413efc49d7fe4ce6d46",
        "text-v1",
        "us",
        "F1",
        1.05,
        16,
        "existing",
      ]);
      const hash = async (data) =>
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
      const name = await hash(new TextEncoder().encode(key));
      let audio = dir;
      for (const part of ["audio", "supertonic-3-v1", "us"])
        audio = await audio.getDirectoryHandle(part, { create: true });
      for (const [filename, data] of [
        [name + ".wav", buffer],
        [name + ".json", JSON.stringify({ key, sha256: await hash(buffer) })],
      ]) {
        const stream = await (
          await audio.getFileHandle(filename, { create: true })
        ).createWritable();
        await stream.write(data);
        await stream.close();
      }
      // Earlier v1 installations have no identities store. Fresh-profile tests
      // cannot expose this upgrade failure.
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("worktime-vocabulary-file-index", 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("folders", {
            keyPath: "id",
            autoIncrement: true,
          });
          for (const store of ["entries", "pending", "directories"])
            r.result.createObjectStore(store, { keyPath: ["folder", "path"] });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(
          ["folders", "entries", "directories"],
          "readwrite",
        );
        tx.objectStore("folders").put({
          id: 1,
          handle: dir,
          bytes: 999,
          counts: {},
          revision: 2,
          indexStatus: "rebuilding",
        });
        tx.objectStore("entries").put({
          folder: 1,
          path: "obsolete-metadata",
          bytes: 999,
        });
        tx.objectStore("directories").put({ folder: 1, path: "current/audio" });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      window.WorkTimeApp = {
        data: { vocabularyCatalog: { entries: [{ word: "existing" }] } },
        services: {
          vocabularyIdle: {
            profile: () => ({
              engine: "supertonic",
              voice: "F1",
              speed: 1.05,
              steps: 16,
            }),
          },
          vocabularyStorage: { read: () => ({ settings: { accent: "us" } }) },
          runtimeFolder: {
            state: { revision: 1 },
            withEnglish: (action) => action(dir),
          },
        },
      };
    });
    for (const name of ["vocabulary-file-index", "vocabulary-audio-cache"])
      await page.addScriptTag({
        url: new URL("assets/js/services/" + name + ".js", server.url).href,
      });
    const result = await page.evaluate(async () => {
      const S = WorkTimeApp.services,
        cache = S.vocabularyAudioCache;
      let info;
      for (let i = 0; i < 30; i++) {
        info = await cache.info();
        if (info.bytesExact) break;
      }
      const existing = await cache.read({ word: "existing" }, "us");
      const saved = await cache.write(
        { word: "after-upgrade" },
        "us",
        new Blob([window.testWav]),
        10000,
      );
      return { info, size: existing?.size, saved, bytes: cache.state.bytes };
    });
    assert.equal(result.info.bytesExact, true);
    assert.equal(result.info.bytes, 244);
    assert.equal(
      result.size,
      244,
      "existing audio survives metadata migration",
    );
    assert.equal(result.saved, true);
    assert.equal(result.bytes, 488);
    console.log(
      "Legacy v1 index: missing-store upgrade, bounded rebuild, existing audio preservation and new writes passed.",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
