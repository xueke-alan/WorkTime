"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const deviceScaleFactor of [1, 1.25, 2]) {
      const page = await browser.newPage({
        viewport: { width: 1480, height: 1000 },
        deviceScaleFactor,
        reducedMotion: "reduce",
      });
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
      for (const width of [1480, 1000, 540]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const metrics = await page
          .locator(".timetable-break")
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const style = getComputedStyle(node);
              const rules = [
                ...node.parentElement.querySelectorAll(".timetable-rule"),
              ].filter(
                (rule) =>
                  rule.dataset.minute === node.dataset.axisStart ||
                  rule.dataset.minute === node.dataset.axisEnd,
              );
              return {
                top: style.borderTopWidth,
                bottom: style.borderBottomWidth,
                topColor: style.borderTopColor,
                bottomColor: style.borderBottomColor,
                height: node.getBoundingClientRect().height,
                expectedHeight: parseFloat(node.style.height),
                rules: rules.map(
                  (rule) => getComputedStyle(rule).borderTopWidth,
                ),
              };
            }),
          );
        assert.ok(metrics.length > 0);
        for (const metric of metrics) {
          assert.equal(metric.top, "1px");
          assert.equal(metric.bottom, "1px");
          assert.equal(metric.topColor, metric.bottomColor);
          assert.ok(
            Math.abs(metric.height - metric.expectedHeight) < 0.1,
            "Borders fit inside the mapped break height",
          );
          assert.deepEqual(
            metric.rules,
            ["0px", "0px"],
            "Grid markers do not double-paint the break edges",
          );
        }
      }
      await page.close();
    }
    console.log(
      "Compressed break edges verified: single equal strokes, correct height, narrow layouts and 1x/1.25x/2x rendering.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
