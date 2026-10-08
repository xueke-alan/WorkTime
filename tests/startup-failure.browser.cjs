"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=DomainTest",
  context,
);
const state = JSON.parse(JSON.stringify(context.C.defaultState()));
state.days["2026-09-28"] = {
  actual: {
    start: "08:00",
    end: "17:30",
    nextDay: false,
    effectiveMinutes: null,
  },
};
const original = JSON.stringify(state);
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const ctx = await browser.newContext({
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  await ctx.addInitScript(
    (text) => localStorage.setItem("worktime-local-v1", text),
    original,
  );
  await ctx.addInitScript(() => {
    const listeners = new Set(),
      add = window.addEventListener,
      remove = window.removeEventListener;
    window.addEventListener = function (type, listener, options) {
      if (type === "pageshow") listeners.add(listener);
      return add.call(this, type, listener, options);
    };
    window.removeEventListener = function (type, listener, options) {
      if (type === "pageshow") listeners.delete(listener);
      return remove.call(this, type, listener, options);
    };
    window.testPageShowListeners = listeners;
  });
  const page = await ctx.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/assets/js/controllers/settings.js", (route) =>
    route.abort(),
  );
  const url = require("node:url").pathToFileURL(
    path.resolve(__dirname, "../index.html"),
  ).href;
  await page.goto(url);
  await page.locator("#startupFailure").waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.appState),
    "failed",
  );
  assert.match(await page.locator("#startupFailure").innerText(), /初始化失败/);
  assert(
    await page
      .locator("button,input,select,textarea")
      .evaluateAll((elements) => elements.every((element) => element.disabled)),
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("worktime-local-v1")),
    original,
    "Failed initialization must not persist metadata or overwrite original records",
  );
  assert.deepEqual(
    errors,
    [],
    "Startup exception is handled rather than an unhandled promise",
  );
  assert.equal(
    await page.evaluate(() => window.testPageShowListeners.size),
    0,
    "Failed startup releases page restore listeners",
  );
  const healthy = await ctx.newPage();
  await healthy.goto(url);
  await healthy.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  assert(
    await healthy
      .locator("#storageNotice")
      .evaluate((element) => element.classList.contains("hidden")),
    "Failed startup released the writer lock",
  );
  assert.equal(
    (
      await healthy.evaluate(() =>
        JSON.parse(localStorage.getItem("worktime-local-v1")),
      )
    ).days["2026-09-28"].actual.start,
    "08:00",
  );
  assert.equal(
    await healthy.evaluate(() => window.testPageShowListeners.size),
    1,
    "Only mounted alignment owns a restore listener",
  );
  await healthy.evaluate(() => dispatchEvent(new Event("pagehide")));
  assert.equal(
    await healthy.evaluate(() => window.testPageShowListeners.size),
    0,
    "Healthy exit releases page restore listeners",
  );
  const cached = await ctx.newPage();
  await cached.goto(url);
  await cached.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await cached.evaluate(() =>
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
  );
  assert.equal(
    await cached.evaluate(() => window.testPageShowListeners.size),
    1,
    "Cached exit retains only a one-shot reload action",
  );
  await Promise.all([
    cached.waitForEvent("framenavigated", {
      predicate: (frame) => frame === cached.mainFrame(),
    }),
    cached.evaluate(() =>
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
    ),
  ]);
  await cached.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  assert.equal(
    await cached.evaluate(() => window.testPageShowListeners.size),
    1,
    "Restored page starts a fresh application",
  );
  console.log(
    "Startup failure passed: missing controller handled, controls disabled, original data intact and writer lock released for a healthy page.",
  );
  const lifetime = await require("./helpers/startup-lifetime.cjs")(ctx);
  console.log(
    "Startup lifetime passed: " + lifetime.length + " exit/reveal phases.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
