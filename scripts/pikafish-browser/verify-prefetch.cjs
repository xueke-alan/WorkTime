"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
require("../lib/browser-test-setup.cjs");
const { chromium } = require("playwright");
const root = path.resolve(process.argv[2] || path.join(__dirname, "../.."));
const cacheName = "worktime-pikafish-binaries-v1";
async function main() {
  let prerequisite, releaseModel, modelArrived;
  let holdModel = false,
    failBinaries = false;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/WorkTime/probe") {
      response.setHeader("Content-Type", "text/html");
      return response.end(`<!doctype html><html class="app-loading" data-app-state="ready"><head>
        <script>window.WorkTimeApp={games:{},ui:{},services:{},data:{}};</script>
        <script src="assets/js/services/assets.js"></script>
        ${url.searchParams.has("hold") ? '<script>void WorkTimeApp.services.assets.script("assets/js/services/prerequisite.js");</script>' : ""}
        <script defer src="assets/js/startup.js"></script></head><body>Prefetch fixture</body></html>`);
    }
    if (url.pathname.endsWith("/prerequisite.js")) {
      prerequisite = () => {
        if (response.writableEnded) return;
        response.setHeader("Content-Type", "text/javascript");
        response.end("window.prerequisiteFinished=performance.now();");
      };
      return;
    }
    if (!url.pathname.startsWith("/WorkTime/"))
      return response.writeHead(404).end();
    if (/\/pikafish\/[^/]+\.(nnue|wasm)$/.test(url.pathname)) {
      if (failBinaries) return response.writeHead(503).end();
      if (holdModel && url.pathname.endsWith(".nnue")) {
        modelArrived();
        await new Promise((resolve) => {
          releaseModel = resolve;
        });
      }
    }
    const file = path.resolve(
      root,
      "." + url.pathname.slice("/WorkTime".length),
    );
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
    async function fixture(query = "") {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        window.binaryRequests = [];
        window.hashes = 0;
        window.engineWorkers = 0;
        const fetch = window.fetch.bind(window);
        window.fetch = (url, options) => {
          if (/\/pikafish\/[^/?]+\.(nnue|wasm)(\?|$)/.test(String(url)))
            window.binaryRequests.push({
              url: String(url),
              priority: options?.priority,
              at: performance.now(),
            });
          return fetch(url, options);
        };
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest = (...args) => {
          const resources = WorkTimeApp.games.pikafishAssets;
          if (
            args[1].byteLength === resources?.wasm?.size ||
            args[1].byteLength === resources?.net?.size
          )
            window.hashes++;
          return digest(...args);
        };
        window.Worker = class extends Worker {
          constructor(...args) {
            super(...args);
            window.engineWorkers++;
          }
        };
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${server.address().port}/WorkTime/probe${query}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(
        () => !document.documentElement.classList.contains("app-loading"),
      );
      return { context, page, errors };
    }
    async function cached(page) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const count = await page.evaluate(
          async (name) => (await (await caches.open(name)).keys()).length,
          cacheName,
        );
        if (count === 2) return;
        await page.waitForTimeout(50);
      }
      throw Error("Background cache did not finish");
    }
    const first = await fixture("?hold");
    await first.page.evaluate(() => {
      window.interactions = setInterval(() => {
        document.body.dispatchEvent(new Event("click", { bubbles: true }));
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Shift", bubbles: true }),
        );
        window.dispatchEvent(new Event("scroll"));
      }, 25);
    });
    await first.page.waitForTimeout(350);
    assert.equal(
      await first.page.evaluate(() => window.binaryRequests.length),
      0,
      "required network requests finish before prefetch",
    );
    assert(prerequisite);
    prerequisite();
    await cached(first.page);
    await first.page.evaluate(() =>
      WorkTimeApp.games.pikafishResources.prefetch(),
    );
    const automatic = await first.page.evaluate(async () => {
      const hashes = window.hashes;
      await WorkTimeApp.games.pikafishResources.prefetch();
      clearInterval(window.interactions);
      return {
        requests: window.binaryRequests,
        workers: window.engineWorkers,
        hashes,
        after: window.hashes,
        finished: window.prerequisiteFinished,
      };
    });
    assert.equal(automatic.requests.length, 2);
    assert.equal(
      automatic.workers,
      0,
      "background caching never initializes an engine",
    );
    assert.equal(
      automatic.hashes,
      automatic.after,
      "existing cache is not rehashed during prefetch",
    );
    assert(
      automatic.requests.every(
        (request) =>
          request.priority === "low" && request.at >= automatic.finished,
      ),
    );
    assert(
      automatic.requests[0].at - automatic.finished < 5000,
      "continuous interaction does not postpone network-idle prefetch",
    );

    await first.page.evaluate(async (name) => {
      await caches.delete(name);
      window.originalPut = Cache.prototype.put;
      window.persistGate = new Promise((resolve) => {
        window.releasePersistence = resolve;
      });
      Cache.prototype.put = async function (request, ...args) {
        if (String(request).endsWith(".nnue")) {
          window.persistenceWaiting = true;
          await window.persistGate;
        }
        return window.originalPut.call(this, request, ...args);
      };
    }, cacheName);
    holdModel = true;
    const arrived = new Promise((resolve) => {
      modelArrived = resolve;
    });
    await first.page.evaluate(() => {
      window.warming = WorkTimeApp.games.pikafishResources.prefetch();
    });
    await arrived;
    await first.page.evaluate(() => {
      window.engine = WorkTimeApp.games.createXiangqiEngine();
      window.gameReady = window.engine.load().then(() => {
        window.ready = true;
      });
    });
    holdModel = false;
    releaseModel();
    await first.page.waitForFunction(
      () => window.persistenceWaiting && window.ready,
    );
    const joined = await first.page.evaluate(async () => {
      const bytes = await WorkTimeApp.games.pikafishResources.load();
      const owned = structuredClone(bytes, {
        transfer: [bytes.wasm, bytes.net],
      });
      if (owned.net.byteLength !== WorkTimeApp.games.pikafishAssets.net.size)
        throw Error("Buffer transfer failed");
      const move = await window.engine.search(
        "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
        "normal",
      );
      window.releasePersistence();
      await window.warming;
      window.engine.dispose();
      Cache.prototype.put = window.originalPut;
      return { move, requests: window.binaryRequests.length };
    });
    assert.match(joined.move, /^[a-i][0-9][a-i][0-9]$/);
    assert.equal(
      joined.requests,
      4,
      "foreground joins both download and pending persistence without duplicate downloads",
    );
    assert.deepEqual(first.errors, []);
    await first.context.close();

    failBinaries = true;
    const second = await fixture();
    await second.page.waitForFunction(() => window.binaryRequests.length === 2);
    await second.context.setOffline(true);
    failBinaries = false;
    await second.context.setOffline(false);
    await cached(second.page);
    const retry = await second.page.evaluate(() => ({
      requests: window.binaryRequests.length,
      workers: window.engineWorkers,
    }));
    assert.equal(
      retry.requests,
      4,
      "restoring connectivity retries the missing binaries once",
    );
    assert.equal(retry.workers, 0);
    assert.deepEqual(second.errors, []);
    await second.context.close();
    console.log(
      "Network-idle prefetch without games or input-idle gating; cache hits; download/persistence sharing; legal foreground reply; silent failure and online retry verified.",
    );
  } finally {
    releaseModel?.();
    prerequisite?.();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
