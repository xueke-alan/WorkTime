"use strict";
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
  await page.addInitScript(() => {
    window.clipboardWrites = 0;
    window.clipboardValue = "";
    window.clipboardDenied = false;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: async () => {
          if (window.clipboardDenied)
            throw new DOMException("denied", "NotAllowedError");
          return window.clipboardValue;
        },
        writeText: async (text) => {
          if (window.clipboardDenied)
            throw new DOMException("denied", "NotAllowedError");
          window.clipboardValue = text;
          window.clipboardWrites++;
        },
      },
      configurable: true,
    });
  });
  await page.goto(
    require("node:url").pathToFileURL(path.resolve(__dirname, "../index.html"))
      .href,
  );
  await page.locator("#backup").waitFor({ state: "visible" });
  await page.locator("#backup").focus();
  await page.keyboard.down("Space");
  await page.clock.fastForward(100);
  await page.keyboard.up("Space");
  await page.waitForFunction(() => window.clipboardWrites === 1);
  const copied = await page.evaluate(async () =>
    WorkBackup.decode(window.clipboardValue, WorkTime.validateBackup),
  );
  assert.equal(copied.schemaVersion, 1);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.down("Space");
  await page.clock.fastForward(2600);
  const download = await downloadPromise;
  await page.keyboard.up("Space");
  const raw = await fs.readFile(await download.path(), "utf8"),
    file = JSON.parse(raw);
  assert.equal(file.schemaVersion, 1);
  assert.equal(
    await page.evaluate(() => window.clipboardWrites),
    1,
    "Long hold downloads once without extra clipboard copy",
  );
  await page.evaluate(() => (window.clipboardDenied = true));
  await page.locator("#backup").click();
  await page.waitForFunction(() =>
    document
      .getElementById("feedbackList")
      .textContent.includes("请允许剪贴板访问"),
  );
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#restore").click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "saved.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await page.locator("#confirmRestore").click();
  assert.equal(
    await page.locator("#restoreDialog").evaluate((e) => e.open),
    false,
  );
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("worktime-local-v1")),
  );
  assert.deepEqual(restored.settings, file.settings);
  const beforeExit = await page.evaluate(() =>
    localStorage.getItem("worktime-local-v1"),
  );
  await page.evaluate(() => {
    window.pendingClipboard = [];
    window.prepareCalls = 0;
    navigator.clipboard.readText = () =>
      new Promise((resolve) => window.pendingClipboard.push(resolve));
    const original = WorkImports.prepare;
    WorkImports.prepare = (...args) => {
      window.prepareCalls++;
      return original(...args);
    };
  });
  await page.locator("[data-import-clipboard]").click();
  await page.locator("#restore").click();
  assert.equal(await page.evaluate(() => window.pendingClipboard.length), 2);
  await page.evaluate((text) => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    window.pendingClipboard[0]("09/28\n08:00\n17:30");
    window.pendingClipboard[1](text);
  }, raw);
  await page.clock.fastForward(100);
  assert.equal(
    await page.evaluate(() => window.prepareCalls),
    0,
    "Disposed import must not plan or commit delayed clipboard data",
  );
  assert.equal(
    await page.locator("#restoreDialog").evaluate((e) => e.open),
    false,
    "Disposed restore must not reopen a dialog",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("worktime-local-v1")),
    beforeExit,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Controller backup passed: short copy, long download, denied/file fallback and pending clipboard import/restore canceled after page exit.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
