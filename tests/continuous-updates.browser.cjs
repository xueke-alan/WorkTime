"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright"),
  { buildPerformanceFixture } = require("../scripts/performance-fixtures.cjs");
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      timezoneId: "Asia/Shanghai",
      reducedMotion: "reduce",
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((state) => {
    localStorage.setItem("worktime-local-v1", JSON.stringify(state));
    window.backgroundDraws = 0;
    const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === "particleBg") window.backgroundDraws++;
      return original.apply(this, args);
    };
  }, buildPerformanceFixture(10).state);
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
  await page.evaluate(() => {
    window.originalCard = document.querySelector("#cards .card");
    window.originalMetric = window.originalCard.querySelector(".metric");
    window.originalDay = document.querySelector("#calendar button.day");
    window.originalDay.focus();
    document.getElementById("dayStart").value = "08:00";
    document.getElementById("dayEnd").value = "20:00";
    for (const id of ["dayStart", "dayEnd"])
      document
        .getElementById(id)
        .dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert(
    await page.evaluate(
      () =>
        window.originalCard === document.querySelector("#cards .card") &&
        window.originalMetric ===
          window.originalCard.querySelector(".metric") &&
        window.originalDay.isConnected &&
        document.activeElement === window.originalDay,
    ),
  );
  assert(
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem(WorkTime.KEY)),
        today = WorkTime.businessDate(),
        month = today.slice(0, 7),
        parts = month.split("-").map(Number),
        end = WorkTime.dateKey(new Date(parts[0], parts[1], 0, 12)),
        summary = WorkTime.summary(state, month + "-01", end);
      const metric = document
        .querySelectorAll("#cards .metric")[4]
        .cloneNode(true);
      metric
        .querySelectorAll('[aria-hidden="true"]')
        .forEach((node) => node.remove());
      return (
        metric.textContent.replace(/\s/g, "") ===
        WorkTime.formatMinutes(summary.total).replace(/\s/g, "")
      );
    }),
  );
  await page.evaluate(() => {
    window.countdownCalls = 0;
    window.DateInfo.register({
      id: "countdown",
      label: "下班倒计时",
      getContent: () => ({
        title: "下班倒计时",
        countdown: {
          message: "距离下班",
          time: String(++window.countdownCalls).padStart(8, "0"),
          end: "18:00",
        },
      }),
    });
    document.querySelector("#date-tab-countdown").click();
    window.countdownBox = document.querySelector(".work-countdown");
    window.countdownTime = document.querySelector(".countdown-time");
    window.countdownPanel = document.querySelector("#dateInfoPanel");
    window.countdownPanel.focus();
    window.initialCalls = window.countdownCalls;
  });
  await page.waitForFunction(() => window.countdownCalls > window.initialCalls);
  assert(
    await page.evaluate(
      () =>
        window.countdownBox === document.querySelector(".work-countdown") &&
        window.countdownTime === document.querySelector(".countdown-time") &&
        document.activeElement === window.countdownPanel,
    ),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const startDraws = await page.evaluate(() => window.backgroundDraws);
  await page.waitForFunction(
    (start) => window.backgroundDraws > start,
    startDraws,
  );
  const hidden = await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    return { draws: window.backgroundDraws, calls: window.countdownCalls };
  });
  await page.waitForTimeout(1100);
  assert.deepEqual(
    await page.evaluate(() => ({
      draws: window.backgroundDraws,
      calls: window.countdownCalls,
    })),
    hidden,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert(
    await page.evaluate((calls) => window.countdownCalls > calls, hidden.calls),
  );
  await page.waitForFunction(
    (draws) => window.backgroundDraws > draws,
    hidden.draws,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(100);
  const still = await page.evaluate(() => window.backgroundDraws);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.backgroundDraws), still);
  const disposed = await page.evaluate(() => {
    window.DateInfoUI.dispose();
    window.DateInfoUI.dispose();
    window.WorkBackground.dispose();
    window.WorkBackground.dispose();
    window.WorkMotion.dispose();
    window.WorkMotion.dispose();
    return { draws: window.backgroundDraws, calls: window.countdownCalls };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(1100);
  assert.deepEqual(
    await page.evaluate(() => ({
      draws: window.backgroundDraws,
      calls: window.countdownCalls,
    })),
    disposed,
  );
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "Continuous updates passed: ten-year saved summary, stable nodes/focus, ticking, hidden/resume, dynamic motion preference and disposal.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
