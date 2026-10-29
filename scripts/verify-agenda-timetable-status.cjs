"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setScheduleRange = require("./lib/agenda-test-range.cjs");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-29T04:00:00Z"));
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.locator("#agendaMode").click();
    await page.locator("#agendaViewToggle").click();
    const statuses = ["pending", "in-progress", "completed", "cancelled"];
    for (const [index, status] of statuses.entries()) {
      await page.locator("#agendaNew").click();
      await page
        .locator("#agendaTitle")
        .fill("状态圆圈与长标题显示测试".repeat(4));
      await page.locator("#agendaItemStatus").selectOption(status);
      await page.locator("#agendaScheduleOpen").click();
      await setScheduleRange(page, "2026-10-" + (26 + index));
      await page.locator("#agendaAllDay").uncheck();
      await page.locator("#agendaStart").fill("09:00");
      await page.locator("#agendaEnd").fill("10:00");
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
    }
    for (const width of [1480, 1000, 540]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const metrics = await page
        .locator(".timetable-event")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const status = node.querySelector(".agenda-chip-status");
            const circle = status.getBoundingClientRect();
            const card = node.getBoundingClientRect();
            const title = node
              .querySelector(".agenda-chip-title")
              .getBoundingClientRect();
            return {
              status: status.dataset.status,
              visible:
                circle.width >= 10 &&
                circle.height >= 10 &&
                circle.left >= card.left &&
                circle.right <= card.right &&
                circle.top >= card.top &&
                circle.bottom <= card.bottom &&
                circle.right <= title.right &&
                circle.left >= title.left,
              rightGap: card.right - circle.right,
              topGap: circle.top - card.top,
              border: getComputedStyle(status).borderTopWidth,
            };
          }),
        );
      assert.deepEqual(
        metrics.map((item) => item.status).sort(),
        [...statuses].sort(),
      );
      for (const metric of metrics) {
        assert.ok(
          metric.visible,
          `${width}px ${metric.status}: circle must fit inside its clipping containers`,
        );
        assert.ok(
          metric.rightGap >= 0 && metric.rightGap <= 8,
          "Circle stays at the right edge",
        );
        assert.ok(
          metric.topGap >= 0 && metric.topGap <= 12,
          "Circle stays in the title row",
        );
        assert.equal(metric.border, "2px");
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "Timetable status circles verified for all four states, long titles and desktop/narrow layouts.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
