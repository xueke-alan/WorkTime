"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
async function verify() {
  const output = path.resolve("test-results/calendar-date");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "ja", "ko", "en"]) {
      const context = await browser.newContext({
        locale: language,
        reducedMotion: "reduce",
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      for (const width of [1440, 1280, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => WorkTimeApp.ui.alignment.refresh());
        const result = await page.evaluate(() => {
          const stamp = document.querySelector("#calendarToday"),
            date = stamp
              .querySelector(".calendar-today-date")
              .getBoundingClientRect(),
            dot = stamp
              .querySelector(".calendar-today-separator")
              .getBoundingClientRect(),
            weekday = stamp
              .querySelector(".calendar-today-weekday")
              .getBoundingClientRect();
          const baselines = [
            ...stamp.querySelectorAll(
              ".calendar-today-number,.calendar-today-weekday",
            ),
          ].map((node) => {
            const probe = document.createElement("i");
            probe.style.cssText =
              "display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline;font-size:0;line-height:0";
            node.append(probe);
            const y = probe.getBoundingClientRect().top;
            probe.remove();
            return y;
          });
          const box = stamp.getBoundingClientRect(),
            host = stamp.closest(".panel-head").getBoundingClientRect();
          return {
            baselines,
            leftGap: dot.left - date.right,
            rightGap: weekday.left - dot.right,
            slashes: stamp.querySelectorAll(".calendar-date-divider").length,
            expectedSlashes: (
              WorkTimeApp.i18n.date("2026-10-21").match(/\//g) || []
            ).length,
            fits: box.left >= host.left - 1 && box.right <= host.right + 1,
            weekday: stamp.querySelector(".calendar-today-weekday").textContent,
          };
        });
        assert.equal(
          result.slashes,
          result.expectedSlashes,
          language + " uses original slash icon",
        );
        assert.ok(
          Math.max(...result.baselines) - Math.min(...result.baselines) < 0.6,
          language + " shared baseline: " + result.baselines,
        );
        assert.ok(
          Math.abs(result.leftGap - result.rightGap) < 0.6,
          language + " dot spacing is symmetric",
        );
        assert.ok(result.leftGap >= 5, language + " dot has breathing room");
        assert.ok(result.fits, language + " date fits at " + width);
        await page.locator("#calendarToday").screenshot({
          path: path.join(output, language + "-" + width + ".png"),
        });
      }
      await context.close();
      console.log(
        language +
          ": shared date/weekday baseline, symmetric dot and localized slash icons verified.",
      );
    }
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
