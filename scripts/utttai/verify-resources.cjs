"use strict";
require("../lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(process.argv[2] || path.join(__dirname, "../.."));
const cacheName = "worktime-utttai-binaries-v1";
async function waitCache(page, size) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (
      (await page.evaluate(
        async (name) => (await (await caches.open(name)).keys()).length,
        cacheName,
      )) === size
    )
      return;
    await page.waitForTimeout(100);
  }
  throw Error("Cache count did not reach " + size);
}
async function main() {
  const requests = [];
  let fail = false,
    releasePrerequisite;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/probe") {
      res.setHeader("Content-Type", "text/html");
      return res.end(`<!doctype html><script>window.WorkTimeApp={games:{},services:{},data:{}};</script>
        <script src="assets/js/services/assets.js"></script>
        <script src="assets/js/games/ultimate-ttt-rules.js"></script>
        <script src="assets/js/games/ultimate-ttt-engine.js"></script>
        <script src="assets/js/services/utttai-prefetch.js"></script>`);
    }
    if (url.pathname.endsWith("/prerequisite.js")) {
      releasePrerequisite = () => {
        res.setHeader("Content-Type", "text/javascript");
        res.end("window.prerequisiteDone = true;");
      };
      return;
    }
    if (/\.(onnx|wasm)$/.test(url.pathname)) {
      requests.push(url.pathname);
      if (fail) return res.writeHead(503).end();
    }
    const file = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, bytes) => {
      if (error) return res.writeHead(404).end();
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".wasm")
            ? "application/wasm"
            : "application/octet-stream",
      );
      res.end(bytes);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext(),
      page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/probe`);
    await page.evaluate(() => {
      window.workers = 0;
      window.Worker = class extends Worker {
        constructor(...args) {
          super(...args);
          window.workers++;
        }
      };
      void WorkTimeApp.services.assets.script(
        "assets/js/services/prerequisite.js",
      );
      WorkTimeApp.services.utttaiPrefetch.start();
    });
    await page.waitForTimeout(400);
    assert.equal(requests.length, 0, "prefetch waits for startup assets");
    releasePrerequisite();
    await waitCache(page, 2);
    assert.equal(
      await page.evaluate(() => window.workers),
      0,
      "prefetch never starts inference",
    );
    assert.equal(requests.length, 2);
    requests.length = 0;
    const result = await page.evaluate(async () => {
      const e = WorkTimeApp.games.createUltimateTttEngine();
      try {
        return await e.search(
          WorkTimeApp.games.ultimateTttRules.create(true),
          "normal",
        );
      } finally {
        e.dispose();
      }
    });
    assert.equal(result.model, "stage2-100000");
    assert.equal(requests.length, 0, "foreground uses prefetched binaries");
    await page.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      for (const req of await cache.keys())
        if (req.url.endsWith(".onnx"))
          await cache.put(req, new Response(new Uint8Array(19983650)));
      await WorkTimeApp.games.utttaiResources.load();
      await WorkTimeApp.games.utttaiResources.prefetch();
    }, cacheName);
    assert.equal(
      requests.filter((p) => p.endsWith(".onnx")).length,
      1,
      "corruption is redownloaded",
    );
    await page.evaluate(async () => {
      const files = new Map();
      const folder = {
        async getFileHandle(name, options) {
          if (!files.has(name) && !options?.create) throw Error("missing");
          return {
            async getFile() {
              return new Blob([files.get(name)]);
            },
            async createWritable() {
              return {
                async write(blob) {
                  files.set(name, new Uint8Array(await blob.arrayBuffer()));
                },
                async close() {},
                async abort() {},
              };
            },
          };
        },
        async *entries() {
          for (const name of files.keys()) yield [name, { kind: "file" }];
        },
        async removeEntry(name) {
          files.delete(name);
        },
      };
      WorkTimeApp.services.runtimeFolder = {
        withDependencies: async (action) =>
          action({ getDirectoryHandle: async () => folder }),
      };
      window.utttFiles = files;
      await WorkTimeApp.games.utttaiResources.load();
      await WorkTimeApp.games.utttaiResources.prefetch();
    });
    assert.equal(await page.evaluate(() => window.utttFiles.size), 2);
    assert.equal(
      await page.evaluate(
        async (cacheName) =>
          (await (await caches.open(cacheName)).keys()).length,
        cacheName,
      ),
      0,
      "folder copy replaces browser copies",
    );
    requests.length = 0;
    await page.evaluate(() => WorkTimeApp.games.utttaiResources.load());
    assert.equal(requests.length, 0, "validated folder resources are reused");
    await ctx.close();
    const c2 = await browser.newContext(),
      p2 = await c2.newPage();
    await p2.goto(`http://127.0.0.1:${server.address().port}/probe`);
    requests.length = 0;
    await p2.evaluate(() =>
      Promise.all([
        WorkTimeApp.games.utttaiResources.prefetch(),
        WorkTimeApp.games.utttaiResources.load(),
        WorkTimeApp.games.utttaiResources.load(),
      ]),
    );
    assert.equal(
      requests.length,
      2,
      "foreground/background requests share downloads",
    );
    await c2.close();
    const c3 = await browser.newContext(),
      p3 = await c3.newPage();
    const errors = [];
    p3.on("pageerror", (e) => errors.push(e.message));
    await p3.goto(`http://127.0.0.1:${server.address().port}/probe`);
    fail = true;
    await p3.evaluate(() => WorkTimeApp.services.utttaiPrefetch.start());
    await p3.waitForTimeout(1000);
    assert.equal(errors.length, 0, "background failures stay silent");
    fail = false;
    await p3.evaluate(() => window.dispatchEvent(new Event("online")));
    await waitCache(p3, 2);
    await c3.close();
    console.log(
      "Prefetch ordering/no inference, real HTTP NMCTS2, shared downloads, corruption repair, folder/cache deduplication and online retry passed.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
