"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ||
    path.join(__dirname, ".."),
);
async function unit() {
  const handlers = new Map(),
    stores = new Map();
  const scope = "https://fixture.invalid/WorkTime/";
  let requests = 0,
    failure = false,
    quota = false,
    status = 200;
  const key = (request) =>
    typeof request === "string" ? request : request.url;
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      match: async (request) => store.get(key(request))?.clone(),
      put: async (request, response) => {
        if (quota) throw Error("quota");
        store.set(key(request), response);
      },
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (request) => store.delete(key(request)),
      addAll: async (requests) => {
        for (const { url, cache } of requests) {
          assert.equal(cache, "reload");
          store.set(url, new Response("shell:" + url));
        }
      },
    };
  };
  let context;
  context = vm.createContext({
    self: {
      location: { origin: "https://fixture.invalid" },
      registration: { scope },
      clients: { claim: async () => {} },
      addEventListener: (name, handler) => handlers.set(name, handler),
    },
    importScripts: () =>
      vm.runInContext(
        fs.readFileSync(path.join(root, "offline-shell.js"), "utf8"),
        context,
      ),
    caches: {
      open: async (name) => cacheFor(name),
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
    },
    fetch: async () => {
      requests++;
      if (failure) throw Error("offline");
      return new Response("network", { status });
    },
    URL,
    Request,
    Response,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "service-worker.js"), "utf8"),
    context,
  );
  const cacheName = context.self.WORKTIME_SHELL.cache;
  async function lifecycle(name) {
    let task;
    handlers.get(name)({
      waitUntil: (value) => {
        task = value;
      },
    });
    await task;
  }
  await lifecycle("install");
  stores.set("worktime-shell-old", new Map());
  stores.set("foreign", new Map());
  await lifecycle("activate");
  assert.deepEqual([...stores.keys()].sort(), ["foreign", cacheName].sort());
  async function fetchAsset(asset, mode) {
    let response;
    const waits = [];
    handlers.get("fetch")({
      request: { url: new URL(asset, scope).href, method: "GET", mode },
      respondWith: (task) => {
        response = task;
      },
      waitUntil: (task) => waits.push(task),
    });
    const result = await response;
    await Promise.all(waits);
    return result;
  }
  const style = "assets/css/probe.css?v=2";
  const cache = cacheFor(cacheName);
  await cache.put(
    new URL("assets/css/probe.css?v=1", scope).href,
    new Response("old"),
  );
  assert.equal(await (await fetchAsset(style)).text(), "network");
  assert.equal(
    (await cache.keys()).some((request) =>
      request.url.endsWith("probe.css?v=1"),
    ),
    false,
  );
  const before = requests;
  assert.equal(await (await fetchAsset(style)).text(), "network");
  assert.equal(
    requests,
    before,
    "content hashes must hit cache without network",
  );
  assert.equal(await (await fetchAsset("./", "navigate")).text(), "network");
  failure = true;
  assert.ok(
    (await (await fetchAsset("./", "navigate")).text()).startsWith("shell:"),
  );
  assert.equal((await fetchAsset("assets/missing.js")).type, "error");
  failure = false;
  status = 503;
  assert.ok(
    (await (await fetchAsset("index.html", "navigate")).text()).startsWith(
      "shell:",
    ),
  );
  status = 200;
  quota = true;
  assert.equal(await (await fetchAsset("data/weather.json")).text(), "network");
  const outside = requests;
  assert.equal(await fetchAsset("https://other.invalid/test"), undefined);
  assert.equal(
    await fetchAsset("assets/vendor/misty-jungle/test.wasm"),
    undefined,
  );
  assert.equal(requests, outside);
  console.log(
    "Offline shell: full precache, version cleanup, immutable hits, offline/503 fallback, binary bypass and quota tolerance passed.",
  );
}
async function browser() {
  require("./lib/browser-test-setup.cjs");
  const { chromium } = require("playwright");
  const { startupServer } = require("./lib/startup-test-server.cjs");
  const server = await startupServer(root);
  let instance;
  try {
    instance = await chromium.launch({
      channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
      headless: true,
    });
    const context = await instance.newContext({
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Engine caches have independent tests; keep this test focused on the installed shell.
    await context.route(
      /\/assets\/vendor\/(pikafish|utttai|rapfi|misty-jungle)\//,
      (route) => route.abort(),
    );
    await page.goto(server.url);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    assert.ok((await page.locator(".day[data-date]").count()) >= 28);
    await page.locator("#analysisToggle").click();
    await page.locator("#analysisPlot").waitFor({ state: "visible" });
    assert.equal(await page.locator('link[href*="analysis.css"]').count(), 1);
    assert.deepEqual(errors, []);
    console.log(
      "HTTP shell installed, reloaded offline and opened deferred analysis styles: " +
        root,
    );
  } finally {
    await instance?.close();
    await server.close();
  }
}
async function verify() {
  await unit();
  if (!process.argv.includes("--unit")) await browser();
}
if (require.main === module)
  verify().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { unit };
