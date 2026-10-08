"use strict";

const assert = require("node:assert/strict"),
  path = require("node:path");
const url = require("node:url").pathToFileURL(
  path.resolve(__dirname, "../index.html"),
).href;
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
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
  await b.locator("#retryStorage").click();
  await b.waitForFunction(
    () => !document.getElementById("retryStorage").disabled,
  );
  assert.match(
    await b.locator("#storageNoticeText").innerText(),
    /可能位于后台/,
  );
  assert.equal(
    (await a.evaluate(() => navigator.locks.query())).held.length,
    1,
  );
  await a.locator("#dayStart").fill("08:00");
  await a.locator("#dayEnd").fill("18:00");
  await b.locator('[data-date="2026-10-09"]').click();
  await b.locator("#dayStart").fill("08:00");
  await b.locator("#dayEnd").fill("19:00");
  const dates = await b.evaluate(() =>
    Object.keys(
      JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days,
    ),
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
  await b.waitForFunction(() =>
    document
      .getElementById("storageNoticeText")
      .textContent.includes("外部更新"),
  );
  assert(
    !(
      await b.evaluate(
        () =>
          JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days,
      )
    )["2026-10-09"],
    "Automatic handover must not overwrite records written since this page loaded",
  );
  await b.reload();
  await b.locator('[data-date="2026-10-09"]').click();
  await b.locator("#dayStart").fill("08:00");
  await b.locator("#dayEnd").fill("19:00");
  const saved = await b.evaluate(
    () => JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days,
  );
  assert(saved["2026-10-08"]);
  assert(saved["2026-10-09"]);
  // Even a non-cooperating external update must not be overwritten by this page's old snapshot.
  await b.evaluate(() => {
    const s = JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY));
    s.days["2026-10-12"] = { note: "external" };
    localStorage.setItem(WorkTimeApp.domain.state.KEY, JSON.stringify(s));
  });
  await b.locator("#dayEnd").fill("19:01");
  assert.match(await b.locator("#storageNoticeText").innerText(), /外部更新/);
  assert.equal(
    await b.evaluate(
      () =>
        JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days[
          "2026-10-12"
        ].note,
    ),
    "external",
  );
  await b.close();
  const owner = await context.newPage(),
    waiting = await context.newPage();
  for (const page of [owner, waiting]) {
    await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
    await page.goto(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
  }
  await waiting.locator('[data-date="2026-10-13"]').click();
  await waiting.locator("#dayStart").fill("08:00");
  await waiting.locator("#dayEnd").fill("18:00");
  await owner.close();
  await waiting.locator("#storageNotice").waitFor({ state: "hidden" });
  assert.equal(
    await waiting.evaluate(
      () =>
        JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days[
          "2026-10-13"
        ].estimate.end,
    ),
    "18:00",
    "Unchanged storage allows automatic saving of retained edits without reloading",
  );
  assert.equal(await waiting.locator("#dayError").innerText(), "");
  const abandoned = await context.newPage();
  await abandoned.goto(url);
  await abandoned.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await abandoned.close();
  assert.equal(
    (await waiting.evaluate(() => navigator.locks.query())).pending.length,
    0,
    "Closing a waiting page cancels its queued lock request",
  );
  await waiting.close();
  // An untouched waiter follows the owner's latest state after a retry and release.
  const latestOwner = await context.newPage(),
    clean = await context.newPage();
  for (const page of [latestOwner, clean]) {
    await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
    await page.goto(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
  }
  await clean.locator("#settingsOpen").click();
  await clean.locator("#retryStorage").click();
  await latestOwner.locator("#settingsOpen").click();
  await latestOwner.locator("#standardStart").fill("08:15");
  await require("./helpers/apply-schedule.cjs")(latestOwner);
  await latestOwner.close();
  await clean.locator("#storageNotice").waitFor({ state: "hidden" });
  assert.equal(await clean.locator("#standardStart").inputValue(), "08:15");
  // A writable page can refresh externally changed data if no fields were edited.
  await clean.evaluate(() => {
    const state = JSON.parse(
      localStorage.getItem(WorkTimeApp.domain.state.KEY),
    );
    state.settings.workStart = "08:30";
    state.settings.standardMinutes = 450;
    localStorage.setItem(WorkTimeApp.domain.state.KEY, JSON.stringify(state));
  });
  await clean.locator("#retryStorage").evaluate((e) => e.click());
  await clean.waitForFunction(
    () => document.getElementById("standardStart").value === "08:30",
  );
  assert.equal(await clean.locator("#standardStart").inputValue(), "08:30");
  await clean.close();
  // Incomplete input must remain untouched even if it never reached the model.
  const fieldOwner = await context.newPage(),
    partial = await context.newPage();
  for (const page of [fieldOwner, partial]) {
    await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
    await page.goto(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
  }
  await partial.locator("#settingsOpen").click();
  await partial.locator("#standardStart").fill("");
  await fieldOwner.locator("#settingsOpen").click();
  await fieldOwner.locator("#standardStart").fill("08:45");
  await require("./helpers/apply-schedule.cjs")(fieldOwner);
  await fieldOwner.close();
  await partial.waitForFunction(() =>
    document
      .getElementById("storageNoticeText")
      .textContent.includes("外部更新"),
  );
  assert.equal(await partial.locator("#standardStart").inputValue(), "");
  await partial.close();
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
    "Concurrency passed: single writer, retained-edit export, automatic handover, external-update protection, canceled waiters and unsupported-lock fallback.",
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
