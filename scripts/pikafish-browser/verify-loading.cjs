"use strict";
// Real Chromium, Cache Storage, IndexedDB and OPFS; only picker permissions are simulated.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
require("../lib/browser-test-setup.cjs");
const { chromium } = require("playwright");
const root = path.resolve(process.argv[2] || path.join(__dirname, "../.."));
const cacheName = "worktime-pikafish-binaries-v1";
async function main() {
  const downloads = [];
  let blockBinaries = false;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/WorkTime/probe") {
      response.setHeader("Content-Type", "text/html");
      return response.end(`<script>window.WorkTimeApp={games:{},services:{},data:{assetVersions:{
        'assets/vendor/pikafish/manifest.js':'test','assets/vendor/pikafish/worker.js':'test'}}};</script>
        <script src="assets/js/services/runtime-folder.js"></script>
        <script src="assets/js/games/xiangqi-engine.js"></script>`);
    }
    if (!pathname.startsWith("/WorkTime/"))
      return response.writeHead(404).end();
    if (/\.(nnue|wasm)$/.test(pathname)) {
      downloads.push(pathname);
      if (blockBinaries) return response.writeHead(503).end();
    }
    const file = path.resolve(root, "." + pathname.slice("/WorkTime".length));
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, bytes) => {
      if (error) return response.writeHead(404).end();
      response.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".wasm")
            ? "application/wasm"
            : "application/octet-stream",
      );
      response.end(bytes);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.permission = "granted";
      window.folderName = "runtime-A";
      window.writeFails = false;
      window.showDirectoryPicker = async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle(
          window.folderName,
          { create: true },
        );
      FileSystemDirectoryHandle.prototype.queryPermission = async () =>
        window.permission;
      const create = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = function (...args) {
        if (window.writeFails)
          throw new DOMException("Full", "QuotaExceededError");
        return create.apply(this, args);
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const entry = `http://127.0.0.1:${server.address().port}/WorkTime/probe`;
    async function load() {
      return page.evaluate(async () => {
        window.engine = WorkTimeApp.games.createXiangqiEngine();
        const start = performance.now();
        await window.engine.load();
        const elapsed = performance.now() - start;
        const move = await window.engine.search(
          "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
          "normal",
        );
        window.engine.dispose();
        return { ms: Math.round(elapsed), move };
      });
    }
    async function browserFiles() {
      return page.evaluate(
        async (name) =>
          (await (await caches.open(name)).keys()).map((request) =>
            new URL(request.url).pathname.split("/").pop(),
          ),
        cacheName,
      );
    }
    async function waitBrowser(count) {
      await page.waitForFunction(
        async ({ name, count }) =>
          (await (await caches.open(name)).keys()).length === count,
        { name: cacheName, count },
      );
    }
    async function waitFolder() {
      await page.waitForFunction(async () => {
        const runtime = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle(window.folderName);
        try {
          const folder = await (
            await runtime.getDirectoryHandle("dependencies")
          ).getDirectoryHandle("pikafish");
          const files = [];
          for await (const [name, file] of folder.entries())
            if (file.kind === "file" && (await file.getFile()).size > 0)
              files.push(name);
          return files.length === 2;
        } catch {
          return false;
        }
      });
      await waitBrowser(0);
    }
    await page.goto(entry);
    const cold = await load();
    assert.match(cold.move, /^[a-i][0-9][a-i][0-9]$/);
    await waitBrowser(2);
    assert.equal(downloads.length, 2);
    blockBinaries = true;
    await page.reload();
    const warm = await load();
    assert.equal(downloads.length, 2, "warm browser cache skips the network");
    await page.evaluate(() => WorkTimeApp.services.runtimeFolder.choose());
    await load();
    await waitFolder();
    assert.equal(
      (await browserFiles()).length,
      0,
      "folder replaces the browser binary copy",
    );
    await page.reload();
    await load();
    assert.equal(
      downloads.length,
      2,
      "persisted folder works after reload without browser model cache",
    );
    await page.evaluate(async () => {
      const cache = await caches.open("worktime-pikafish-binaries-v1");
      const assets = WorkTimeApp.games.pikafishAssets;
      for (const info of Object.values(assets)) {
        const file = await WorkTimeApp.services.runtimeFolder.withDependencies(
          async (root) =>
            (await root.getDirectoryHandle("pikafish")).getFileHandle(
              info.name,
            ),
        );
        await cache.put(
          new URL("assets/vendor/pikafish/" + info.name, document.baseURI),
          new Response(await file.getFile()),
        );
      }
      window.permission = "denied";
    });
    await load();
    assert.equal(
      downloads.length,
      2,
      "revoked folder permission falls back to browser",
    );
    await page.evaluate(async () => {
      window.permission = "granted";
      window.folderName = "runtime-B";
      await WorkTimeApp.services.runtimeFolder.choose();
    });
    await load();
    await waitFolder();
    assert.equal(
      downloads.length,
      2,
      "new runtime folder is populated from browser cache",
    );
    await page.evaluate(async () => {
      await WorkTimeApp.services.runtimeFolder.withDependencies(
        async (root) => {
          const folder = await root.getDirectoryHandle("pikafish");
          const info = WorkTimeApp.games.pikafishAssets.net;
          const writable = await (
            await folder.getFileHandle(info.name)
          ).createWritable();
          await writable.write(new Uint8Array(info.size));
          await writable.close();
        },
      );
    });
    blockBinaries = false;
    const before = downloads.length;
    await load();
    await waitFolder();
    assert.equal(
      downloads.length,
      before + 1,
      "corrupted model is rejected by its hash and downloaded again",
    );
    await page.evaluate(async () => {
      window.folderName = "runtime-C";
      await WorkTimeApp.services.runtimeFolder.choose();
      window.writeFails = true;
    });
    await load();
    await waitBrowser(2);
    await page.evaluate(async () => {
      window.engine = WorkTimeApp.games.createXiangqiEngine();
      await window.engine.load();
      const start = performance.now();
      await window.engine.load();
      if (performance.now() - start > 10)
        throw Error("Idle load should reuse the initialized engine");
      window.engine.dispose();
    });
    await page.evaluate(async () => {
      await caches.delete("worktime-pikafish-binaries-v1");
      window.originalCachePut = Cache.prototype.put;
      Cache.prototype.put = async () => {
        throw new DOMException("Full", "QuotaExceededError");
      };
    });
    await load();
    await page.evaluate(() => {
      Cache.prototype.put = window.originalCachePut;
    });
    blockBinaries = true;
    await page.evaluate(async () => {
      window.retryEngine = WorkTimeApp.games.createXiangqiEngine();
      try {
        await window.retryEngine.load();
        throw Error("Missing dependencies should fail");
      } catch (error) {
        if (!error.message.includes("download")) throw error;
      }
    });
    blockBinaries = false;
    await page.evaluate(async () => {
      await window.retryEngine.load();
      window.retryEngine.dispose();
    });
    await waitBrowser(2);
    // The shell must not cache binaries, but must retain versioned worker/manifest scripts.
    await page.evaluate(async () => {
      const shell = await caches.open("worktime-shell-3.1.0");
      await shell.put(
        new URL("assets/vendor/pikafish/engine.js", document.baseURI),
        new Response("old monolithic engine"),
      );
      await shell.put(
        new URL("assets/vendor/pikafish/old.nnue", document.baseURI),
        new Response("old model"),
      );
      await navigator.serviceWorker.register("service-worker.js", {
        scope: "./",
      });
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await load();
    const shell = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((name) =>
        name.startsWith("worktime-shell-"),
      );
      return (
        await Promise.all(
          names.map(async (name) =>
            (await (await caches.open(name)).keys()).map(
              (request) => request.url,
            ),
          ),
        )
      ).flat();
    });
    assert(shell.some((url) => url.includes("/pikafish/worker.js?v=test")));
    assert(
      !shell.some((url) => /\.(nnue|wasm)$/.test(url)),
      "shell must not duplicate binaries",
    );
    assert(
      !shell.some((url) => url.includes("/pikafish/engine.js")),
      "Pages never loads the monolithic fallback",
    );
    // Keep the probe HTML in the shell so a full offline refresh exercises all resource paths.
    await page.evaluate(async () => {
      const shell = (await caches.keys()).find((name) =>
        name.startsWith("worktime-shell-"),
      );
      await (await caches.open(shell)).add(location.href);
    });
    await context.setOffline(true);
    await page.reload();
    await load();
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        cold,
        warm,
        verified:
          "browser/folder persistence, permission fallback, folder switch, corruption repair, write failure, quota exhaustion, download retry, worker reuse, project subpath, shell upgrade/deduplication, offline refresh",
      }),
    );
    await context.close();
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
