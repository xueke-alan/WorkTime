"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const range = require("./lib/agenda-test-range.cjs");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1200 },
      reducedMotion: "reduce",
    });
    await page.route(/^https?:/, (r) => r.abort());
    await page.clock.setFixedTime(new Date("2026-10-19T04:00:00Z"));
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.locator("#agendaMode").click();
    const long = "很长的日程标题".repeat(20);
    async function create(title, start, end) {
      if (await page.locator("#agendaBack").isVisible())
        await page.locator("#agendaBack").click();
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title.slice(0, 120));
      await page.locator("#agendaScheduleOpen").click();
      await range(page, start, end);
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.waitForFunction(
        () => !document.querySelector("#agendaFields").disabled,
      );
    }
    await create("Before", "2026-10-19", "2026-10-19");
    await create(long, "2026-10-21", "2026-10-23");
    await create("111", "2026-10-22", "2026-10-22");
    const source = page.locator(".agenda-week-lane .agenda-chip").filter({
      has: page.locator(".agenda-chip-title-text", {
        hasText: "很长的日程标题",
      }),
    });
    const peer = page.locator(".agenda-week-lane .agenda-chip").filter({
      has: page.locator(".agenda-chip-title-text", { hasText: /^111$/ }),
    });
    async function begin() {
      const handle = await source
        .locator(".agenda-resize-handle")
        .boundingBox();
      const card = await page
        .locator('#calendar > .day[data-date="2026-10-23"]')
        .boundingBox();
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        card.x + card.width / 2,
        handle.y + handle.height / 2,
        { steps: 5 },
      );
      await page.waitForFunction(
        () => !!document.querySelector(".agenda-resize-segment"),
      );
    }
    const originalBounds = await source.boundingBox();
    const initialHandle = await source
      .locator(".agenda-resize-handle")
      .boundingBox();
    const grabX = initialHandle.x + initialHandle.width / 2,
      grabY = initialHandle.y + initialHandle.height / 2;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    for (const delta of [7, 10, 14]) {
      await page.mouse.move(grabX + delta, grabY);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      const preview = await page
        .locator(".agenda-resize-segment")
        .first()
        .boundingBox();
      assert.ok(
        Math.abs(
          preview.x +
            preview.width -
            (originalBounds.x + originalBounds.width + delta),
        ) < 0.2,
        "Right-drag starts from the actual edge without adding the handle grab offset",
      );
    }
    await page.keyboard.press("Escape");
    await page.mouse.up();
    const before = (await peer.boundingBox()).y;
    await begin();
    // A held pointer with settled tracks must not keep measuring every frame.
    await page.waitForTimeout(450);
    await page.evaluate(() => {
      window.idlePreviewReads = 0;
      window.previewRectOriginal = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (...args) {
        if (this.classList.contains("agenda-resize-segment"))
          window.idlePreviewReads++;
        return window.previewRectOriginal.apply(this, args);
      };
    });
    await page.waitForTimeout(150);
    const idleReads = await page.evaluate(() => {
      Element.prototype.getBoundingClientRect = window.previewRectOriginal;
      return window.idlePreviewReads;
    });
    assert.equal(
      idleReads,
      0,
      "Stationary resize previews stop layout polling",
    );
    assert.ok(
      Math.abs((await peer.boundingBox()).y - before) < 0.2,
      "111 keeps its existing row when no new collision occurs",
    );
    const sweepPoints = [];
    const firstCell = await page
      .locator('#calendar > .day[data-date="2026-10-21"]')
      .boundingBox();
    for (let x = grabX - 8; x >= firstCell.x - 10; x -= 8) sweepPoints.push(x);
    const sweepReference = new Map();
    for (let pass = 0; pass < 3; pass++) {
      const points = pass === 1 ? [...sweepPoints].reverse() : sweepPoints;
      let previousWidth;
      for (const x of points) {
        await page.mouse.move(x, grabY);
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(resolve)),
        );
        const frame = await page
          .locator(".agenda-resize-segment")
          .first()
          .evaluate((e) => {
            const b = e.getBoundingClientRect();
            return {
              left: b.left,
              top: b.top,
              width: b.width,
              height: b.height,
              opacity: getComputedStyle(e.parentElement).opacity,
            };
          });
        assert.equal(frame.opacity, "1");
        if (pass === 0) sweepReference.set(x, frame);
        else
          assert.deepEqual(
            frame,
            sweepReference.get(x),
            "Identical pointer positions have identical geometry regardless of drag direction",
          );
        if (previousWidth !== undefined && pass !== 1)
          assert.ok(
            frame.width <= previousWidth + 0.05,
            "Full leftward drag never rebounds across date boundaries",
          );
        previousWidth = frame.width;
      }
    }
    const endCell = await page
      .locator('#calendar > .day[data-date="2026-10-23"]')
      .boundingBox();
    await page.mouse.move(endCell.x + endCell.width / 2, grabY);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    const title = await page
      .locator(".agenda-resize-segment .agenda-chip-title-text")
      .evaluate((e) => {
        const card = document.querySelector(
          '#calendar > .day[data-date="2026-10-21"]',
        );
        return {
          right: e.getBoundingClientRect().right,
          limit:
            card.getBoundingClientRect().right -
            parseFloat(getComputedStyle(card).paddingRight),
          ellipsis: getComputedStyle(e).textOverflow,
          clipped: e.scrollWidth > e.clientWidth,
        };
      });
    assert.ok(title.right <= title.limit + 0.2);
    assert.equal(title.ellipsis, "ellipsis");
    assert.ok(title.clipped);
    const firstDate = await page
      .locator('#calendar > .day[data-date="2026-10-21"]')
      .boundingBox();
    const previousDate = await page
      .locator('#calendar > .day[data-date="2026-10-20"]')
      .boundingBox();
    const minimumRight = await page
      .locator('#calendar > .day[data-date="2026-10-21"]')
      .evaluate(
        (e) =>
          e.getBoundingClientRect().right -
          e.clientLeft -
          parseFloat(getComputedStyle(e).paddingRight),
      );
    for (const x of [
      firstDate.x + 1,
      previousDate.x + previousDate.width / 2,
    ]) {
      await page.mouse.move(x, firstDate.y + 20, { steps: 5 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      const bounds = await page
        .locator(".agenda-resize-segment")
        .first()
        .boundingBox();
      assert.ok(
        bounds.x + bounds.width >= minimumRight - 0.1,
        "Resize preview cannot shrink below one complete date slot",
      );
      assert.ok(
        await page
          .locator(".agenda-resize-preview")
          .evaluate(
            (e) =>
              !e.classList.contains("is-invalid") &&
              getComputedStyle(e).opacity === "1",
          ),
        "Minimum-width preview remains opaque when the pointer crosses the start-date boundary",
      );
    }

    const minimumFrames = [];
    const boundary = firstDate.x;
    for (const x of [
      boundary + 2,
      boundary - 2,
      boundary - 12,
      boundary + 1,
      boundary - 1,
      previousDate.x + previousDate.width / 2,
    ]) {
      await page.mouse.move(x, firstDate.y + 20);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      minimumFrames.push(
        await page.locator(".agenda-resize-preview").evaluate((root) => {
          const node = root.querySelector(".agenda-resize-segment"),
            bounds = node.getBoundingClientRect();
          return {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            opacity: getComputedStyle(root).opacity,
            invalid: root.classList.contains("is-invalid"),
            hint: document.querySelector(".agenda-drag-hint").textContent,
          };
        }),
      );
    }
    for (const frame of minimumFrames)
      assert.deepEqual(
        frame,
        minimumFrames[0],
        "Left-limit pointer noise cannot shake, recolor or change the minimum preview",
      );
    const sourceGrabOffset = grabX - (originalBounds.x + originalBounds.width);
    const leftSweep = [];
    for (let extra = 7; extra >= 1; extra -= 0.25) {
      await page.mouse.move(
        minimumRight + sourceGrabOffset + extra,
        firstDate.y + 20,
      );
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      leftSweep.push(
        (await page.locator(".agenda-resize-segment").first().boundingBox())
          .width,
      );
    }
    for (let i = 1; i < leftSweep.length; i++) {
      assert.ok(
        leftSweep[i] <= leftSweep[i - 1] + 0.05,
        "A leftward sweep cannot rebound to a larger width",
      );
      assert.ok(
        leftSweep[i - 1] - leftSweep[i] < 0.75,
        "Quarter-pixel leftward movement cannot trigger a multi-pixel latch jump",
      );
    }
    const edgeWidths = [];
    for (const x of [
      minimumRight + sourceGrabOffset - 1,
      minimumRight + sourceGrabOffset + 1,
      minimumRight + sourceGrabOffset + 2,
      minimumRight + sourceGrabOffset - 0.5,
      minimumRight + sourceGrabOffset + 1.5,
    ]) {
      await page.mouse.move(x, firstDate.y + 20);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      edgeWidths.push(
        (await page.locator(".agenda-resize-segment").first().boundingBox())
          .width,
      );
    }
    assert.ok(
      Math.max(...edgeWidths) - Math.min(...edgeWidths) < 0.1,
      "Subpixel noise around the minimum-width edge must not resize the preview or move its circle",
    );
    await page.mouse.move(minimumRight + 14, firstDate.y + 20);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    const resumed = await page
      .locator(".agenda-resize-segment")
      .first()
      .boundingBox();
    assert.ok(
      resumed.width > edgeWidths[0] + 4,
      "An intentional rightward drag resumes normal width tracking",
    );
    await page.mouse.move(
      previousDate.x + previousDate.width / 2,
      firstDate.y + 20,
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.querySelector(".agenda-drag-preview"),
    );
    assert.equal(
      await source.getAttribute("data-agenda-segment-end"),
      "2026-10-23",
      "An invalid release still preserves the original schedule",
    );
    for (let i = 0; i < 4; i++)
      await create("Extra " + i, "2026-10-22", "2026-10-22");
    await page.setViewportSize({ width: 1480, height: 860 });
    // ResizeObserver schedules lane fitting on the next animation frame.
    // Capture the resized layout, rather than the previous viewport's visibility.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const original = await page
      .locator(".agenda-week-lane .agenda-chip")
      .evaluateAll((es) =>
        es.map((e) => ({ id: e.dataset.agendaEdit, hidden: e.hidden })),
      );
    await begin();
    const overflow = await page.evaluate(() => {
      const preview = document.querySelector(".agenda-resize-segment"),
        week = document.querySelector(
          '.agenda-week-lane[data-dates^="2026-10-19"]',
        ),
        label = week.querySelector(
          '.agenda-preview-more[data-preview-date="2026-10-22"]',
        );
      const visible = [
        ...week.querySelectorAll(".agenda-chip:not(.agenda-drag-source)"),
      ].filter(
        (e) =>
          !e.hidden &&
          e.dataset.agendaSegmentStart <= "2026-10-22" &&
          e.dataset.agendaSegmentEnd >= "2026-10-22",
      );
      const bounds = preview.getBoundingClientRect();
      const topInset = parseFloat(
        getComputedStyle(preview).clipPath.match(/inset\(([-\d.]+)/)[1],
      );
      return {
        label: label?.textContent,
        count: 5 - visible.length,
        topInset,
        expected: Math.max(0, week.getBoundingClientRect().top - bounds.top),
        fullyVisible: visible.every(
          (e) =>
            e.getBoundingClientRect().bottom <=
            week.getBoundingClientRect().bottom - 19 + 0.2,
        ),
        oldHidden: [
          ...week.querySelectorAll(
            ":scope > .agenda-more:not(.agenda-preview-more)",
          ),
        ].every((e) => getComputedStyle(e).visibility === "hidden"),
      };
    });
    assert.equal(overflow.label, overflow.count + "+");
    assert.ok(Math.abs(overflow.topInset - overflow.expected) < 0.01);
    assert.equal(
      overflow.topInset,
      0,
      "An unscrolled preview keeps its complete top edge",
    );
    assert.ok(overflow.fullyVisible);
    assert.ok(overflow.oldHidden);
    fs.mkdirSync("artifacts", { recursive: true });
    await page
      .locator("#calendar")
      .screenshot({ path: "artifacts/agenda-preview-regressions.png" });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(
      await page
        .locator(".agenda-preview-more,.agenda-preview-more-hidden")
        .count(),
      0,
    );
    assert.deepEqual(
      await page
        .locator(".agenda-week-lane .agenda-chip")
        .evaluateAll((es) =>
          es.map((e) => ({ id: e.dataset.agendaEdit, hidden: e.hidden })),
        ),
      original,
    );
    console.log(
      "Unrelated existing lanes, first-date title ellipsis, actual-screen clipping, compact x+ counts, reserved footer space and cancellation restoration verified",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
