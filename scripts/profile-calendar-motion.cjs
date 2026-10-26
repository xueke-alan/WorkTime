"use strict";
const setScheduleRange = require("./lib/agenda-test-range.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function profile() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const results = [];
  try {
    for (const width of [1480, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        reducedMotion: "reduce",
      });
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-20T04:00:00Z"));
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.locator("#agendaMode").click();
      for (let i = 0; i < 8; i++) {
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill("动画性能样本 " + i);
        await page.locator("#agendaScheduleOpen").click();
        await setScheduleRange(page, "2026-10-20");
        if (i % 2 === 0) {
          await page.locator("#agendaEndDateInput").fill("2026-10-28");
        }
        await page.locator("[data-schedule-close]").click();
        await page
          .locator("#agendaNote")
          .fill("日期卡片与跨周日程同步运动\n第二行备注");
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
      }
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const session = await page.context().newCDPSession(page);
      await session.send("Performance.enable");
      await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const metrics = async () =>
        Object.fromEntries(
          (await session.send("Performance.getMetrics")).metrics.map(
            ({ name, value }) => [name, value],
          ),
        );
      // Warm each path, then repeat it in exactly the same order for comparisons.
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const [name, selector] of [
          ["month-week", "#agendaViewToggle"],
          ["week-fortnight", "#agendaViewToggle"],
          ["fortnight-attendance", "#agendaMode"],
          ["attendance-fortnight", "#agendaMode"],
          ["fortnight-next", "#nextMonth"],
          ["fortnight-prev", "#prevMonth"],
          ["fortnight-month", "#agendaViewToggle"],
          ["agenda-attendance", "#agendaMode"],
          ["month-next", "#nextMonth"],
          ["month-prev", "#prevMonth"],
          ["month-year", "#monthTitle"],
          ["year-month", "#monthTitle"],
          ["attendance-analysis", "#analysisToggle"],
          ["analysis-attendance", "#analysisToggle"],
          ["attendance-agenda", "#agendaMode"],
        ]) {
          const before = await metrics();
          const sample = await page.evaluate(async (selector) => {
            const start = performance.now();
            document.querySelector(selector).click();
            const clickMs = performance.now() - start;
            const gaps = [];
            let last = performance.now();
            while (performance.now() - start < 1000) {
              await new Promise(requestAnimationFrame);
              const now = performance.now();
              gaps.push(now - last);
              last = now;
            }
            return {
              clickMs,
              maxGapMs: Math.max(...gaps),
              longFrames: gaps.filter((gap) => gap > 34).length,
            };
          }, selector);
          const after = await metrics();
          if (repeat)
            results.push({
              width,
              repeat,
              name,
              ...sample,
              layouts: after.LayoutCount - before.LayoutCount,
              layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
              styles: after.RecalcStyleCount - before.RecalcStyleCount,
              styleMs:
                (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
              taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
            });
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  const output = path.resolve(
    process.argv[2] || "test-results/calendar-motion/profile.json",
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    JSON.stringify({ cpuSlowdown: 4, samples: results }, null, 2),
  );
  console.log(output);
}
profile().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
