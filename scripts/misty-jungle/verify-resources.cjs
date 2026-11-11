"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

async function verify(site = path.resolve(__dirname, "../..")) {
  let downloads = 0;
  let corrupt = false;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/fixture") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><script>
        window.WorkTimeApp = {games: {}, services: {}, data: {}};
        window.workerCount = 0;
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(...args) { super(...args); window.workerCount++; }
        };
        </script><script src="/assets/js/services/assets.js"></script>
        <script src="/assets/js/games/jungle-resources.js"></script>
        <script src="/assets/js/games/jungle-rules.js"></script>
        <script src="/assets/js/games/jungle-engine.js"></script>`);
      return;
    }
    const file = path.resolve(site, "." + pathname);
    if (!file.startsWith(site + path.sep) || !fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      "Content-Type",
      file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
    );
    if (file.endsWith(".wasm")) {
      downloads++;
      const bytes = fs.readFileSync(file);
      if (corrupt) bytes[0] ^= 1;
      // Ensure prefetch and foreground loads can join the same pending request.
      setTimeout(() => response.end(bytes), 50);
    } else response.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({
      channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
      headless: true,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const address = `http://127.0.0.1:${server.address().port}/fixture`;
    await page.goto(address);
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle("dependencies", {
        create: true,
      });
      WorkTimeApp.services.runtimeFolder = {
        withDependencies: (action) => action(folder),
      };
    });
    const sizes = await page.evaluate(async () => {
      const resources = WorkTimeApp.games.jungleResources;
      const [, a, b] = await Promise.all([
        resources.prefetch(),
        resources.load(),
        resources.load(),
      ]);
      structuredClone(a, { transfer: [a] });
      return [a.byteLength, b.byteLength, window.workerCount];
    });
    assert.deepEqual(sizes, [0, 103013, 0]);
    assert.equal(downloads, 1, "prefetch shares the foreground download");
    assert.equal(
      await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const folder = await (
          await root.getDirectoryHandle("dependencies")
        ).getDirectoryHandle("misty-jungle");
        return (
          await (await folder.getFileHandle("misty-jungle.wasm")).getFile()
        ).size;
      }),
      103013,
    );
    await page.context().setOffline(true);
    const result = await page.evaluate(async () => {
      return (await WorkTimeApp.games.jungleResources.load()).byteLength;
    });
    assert.equal(result, 103013, "authorized folder works offline");
    assert.equal(downloads, 1);
    await page.context().setOffline(false);
    const move = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const G = WorkTimeApp.games;
          G.jungleEngine.search(G.jungleRules.create(), "easy", {
            onResult: resolve,
            onError: reject,
          });
        }),
    );
    assert.equal(move.engine, "MistyJungle");
    assert(move.depth > 0 && move.nodes > 0);
    assert.equal(downloads, 1, "real Worker uses the folder binary");
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const folder = await (
        await root.getDirectoryHandle("dependencies")
      ).getDirectoryHandle("misty-jungle");
      const writer = await (
        await folder.getFileHandle("misty-jungle.wasm")
      ).createWritable();
      await writer.write(new Uint8Array(103013));
      await writer.close();
      await WorkTimeApp.games.jungleResources.load();
    });
    assert.equal(downloads, 2, "same-size corrupt folder binary is repaired");
    await page.evaluate(async () => {
      WorkTimeApp.services.runtimeFolder.withDependencies = async () => null;
      await WorkTimeApp.games.jungleResources.load();
    });
    assert.equal(
      downloads,
      3,
      "unavailable folder falls back to browser cache",
    );
    await page.reload();
    await page.evaluate(() =>
      WorkTimeApp.services.assets.script(
        "assets/vendor/misty-jungle/manifest.js",
      ),
    );
    await page.context().setOffline(true);
    assert.equal(
      await page.evaluate(
        async () => (await WorkTimeApp.games.jungleResources.load()).byteLength,
      ),
      103013,
      "browser cache survives reload and works offline",
    );
    await page.context().setOffline(false);
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dependencies = await root.getDirectoryHandle("dependencies");
      const folder = await dependencies.getDirectoryHandle("misty-jungle");
      await folder.removeEntry("misty-jungle.wasm");
      WorkTimeApp.services.runtimeFolder = {
        withDependencies: (action) => action(dependencies),
      };
      await WorkTimeApp.games.jungleResources.prefetch();
    });
    assert.equal(downloads, 3, "browser binary migrates to authorized folder");
    assert.equal(
      await page.evaluate(
        async () =>
          (
            await (
              await caches.open("worktime-misty-jungle-binaries-v1")
            ).keys()
          ).length,
      ),
      0,
      "folder persistence removes duplicate browser binaries",
    );
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const folder = await (
        await root.getDirectoryHandle("dependencies")
      ).getDirectoryHandle("misty-jungle");
      await folder.removeEntry("misty-jungle.wasm");
    });
    corrupt = true;
    assert.match(
      await page.evaluate(async () => {
        try {
          await WorkTimeApp.games.jungleResources.load();
          return "unexpected success";
        } catch (error) {
          return error.message;
        }
      }),
      /integrity/,
      "corrupt network bytes are rejected",
    );
    corrupt = false;
    assert.equal(
      await page.evaluate(
        async () => (await WorkTimeApp.games.jungleResources.load()).byteLength,
      ),
      103013,
      "failed download can retry",
    );
    await page.evaluate(async () => {
      WorkTimeApp.services.runtimeFolder.withDependencies = async () => {
        throw Error("Permission lost");
      };
      window.caches.open = async () => {
        throw Error("Cache unavailable");
      };
      await WorkTimeApp.games.jungleResources.load();
    });
    assert.deepEqual(errors, []);
    console.log(
      "Jungle HTTP resources: shared prefetch, verified folder/cache reads, offline reuse, corruption repair, retry, optional persistence and real WASM Worker verified.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
module.exports = { verify };
if (require.main === module)
  verify(process.argv[2] ? path.resolve(process.argv[2]) : undefined).catch(
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
