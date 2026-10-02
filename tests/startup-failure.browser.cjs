"use strict";
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=WorkTime",
  context,
);
const state = JSON.parse(JSON.stringify(context.C.defaultState()));
delete state.scheduleDefaultsVersion;
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
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  await ctx.addInitScript(
    (text) => localStorage.setItem("worktime-local-v1", text),
    original,
  );
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
