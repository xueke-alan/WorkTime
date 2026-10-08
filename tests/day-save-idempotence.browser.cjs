"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  buildPerformanceFixture,
} = require("../scripts/performance-fixtures.cjs");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    timezoneId: "Asia/Shanghai",
    reducedMotion: "no-preference",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-09-30T12:00:00+08:00") });
  await page.addInitScript((state) => {
    localStorage.setItem("worktime-local-v1", JSON.stringify(state));
    const original = Storage.prototype.setItem;
    window.dayWriteAttempts = 0;
    window.failDayWrite = false;
    Storage.prototype.setItem = function (key, value) {
      if (key === "worktime-local-v1") {
        window.dayWriteAttempts++;
        if (window.failDayWrite)
          throw new DOMException("Test quota", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
  }, buildPerformanceFixture(10).state);
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
  await page.evaluate(() => {
    window.dayWriteAttempts = 0;
    window.retainedDay = document.querySelector('[data-date="2026-09-30"]');
    window.retainedDay.focus();
    document.getElementById("dayStart").value = "08:00";
    document.getElementById("dayEnd").value = "20:00";
    document
      .getElementById("dayStart")
      .dispatchEvent(new Event("input", { bubbles: true }));
    window.retainedPreview = document.getElementById("expectedHours");
    window.retainedNumber = document.querySelector(
      "#cards .metric .summary-number",
    );
    document
      .getElementById("dayEnd")
      .dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(
    await page.evaluate(() => window.dayWriteAttempts),
    1,
    "Paired unchanged input writes once",
  );
  assert(
    await page.evaluate(
      () =>
        document.activeElement === window.retainedDay &&
        window.retainedPreview === document.getElementById("expectedHours") &&
        window.retainedNumber ===
          document.querySelector("#cards .metric .summary-number"),
    ),
    "No-op preserves focus and number animation nodes",
  );
  await page.evaluate(() => {
    window.failDayWrite = true;
    document.getElementById("dayEnd").value = "20:30";
    document
      .getElementById("dayEnd")
      .dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.match(await page.locator("#dayError").textContent(), /未保存/);
  assert.equal(await page.evaluate(() => window.dayWriteAttempts), 2);
  await page.evaluate(() => {
    window.failDayWrite = false;
    document
      .getElementById("dayEnd")
      .dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(
    await page.evaluate(() => window.dayWriteAttempts),
    3,
    "Same value retries failed persistence",
  );
  assert.equal(await page.locator("#dayError").textContent(), "");
  assert.equal(
    await page.evaluate(
      () =>
        WorkTimeApp.domain.records.effectiveRecord(
          JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days[
            "2026-09-30"
          ],
          true,
        ).end,
    ),
    "20:30",
  );
  await page.evaluate(() =>
    document
      .getElementById("dayEnd")
      .dispatchEvent(new Event("input", { bubbles: true })),
  );
  assert.equal(
    await page.evaluate(() => window.dayWriteAttempts),
    3,
    "Successful retry becomes a no-op",
  );
  await page.clock.fastForward(3000);
  assert(
    await page.evaluate(() => {
      const state = JSON.parse(
          localStorage.getItem(WorkTimeApp.domain.state.KEY),
        ),
        expected = WorkTimeApp.domain.statistics.summary(
          state,
          "2026-09-01",
          "2026-09-30",
        );
      const metric = document
        .querySelectorAll("#cards .metric")[4]
        .cloneNode(true);
      metric
        .querySelectorAll('[aria-hidden="true"]')
        .forEach((node) => node.remove());
      return (
        metric.textContent.replace(/\s/g, "") ===
        WorkTimeApp.domain.time.formatMinutes(expected.total).replace(/\s/g, "")
      );
    }),
    "Displayed total equals reference domain after retry",
  );
  await page.evaluate(() => {
    document.getElementById("dayLeave").value = "-1";
    document
      .getElementById("dayLeave")
      .dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("dayLeaveDone").click();
  });
  assert.match(await page.locator("#dayPreview").textContent(), /请假时长/);
  assert.match(await page.locator("#dayError").textContent(), /请假时长/);
  assert.equal(
    await page.evaluate(() => window.dayWriteAttempts),
    3,
    "Invalid leave does not persist",
  );
  await page.evaluate(() => {
    document.getElementById("dayLeave").value = "0";
    document
      .getElementById("dayLeave")
      .dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("dayLeaveDone").click();
  });
  assert.equal(await page.locator("#dayError").textContent(), "");
  assert.equal(
    await page.locator("#dayPreview .preview-totals").count(),
    1,
    "Valid preview restored after error",
  );
  assert.equal(
    await page.evaluate(() => window.dayWriteAttempts),
    3,
    "Error recovery retains the saved no-op contract",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Day save passed: paired no-op, retained nodes/focus, failed identical retry and reference totals.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
