"use strict";
require("./lib/browser-test-setup.cjs");
const { choose } = require("./verify-vocabulary-settings.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
async function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const server = await runtimeServer(root);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const url of [
      server.url,
      pathToFileURL(path.join(root, "index.html")).href,
    ]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        if (!localStorage.getItem("worktime.vocabulary.audio-settings"))
          localStorage.setItem(
            "worktime.vocabulary.audio-settings",
            JSON.stringify({ enabled: false }),
          );
      });
      await page.goto(url);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      const open = async () => {
        await page.locator("#date-tab-tools").click();
        await page.locator("#vocabularyOpen").click();
        await page.locator(".vocabulary-card").waitFor();
        await page.locator('[data-page="preferences"]').click();
      };
      await open();
      const select = page.locator('select[aria-label="Worker 池大小"]');
      assert.equal(await select.inputValue(), "auto");
      assert.equal(await select.locator("option").count(), 5);
      await choose(page, "Worker 池大小", "8");
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await open();
      assert.equal(await select.inputValue(), "8");
      await choose(page, "Worker 池大小", "2");
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      if (url === server.url) {
        const result = await page.evaluate(async () => {
          const S = WorkTimeApp.services;
          S.vocabularyIdle.dispose();
          await S.vocabularyIdle.load();
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle("pool-browser-test", {
            create: true,
          });
          S.runtimeFolder = {
            state: { status: "available", revision: 1, busy: false },
            withEnglish: async (action) => action(dir),
            subscribe: () => () => {},
          };
          const cache = S.vocabularyAudioCache,
            speech = S.vocabularySpeech;
          await cache.clear();
          const buffer = new ArrayBuffer(244),
            v = new DataView(buffer);
          for (const [offset, text] of [
            [0, "RIFF"],
            [8, "WAVEfmt "],
            [36, "data"],
          ])
            [...text].forEach((c, i) =>
              v.setUint8(offset + i, c.charCodeAt(0)),
            );
          v.setUint32(4, 236, true);
          v.setUint32(16, 16, true);
          v.setUint16(20, 1, true);
          v.setUint16(22, 1, true);
          v.setUint32(24, 44100, true);
          v.setUint32(28, 88200, true);
          v.setUint16(32, 2, true);
          v.setUint16(34, 16, true);
          v.setUint32(40, 200, true);
          const blob = new Blob([buffer], { type: "audio/wav" });
          const writes = await Promise.allSettled(
            Array.from({ length: 8 }, (_, i) =>
              cache.write({ word: "capacity-" + i }, "us", blob, blob.size * 3),
            ),
          );
          const capacityCount = writes.filter(
            (row) => row.status === "fulfilled" && row.value,
          ).length;
          const bytes = cache.state.bytes;
          await cache.clear();
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
                  supertonic: "// fixture",
                };
              } else await assets.scripts(paths);
            },
          };
          let active = 0,
            peak = 0,
            generated = 0;
          window.Worker = class {
            terminate() {}
            async postMessage(data) {
              if (data.type === "init") {
                this.onmessage({ data: { id: data.id, type: "ready" } });
              } else {
                generated++;
                active++;
                peak = Math.max(peak, active);
                await new Promise((resolve) => setTimeout(resolve, 100));
                active--;
                this.onmessage({
                  data: { id: data.id, type: "audio", buffer: buffer.slice(0) },
                });
              }
            }
          };
          const audio = await Promise.all(
            ["one", "two", "one", "three"].map((word) =>
              speech.synthesize({ word }, "us", { background: true }),
            ),
          );
          const saved = await cache.read({ word: "three" }, "us");
          const output = {
            wav: [...new Uint8Array(buffer)],
            capacityCount,
            bytes,
            peak,
            generated,
            sizes: audio.map((b) => b?.size),
            saved: saved?.size,
          };
          speech.dispose();
          return output;
        });
        assert.equal(result.capacityCount, 3);
        assert.equal(result.bytes, 244 * 3);
        assert.equal(result.peak, 2);
        assert.equal(result.generated, 3);
        assert.deepEqual(result.sizes, [244, 244, 244, 244]);
        assert.equal(result.saved, 244);
        const peer = await context.newPage();
        await peer.goto(server.url);
        await peer.waitForFunction(
          () => document.documentElement.dataset.appState === "ready",
        );
        await peer.evaluate(async () => {
          const S = WorkTimeApp.services;
          S.vocabularyIdle.dispose();
          await S.vocabularyIdle.load();
          const dir = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle("pool-browser-test");
          S.runtimeFolder = {
            state: { status: "available", revision: 1, busy: false },
            withEnglish: async (action) => action(dir),
            subscribe: () => () => {},
          };
          await S.vocabularyAudioCache.info();
        });
        await page.evaluate(() =>
          WorkTimeApp.services.vocabularyAudioCache.clear(),
        );
        const race = async (target, prefix) =>
          target.evaluate(
            async ({ bytes, prefix }) => {
              const cache = WorkTimeApp.services.vocabularyAudioCache;
              const blob = new Blob([new Uint8Array(bytes)], {
                type: "audio/wav",
              });
              const rows = await Promise.allSettled(
                Array.from({ length: 8 }, (_, i) =>
                  cache.write({ word: prefix + i }, "us", blob, blob.size * 3),
                ),
              );
              return rows.filter(
                (row) => row.status === "fulfilled" && row.value,
              ).length;
            },
            { bytes: result.wav, prefix },
          );
        const counts = await Promise.all([
          race(page, "tab-a-"),
          race(peer, "tab-b-"),
        ]);
        assert.equal(
          counts[0] + counts[1],
          3,
          "cross-tab capacity reservations",
        );
        assert.equal(
          await page.evaluate(
            async () =>
              (await WorkTimeApp.services.vocabularyAudioCache.info()).bytes,
          ),
          244 * 3,
        );
        await peer.close();
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      "Browser pool: HTTP/file settings, mobile layout, persistence, parallel WAV generation, duplicate requests and atomic cache capacity passed.",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
