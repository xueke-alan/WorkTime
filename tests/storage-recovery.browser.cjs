"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const url = require("node:url").pathToFileURL(
  path.resolve(__dirname, "../index.html"),
).href;
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const errors = [];
  async function open(raw = null, mode = "normal") {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ raw, mode }) => {
        const key = "worktime-local-v1";
        if (!sessionStorage.getItem("seeded")) {
          if (raw !== null) localStorage.setItem(key, raw);
          localStorage.setItem("worktime.pageTheme", "blue");
          localStorage.setItem("unrelated", "keep");
          sessionStorage.setItem("seeded", "yes");
        }
        window.failRead = mode === "unavailable";
        window.failWrite = false;
        window.failTheme = false;
        const get = Storage.prototype.getItem,
          set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (name) {
          if (name === key && window.failRead)
            throw Error("test access denied");
          return get.call(this, name);
        };
        Storage.prototype.setItem = function (name, value) {
          if (
            (name === key && window.failWrite) ||
            (name === "worktime.pageTheme" && window.failTheme)
          )
            throw new DOMException("test full", "QuotaExceededError");
          return set.call(this, name, value);
        };
        navigator.clipboard.readText = async () => window.restoreText;
      },
      { raw, mode },
    );
    await page.goto(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    return { page, context };
  }
  async function stored(page) {
    return page.evaluate(() => localStorage.getItem("worktime-local-v1"));
  }
  const normal = await open();
  assert.equal(
    await normal.page.locator("#initializeStorage").isVisible(),
    false,
  );
  const backup = await normal.page.evaluate(() => {
    const state = WorkTimeApp.domain.state.defaultState();
    state.days["2026-10-08"] = { note: "recovered" };
    state.preferences.pageTheme = "rose";
    return JSON.stringify(state);
  });
  await normal.context.close();

  const broken = await open("{original bytes");
  const page = broken.page;
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator("#initializeStorage").isVisible(), true);
  assert.equal(await page.locator("#retryStorage").isVisible(), false);
  assert.equal(await page.locator("#exportCorruptStorage").isVisible(), true);
  await page.locator("#initializeStorage").click();
  assert.equal(
    await page
      .locator("#initializeDialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.screenshot({
    path: path.resolve(__dirname, "../test-results/storage-initialize-390.png"),
  });
  await page.locator('[data-close="initializeDialog"]').last().click();
  assert.equal(await stored(page), "{original bytes");
  await page.evaluate(() => {
    document.getElementById("standardEnd").value = "19:00";
  });
  await page.locator("#initializeStorage").click();
  await page.evaluate(() => (window.failWrite = true));
  await page.locator("#confirmInitialize").click();
  assert.equal(
    await page.locator("#initializeDialog").evaluate((el) => el.open),
    true,
  );
  assert.match(
    await page.locator("#initializeError").innerText(),
    /初始化未保存/,
  );
  assert.equal(await stored(page), "{original bytes");
  await page.evaluate(() => (window.failWrite = false));
  await Promise.all([
    page.waitForEvent("load"),
    page.locator("#confirmInitialize").click(),
  ]);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  const initialized = JSON.parse(await stored(page));
  assert.deepEqual(initialized.days, {});
  assert.equal(initialized.preferences.pageTheme, "blue");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("unrelated")),
    "keep",
  );
  assert.equal(await page.locator("#initializeStorage").isVisible(), false);
  await broken.context.close();

  const restore = await open("{corrupt");
  await restore.page.evaluate((text) => {
    window.restoreText = text;
    window.failWrite = true;
  }, backup);
  await restore.page.locator("#restoreStorage").click();
  await restore.page.locator("#restoreDialog").waitFor({ state: "visible" });
  await restore.page.locator("#confirmRestore").click();
  assert.match(
    await restore.page.locator("#restoreError").innerText(),
    /恢复未保存/,
  );
  assert.equal(await stored(restore.page), "{corrupt");
  assert.equal(
    await restore.page.locator("html").getAttribute("data-theme"),
    "blue",
  );
  await restore.page.evaluate(() => {
    window.failWrite = false;
    window.failTheme = true;
  });
  await restore.page.locator("#confirmRestore").click();
  assert.equal(
    JSON.parse(await stored(restore.page)).days["2026-10-08"].note,
    "recovered",
  );
  assert.match(
    await restore.page.locator("#restoreError").innerText(),
    /记录已恢复，主题未保存/,
  );
  assert.equal(
    await restore.page.locator("#confirmRestore").isDisabled(),
    true,
  );
  await restore.page.evaluate(() => (window.failTheme = false));
  await restore.page.locator("#retryRestoreTheme").click();
  await restore.page.locator("#restoreDialog").waitFor({ state: "hidden" });
  assert.equal(
    await restore.page.evaluate(() =>
      localStorage.getItem("worktime.pageTheme"),
    ),
    "rose",
  );
  assert.equal(
    await restore.page.locator("#initializeStorage").isVisible(),
    false,
  );
  await restore.context.close();

  const unsupported = await open('{"schemaVersion":1}');
  assert.equal(
    await unsupported.page.locator("#initializeStorage").isVisible(),
    false,
  );
  assert.equal(
    await unsupported.page.locator("#convertStorage").isVisible(),
    true,
  );
  await unsupported.context.close();

  const unavailable = await open(backup, "unavailable");
  assert.equal(
    await unavailable.page.locator("#initializeStorage").isVisible(),
    false,
  );
  assert.equal(
    await unavailable.page.locator("#retryStorage").isVisible(),
    true,
  );
  await unavailable.page.evaluate(() => (window.failRead = false));
  await unavailable.page.locator("#retryStorage").click();
  assert.equal(
    JSON.parse(await stored(unavailable.page)).days["2026-10-08"].note,
    "recovered",
  );
  assert.equal(
    await unavailable.page.locator("#storageNotice").isVisible(),
    false,
  );
  await unavailable.context.close();
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "Storage recovery browser passed: safe initialization, failed replacement retry, theme retry, version conversion and access recovery.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
