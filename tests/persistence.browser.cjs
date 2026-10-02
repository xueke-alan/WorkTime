"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const url = require("node:url").pathToFileURL(
  path.resolve(__dirname, "../index.html"),
).href;
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    window.failPersistence = true;
    Storage.prototype.setItem = function (...args) {
      if (window.failPersistence)
        throw new DOMException("test quota", "QuotaExceededError");
      return write.apply(this, args);
    };
  });
  await page.goto(url);
  await page.locator("#settingsOpen").click();
  await page.locator("#standardEnd").fill("18:30");
  await page.locator("#settingsForm button[type=submit]").click();
  assert(await page.locator("#settingsDialog").evaluate((e) => e.open));
  assert.match(await page.locator("#settingsError").innerText(), /尚未保存/);
  assert(
    !(await page.locator("#feedbackList").innerText()).includes(
      "计算设置已更新",
    ),
  );
  await page.evaluate(() => (window.failPersistence = false));
  await page.locator("#settingsForm button[type=submit]").click();
  assert.equal(
    await page.locator("#settingsDialog").evaluate((e) => e.open),
    false,
  );
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem(WorkTime.KEY)).settings.workEnd,
    ),
    "18:30",
  );
  await page.evaluate(() => (window.failPersistence = true));
  await page.locator("#addTimeTemplate").click();
  await page.locator("#timeTemplateName").fill("重试模板");
  await page.locator("#timeTemplateStart").fill("08:00");
  await page.locator("#timeTemplateEnd").fill("19:00");
  await page.locator("#timeTemplateForm button[type=submit]").click();
  assert(await page.locator("#timeTemplateDialog").evaluate((e) => e.open));
  assert.match(
    await page.locator("#timeTemplateError").innerText(),
    /尚未保存/,
  );
  await page.evaluate(() => (window.failPersistence = false));
  await page.locator("#timeTemplateForm button[type=submit]").click();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem(WorkTime.KEY)).timeTemplates.length,
    ),
    1,
  );
  await page.locator('[data-date="2026-10-08"]').click();
  await page.evaluate(() => (window.failPersistence = true));
  await page.locator("#dayStart").fill("08:00");
  await page.locator("#dayEnd").fill("19:30");
  assert.match(await page.locator("#dayError").innerText(), /未保存/);
  assert.equal(await page.locator("#dayEnd").inputValue(), "19:30");
  await page.evaluate(() => (window.failPersistence = false));
  await page.locator("#dayEnd").fill("19:31");
  assert.equal(
    await page.evaluate(
      () =>
        WorkTime.effectiveRecord(
          JSON.parse(localStorage.getItem(WorkTime.KEY)).days["2026-10-08"],
          true,
        ).end,
    ),
    "19:31",
  );
  await page.evaluate(() => (window.failPersistence = true));
  await page.locator("#importOpen").click();
  await page.locator("#pasteText").fill("09/28\n08:00\n17:30");
  await page.waitForFunction(
    () => !document.getElementById("commitImport").disabled,
  );
  await page.locator("#commitImport").click();
  const feedback = await page.locator("#feedbackList").innerText();
  assert(!feedback.includes("导入完成"));
  assert(feedback.includes("未能保存"));
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem(WorkTime.KEY)).imports.length,
    ),
    0,
  );
  const download = page.waitForEvent("download");
  await page.locator("#backupBeforeRestore").evaluate((e) => e.click());
  const file = await download;
  const stream = await file.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  assert.equal(JSON.parse(content).imports.length, 1);
  assert.deepEqual(errors, []);
  await context.close();
  const corruptContext = await browser.newContext({ reducedMotion: "reduce" }),
    corrupt = await corruptContext.newPage();
  await corrupt.addInitScript(() =>
    localStorage.setItem("worktime-local-v1", "{broken original"),
  );
  await corrupt.goto(url);
  await corrupt.locator("#exportCorruptStorage").waitFor({ state: "visible" });
  const originalDownload = corrupt.waitForEvent("download");
  await corrupt.locator("#exportCorruptStorage").click();
  const originalStream = await (await originalDownload).createReadStream();
  let originalText = "";
  for await (const chunk of originalStream) originalText += chunk.toString();
  assert.equal(originalText, "{broken original");
  console.log(
    "Persistence browser passed: settings/template retry, no duplicate template, manual dirty state, failed import feedback, exporting unsaved edits and corrupt original source.",
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
