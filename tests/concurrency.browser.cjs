"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  path = require("node:path");
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
  const a = await context.newPage(),
    b = await context.newPage();
  for (const page of [a, b])
    await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
  await a.goto(url);
  await a.locator('[data-date="2026-10-08"]').click();
  await b.goto(url);
  await b.locator("#storageNotice").waitFor({ state: "visible" });
  assert.match(
    await b.locator("#storageNoticeText").innerText(),
    /另一页面正在编辑/,
  );
  await a.locator("#dayStart").fill("08:00");
  await a.locator("#dayEnd").fill("18:00");
  await b.locator('[data-date="2026-10-09"]').click();
  await b.locator("#dayStart").fill("08:00");
  await b.locator("#dayEnd").fill("19:00");
  const dates = await b.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem(WorkTime.KEY)).days),
  );
  assert(dates.includes("2026-10-08"));
  assert(!dates.includes("2026-10-09"));
  assert.match(await b.locator("#dayError").innerText(), /未保存/);
  const download = b.waitForEvent("download");
  await b.locator("#backupBeforeRestore").evaluate((e) => e.click());
  const stream = await (await download).createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk;
  assert(JSON.parse(text).days["2026-10-09"]);
  await a.close();
  await b.reload();
  await b.locator('[data-date="2026-10-09"]').click();
  await b.locator("#dayStart").fill("08:00");
  await b.locator("#dayEnd").fill("19:00");
  const saved = await b.evaluate(
    () => JSON.parse(localStorage.getItem(WorkTime.KEY)).days,
  );
  assert(saved["2026-10-08"]);
  assert(saved["2026-10-09"]);
  // Even a non-cooperating external update must not be overwritten by this page's old snapshot.
  await b.evaluate(() => {
    const s = JSON.parse(localStorage.getItem(WorkTime.KEY));
    s.days["2026-10-12"] = { note: "external" };
    localStorage.setItem(WorkTime.KEY, JSON.stringify(s));
  });
  await b.locator("#dayEnd").fill("19:01");
  assert.match(await b.locator("#storageNoticeText").innerText(), /外部更新/);
  assert.equal(
    await b.evaluate(
      () =>
        JSON.parse(localStorage.getItem(WorkTime.KEY)).days["2026-10-12"].note,
    ),
    "external",
  );
  await b.close();
  const unsupported = await context.newPage();
  await unsupported.addInitScript(() =>
    Object.defineProperty(navigator, "locks", { value: undefined }),
  );
  await unsupported.goto(url);
  await unsupported.locator("#storageNotice").waitFor({ state: "visible" });
  assert.match(
    await unsupported.locator("#storageNoticeText").innerText(),
    /不支持安全写入锁/,
  );
  console.log(
    "Concurrency passed: native single writer, read-only page export, handover, external-update protection and unsupported-lock fallback.",
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
