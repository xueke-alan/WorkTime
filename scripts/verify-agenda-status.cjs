"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [width, scale, zoom] of [
      [1920, 1, 1],
      [2560, 1, 1],
      [1920, 1.25, 1],
      [1920, 1.5, 1],
      [1920, 2, 1],
      [1920, 1, 1.25],
      [390, 1, 1],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height: 1200 },
        deviceScaleFactor: scale,
        reducedMotion: "reduce",
        locale: "zh-CN",
      });
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-18T04:00:00Z"));
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.locator("#agendaMode").click();
      for (const [title, start, end] of [
        ["跨周测试", "2026-10-14", "2026-10-22"],
        ["发DVD v", "2026-10-15", "2026-10-23"],
        ["单日事项", "2026-10-18", "2026-10-18"],
      ]) {
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill(title);
        await page.locator("#agendaScheduleOpen").click();
        await page.locator("#agendaDateInput").fill(start);
        if (end !== start) {
          await page.locator("#agendaMultiDay").check();
          await page.locator("#agendaEndDateInput").fill(end);
        }
        await page.locator("[data-schedule-close]").click();
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
      }
      await page.evaluate((zoom) => {
        document.body.style.zoom = String(zoom);
      }, zoom);
      for (const view of ["month", "week", "fortnight"]) {
        if (view !== "month") await page.locator("#agendaViewToggle").click();
        // Narrow month cards collapse these three items into the overflow count.
        // Their expanded week views expose the circles for alignment checks.
        if (width < 850 && view === "month") continue;
        await page.mouse.move(0, 0);
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const row = page.locator('.agenda-week-lane[data-dates^="2026-10-12"]');
        const metrics = await row.locator(".agenda-chip").evaluateAll((nodes) =>
          nodes
            .filter((node) => !node.hidden)
            .map((node) => {
              const circle = node
                  .querySelector(".agenda-chip-status")
                  .getBoundingClientRect(),
                box = node.getBoundingClientRect(),
                title = node
                  .querySelector(".agenda-chip-title")
                  .getBoundingClientRect();
              return {
                classes: node.className,
                right: box.right,
                border: getComputedStyle(node).borderRightWidth,
                cx: circle.x + circle.width / 2,
                cy: circle.y + circle.height / 2,
                titleCy: title.y + title.height / 2,
                circleWidth: circle.width,
              };
            }),
        );
        assert.equal(metrics.length, 3, `${width} ${scale} ${zoom} ${view}`);
        const centers = metrics.map((metric) => metric.cx);
        if (Math.max(...centers) - Math.min(...centers) > 0.1)
          console.log({ width, scale, zoom, view, metrics });
        assert.ok(
          Math.max(...centers) - Math.min(...centers) <= 0.1,
          `Status centers align: ${width} ${scale} ${zoom} ${view}`,
        );
        assert.ok(
          metrics.every(
            (metric) => Math.abs(metric.cy - metric.titleCy) <= 0.1,
          ),
          "Status stays vertically centered in heading",
        );
        if (width === 1920 && scale === 1 && zoom === 1)
          await page.screenshot({
            path: `artifacts/agenda-status-aligned-${view}.png`,
          });
      }
      await page.close();
    }
    console.log(
      "Status circle centers aligned across continuation/single-day chips, month/week/fortnight, desktop/mobile, display scales and layout zoom.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
