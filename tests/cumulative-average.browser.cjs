"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright"),
  { buildPerformanceFixture } = require("../scripts/performance-fixtures.cjs");
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const state = buildPerformanceFixture(1).state;
  state.settings.standardMinutes = 480;
  state.settings.workEnd = "17:00";
  state.settings.breaks = [
    { start: 720, end: 780 },
    { start: 1050, end: 1080 },
  ];
  const review = await browser.newPage({
    reducedMotion: "reduce",
    timezoneId: "Asia/Shanghai",
  });
  const data = { ...state, days: {} };
  const coreContext = require("node:vm").createContext({});
  require("node:vm").runInContext(
    require("./helpers/core-source.cjs").readCoreSource(),
    coreContext,
  );
  const C = require("node:vm").runInContext("WorkTime", coreContext);
  for (let i = 1; i < 30; i++) {
    const key = "2026-09-" + String(i).padStart(2, "0");
    if (C.calendarInfo(key, {}).work)
      data.days[key] = {
        actual: {
          start: "08:00",
          end: "19:04",
          nextDay: false,
          effectiveMinutes: 574,
        },
      };
  }
  data.days["2026-09-30"] = {
    oa: {
      date: "2026-09-30",
      status: "pending",
      start: "08:55",
      end: "",
      nextDay: false,
      source: "",
      raw: "",
      importId: "",
    },
  };
  await review.clock.install({ time: new Date("2026-10-03T12:00:00+08:00") });
  await review.addInitScript(
    (state) => localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
    data,
  );
  await review.goto(
    pathToFileURL(path.resolve(__dirname, "../index.html")).href,
  );
  await review.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await review.locator("#prevMonth").click();
  const card = review.locator('[data-date="2026-09-30"]');
  await card.click();
  assert.equal(await card.locator(".day-average").innerText(), "—");
  assert.equal(await card.locator(".trend-icon").count(), 0);
  assert.equal(await review.locator("#previewAverage").innerText(), "—");
  assert(
    (await review.locator("#dayPreview").innerText()).includes(
      "打卡未完成，暂不显示平均加班",
    ),
  );
  assert(
    (
      await review
        .locator(".average-card .summary-number-accessible")
        .textContent()
    ).includes("1.567"),
  );
  assert(
    (
      await review.locator('[data-date="2026-09-29"] .day-average').innerText()
    ).includes("1.57"),
  );
  await review.locator("#dayStart").fill("08:00");
  await review.locator("#dayEnd").fill("19:00");
  assert((await card.locator(".day-average").innerText()).includes("1.56"));
  assert.equal(
    await review
      .locator("#previewAverage .summary-number-accessible")
      .textContent(),
    "1.56 h",
  );
  assert(
    (
      await review
        .locator(".average-card .summary-number-accessible")
        .textContent()
    ).includes("1.564"),
  );
  assert(
    (await card.locator(".day-average").getAttribute("title")).includes(
      "已完成记录的折算出勤",
    ),
  );
  await review.locator("#dayEnd").fill("07:00");
  assert.equal(await card.locator(".day-average").innerText(), "—");
  assert.equal(await review.locator("#previewAverage").innerText(), "—");
  await review.locator("#dayEnd").fill("");
  assert.equal(await review.locator("#previewAverage").innerText(), "—");
  const rest = review.locator('[data-date="2026-09-26"]');
  assert.equal(await rest.locator(".day-average").innerText(), "");
  assert.equal(await rest.locator(".trend-icon").count(), 0);
  await rest.click();
  await review.locator("#dayStart").fill("08:00");
  await review.locator("#dayEnd").fill("08:00");
  assert.equal(await rest.locator(".day-average").innerText(), "");
  await review.locator("#dayEnd").fill("10:00");
  assert((await rest.locator(".day-average").innerText()).includes("1.57"));
  console.log(
    "Cumulative average browser passed: pending display, 32.90/21 example, filling/clearing/anomaly updates and shared formula.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
