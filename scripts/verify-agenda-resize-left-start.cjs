"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const range = require("./lib/agenda-test-range.cjs");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const findings = [];
    for (const width of [1480, 1440, 1920]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      await page.route(/^https?:/, (r) => r.abort());
      await page.clock.setFixedTime(new Date("2026-10-19T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.locator("#agendaMode").click();
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill("Left-start check");
      await page.locator("#agendaScheduleOpen").click();
      await range(page, "2026-10-21");
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.waitForTimeout(300);
      for (let view = 0; view < 4; view++) {
        if (view) {
          await page.locator("#agendaViewToggle").click();
          await page.waitForTimeout(1000);
        }
        const source = page.locator("#calendar .agenda-chip:visible").first();
        for (const selected of [false, true]) {
          if (selected) await source.click();
          else if (await page.locator("#agendaBack").isVisible())
            await page.locator("#agendaBack").click();
          const original = await source.boundingBox(),
            handle = await source
              .locator(".agenda-resize-handle")
              .boundingBox();
          const x = handle.x + handle.width / 2,
            y = handle.y + handle.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          const frames = [];
          for (const delta of [7, 10, 20]) {
            await page.mouse.move(x - delta, y);
            await page.evaluate(
              () => new Promise((resolve) => requestAnimationFrame(resolve)),
            );
            if (!(await page.locator(".agenda-resize-segment").count()))
              throw Error(
                JSON.stringify({
                  width,
                  view,
                  selected,
                  original,
                  handle,
                  delta,
                  status: await page.locator("#agendaStatus").textContent(),
                  hit: await page.evaluate(
                    ([x, y]) => document.elementFromPoint(x, y)?.outerHTML,
                    [x, y],
                  ),
                }),
              );
            frames.push(
              await page
                .locator(".agenda-resize-segment")
                .first()
                .boundingBox(),
            );
          }
          await page.mouse.up();
          await page.waitForFunction(
            () => !document.querySelector(".agenda-drag-preview"),
          );
          findings.push({
            width,
            view,
            selected,
            original: original.width,
            changes: frames.map((b) => ({
              width: b.width - original.width,
              left: b.x - original.x,
            })),
            restored: (await source.boundingBox()).width - original.width,
          });
        }
      }
      await page.close();
    }
    console.log(
      "Direct left-drag start, hold and release measured across 3 viewport widths, 4 views and both selection states",
    );
    assert.ok(
      findings.every((f) =>
        f.changes.every(
          (c) => Math.abs(c.width) < 0.04 && Math.abs(c.left) < 0.04,
        ),
      ),
      "A one-day left drag must not change the original strip width before or after release",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
