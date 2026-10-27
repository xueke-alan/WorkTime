"use strict";
const setScheduleRange = require("./lib/agenda-test-range.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
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
        // Preserve the available layout height while testing CSS zoom. Otherwise
        // compact overflow hides fixtures before their status can be measured.
        viewport: { width, height: Math.round(1200 * zoom) },
        deviceScaleFactor: scale,
        reducedMotion: "reduce",
        locale: "zh-CN",
      });
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-18T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.locator("#agendaMode").click();
      for (const [title, start, end, status] of [
        ["跨周测试", "2026-10-14", "2026-10-22", "pending"],
        ["发DVD v", "2026-10-15", "2026-10-23", "completed"],
        ["单日事项", "2026-10-18", "2026-10-18", "in-progress"],
        ["取消事项", "2026-10-18", "2026-10-18", "cancelled"],
      ]) {
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill(title);
        await page.locator("#agendaItemStatus").selectOption(status);
        await page.locator("#agendaScheduleOpen").click();
        await setScheduleRange(page, start);
        if (end !== start) {
          await page.locator("#agendaEndDateInput").fill(end);
        }
        await page.locator("[data-schedule-close]").click();
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
      }
      await page.evaluate((zoom) => {
        document.body.style.zoom = String(zoom);
      }, zoom);
      for (const view of ["month", "week", "fortnight", "three-week"]) {
        if (view !== "month") await page.locator("#agendaViewToggle").click();
        // Month cards expose only what fits; weekly views expose every fixture.
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
                status: node.dataset.status,
                icons: node.querySelector(".agenda-chip-status")
                  .childElementCount,
                color: getComputedStyle(
                  node.querySelector(".agenda-chip-status"),
                ).backgroundColor,
                circleBorder: getComputedStyle(
                  node.querySelector(".agenda-chip-status"),
                ).borderTopColor,
                right: box.right,
                border: getComputedStyle(node).borderRightWidth,
                cx: circle.x + circle.width / 2,
                cy: circle.y + circle.height / 2,
                titleCy: title.y + title.height / 2,
                circleWidth: circle.width,
              };
            }),
        );
        assert.ok(
          metrics.length >= (view === "month" ? 1 : 4),
          `${width} ${scale} ${zoom} ${view}`,
        );
        assert.ok(metrics.every((metric) => metric.icons === 0));
        assert.equal(
          new Set(metrics.map((metric) => metric.color)).size,
          metrics.length,
        );
        assert.ok(
          metrics.every((metric) =>
            metric.status === "pending"
              ? metric.color === "rgba(0, 0, 0, 0)"
              : metric.color !== "rgba(0, 0, 0, 0)" &&
                metric.color !== metric.circleBorder,
          ),
        );
        for (const metric of metrics.filter(
          (metric) => metric.status !== "pending",
        )) {
          const fill = metric.color.match(/\d+/g).map(Number);
          const edge = metric.circleBorder.match(/\d+/g).map(Number);
          assert.ok(
            edge.every((channel, index) => channel < fill[index]),
            "Solid status edges stay darker than fills",
          );
        }
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
