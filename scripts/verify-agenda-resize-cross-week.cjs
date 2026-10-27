"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setScheduleRange = require("./lib/agenda-test-range.cjs");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
    });
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-19T04:00:00Z"));
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.locator("#agendaMode").click();
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("Cross-week preview");
    await page.locator("#agendaScheduleOpen").click();
    await setScheduleRange(page, "2026-10-19", "2026-10-21");
    await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.waitForTimeout(400);
    const chip = page.locator(".agenda-week-lane .agenda-chip").first();
    const handle = await chip.locator(".agenda-resize-handle").boundingBox();
    const upper = await page
      .locator('#calendar > .day[data-date="2026-10-21"]')
      .boundingBox();
    const lower = await page
      .locator('#calendar > .day[data-date="2026-10-28"]')
      .boundingBox();
    const x = upper.x + upper.width / 2;
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(x, upper.y + upper.height - 4, { steps: 10 });
    await page.evaluate(() => {
      window.previewWeekNodes = new Map();
    });
    const samples = [];
    for (let pass = 0; pass < 3; pass++) {
      const start = upper.y + upper.height - 3,
        end = lower.y + 3;
      const positions = [];
      for (let y = start; y <= end; y += 1) positions.push(y);
      if (pass % 2) positions.reverse();
      for (const y of positions) {
        await page.mouse.move(x, y);
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(resolve)),
        );
        samples.push(
          await page.evaluate(() => {
            const p = document.querySelector(".agenda-resize-preview");
            const stable = [...p.children].every((node) => {
              const previous = window.previewWeekNodes.get(
                node.dataset.previewWeek,
              );
              window.previewWeekNodes.set(node.dataset.previewWeek, node);
              return !previous || previous === node;
            });
            return {
              stable,
              invalid: p.classList.contains("is-invalid"),
              opacity: getComputedStyle(p).opacity,
              count: p.children.length,
              hint: document.querySelector(".agenda-drag-hint").textContent,
            };
          }),
        );
      }
    }
    assert.ok(
      samples.every((s) => !s.invalid && s.opacity === "1" && s.stable),
      "Crossing a week gutter must not dim the preview or report an invalid date",
    );
    await page.mouse.move(0, 0);
    await page.waitForFunction(() =>
      document
        .querySelector(".agenda-resize-preview")
        .classList.contains("is-invalid"),
    );
    await page.mouse.move(x, lower.y + 4);
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".agenda-resize-preview")
          .classList.contains("is-invalid"),
    );
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    assert.equal(
      await chip.getAttribute("data-agenda-segment-end"),
      "2026-10-21",
    );
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    const gapY = (upper.y + upper.height) * 0.25 + lower.y * 0.75;
    await page.mouse.move(x, gapY, { steps: 10 });
    await page.waitForFunction(() =>
      document
        .querySelector(".agenda-drag-hint")
        ?.textContent.includes("2026/10/28"),
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.querySelector(".agenda-drag-preview"),
    );
    assert.equal(
      await page
        .locator(".agenda-week-lane .agenda-chip")
        .last()
        .getAttribute("data-agenda-segment-end"),
      "2026-10-28",
      "Gutter release commits the date shown by the preview",
    );
    for (const status of ["pending", "in-progress", "completed", "cancelled"]) {
      const segments = page.locator(".agenda-week-lane .agenda-chip");
      await segments.last().click();
      await page.locator("#agendaItemStatus").selectOption(status);
      await page.locator("#agendaSave").click();
      await page.waitForFunction(
        () => !document.querySelector("#agendaFields").disabled,
      );
      const sourceLeft = (await segments.first().boundingBox()).x;
      const expected = await segments
        .first()
        .locator(".agenda-chip-status")
        .evaluate((node) => {
          const style = getComputedStyle(node);
          return { border: style.borderColor, fill: style.backgroundColor };
        });
      const endHandle = await segments
        .last()
        .locator(".agenda-resize-handle")
        .boundingBox();
      await page.mouse.move(
        endHandle.x + endHandle.width / 2,
        endHandle.y + endHandle.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        endHandle.x + 18,
        endHandle.y + endHandle.height / 2,
        { steps: 5 },
      );
      await page.waitForFunction(
        () => !!document.querySelector(".agenda-resize-segment"),
      );
      const preview = await page
        .locator(".agenda-resize-segment")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const circle = node.querySelector(".agenda-chip-status");
            const style = getComputedStyle(circle),
              bounds = circle.getBoundingClientRect(),
              card = node.getBoundingClientRect();
            return {
              left: card.left,
              status: circle.dataset.status,
              border: style.borderColor,
              fill: style.backgroundColor,
              borderWidth: style.borderWidth,
              borderStyle: style.borderStyle,
              fits:
                bounds.left >= card.left &&
                bounds.right <= card.right &&
                bounds.top >= card.top &&
                bounds.bottom <= card.bottom,
            };
          }),
        );
      assert.ok(
        Math.abs(preview[0].left - sourceLeft) < 0.1,
        "Resize preview starts at the exact live left edge",
      );
      for (const circle of preview) {
        assert.equal(circle.status, status);
        assert.equal(circle.border, expected.border);
        assert.equal(circle.fill, expected.fill);
        assert.equal(circle.borderWidth, "2px");
        assert.equal(circle.borderStyle, "solid");
        assert.ok(
          circle.fits,
          "Status circle stays inside each preview segment",
        );
      }
      await page.keyboard.press("Escape");
      await page.mouse.up();
      assert.ok(
        Math.abs((await segments.first().boundingBox()).x - sourceLeft) < 0.1,
      );
    }
    console.log(
      "Cross-week gutter pixels remain valid and opaque; week nodes are reused; outside-grid rejection, gutter-release commits and valid cross-week saves verified",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
