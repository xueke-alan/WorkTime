"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({
        viewport: { width: 1480, height: 1100 },
        reducedMotion,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-19T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.locator("#agendaMode").click();
      for (const [title, start, end, note] of [
        ["Top", "2026-10-19", "2026-10-24", "Short"],
        ["Drag", "2026-10-19", "2026-10-21", "Source\nSecond"],
        ["Next top", "2026-10-26", "2026-10-29", "First\nSecond\nThird"],
        ["Next lower", "2026-10-26", "2026-10-28", "Lower\nSecond"],
      ]) {
        if (await page.locator("#agendaBack").isVisible())
          await page.locator("#agendaBack").click();
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill(title);
        await page.locator("#agendaScheduleOpen").click();
        await setScheduleRange(page, start, end);
        await page.locator("[data-schedule-close]").click();
        await page.locator("#agendaNote").fill(note);
        await page.locator("#agendaSave").click();
        await page.waitForFunction(
          () => !document.querySelector("#agendaFields").disabled,
        );
      }
      await page
        .locator('#calendar > .day[data-date="2026-10-19"] .day-select')
        .click({ position: { x: 8, y: 8 } });
      for (let i = 0; i < 3; i++) {
        await page.locator("#agendaViewToggle").click();
        await page.waitForTimeout(1000);
      }
      const chips = (title) =>
        page.locator(".agenda-week-lane .agenda-chip").filter({
          has: page.locator(".agenda-chip-title-text", {
            hasText: new RegExp("^" + title + "$"),
          }),
        });
      const drag = chips("Drag"),
        peer = chips("Next lower");
      const handle = await drag.locator(".agenda-resize-handle").boundingBox();
      const upper = await page
        .locator('#calendar > .day[data-date="2026-10-21"]')
        .boundingBox();
      const lower = await page
        .locator('#calendar > .day[data-date="2026-10-28"]')
        .boundingBox();
      const third = await page
        .locator(
          '#calendar > .day:is([data-date="2026-11-04"], [data-preview-date="2026-11-04"])',
        )
        .boundingBox();
      const x = upper.x + upper.width / 2;
      const move = (rect) => page.mouse.move(x, rect.y + 20);
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      await move(upper);
      await page.waitForTimeout(260);
      const beforeWidth = await page
        .locator('.agenda-resize-segment[data-preview-week="2026-10-19"]')
        .evaluate((e) => e.getBoundingClientRect().width);
      const beforePeer = (await peer.boundingBox()).y;
      await page.evaluate(() => {
        window.sameDateWidths = [];
        const sample = () => {
          const node = document.querySelector(".agenda-resize-segment");
          if (node)
            window.sameDateWidths.push(node.getBoundingClientRect().width);
          window.sameDateFrame = requestAnimationFrame(sample);
        };
        sample();
      });
      await page.mouse.up();
      await page.waitForFunction(
        () => !document.querySelector(".agenda-drag-preview"),
      );
      const sameDateWidths = await page.evaluate(() => {
        cancelAnimationFrame(window.sameDateFrame);
        return window.sameDateWidths;
      });
      const fullWidth = (await drag.boundingBox()).width;
      if (reducedMotion === "no-preference")
        assert.ok(
          sameDateWidths.some(
            (width) => width > beforeWidth + 1 && width < fullWidth - 1,
          ),
          "Unchanged end-date release smoothly rebounds to the full date width",
        );
      assert.equal(
        await drag.getAttribute("data-agenda-segment-end"),
        "2026-10-21",
      );
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      await move(upper);
      await page.waitForTimeout(260);

      await page.evaluate(() => {
        window.motionFrames = [];
        window.weekNodes = new Map();
        const sample = () => {
          const root = document.querySelector(".agenda-resize-preview");
          if (!root) return;
          window.motionFrames.push({
            opacity: getComputedStyle(root).opacity,
            peerTop: [
              ...document.querySelectorAll(".agenda-week-lane .agenda-chip"),
            ]
              .find(
                (e) =>
                  e.querySelector(".agenda-chip-title-text").textContent ===
                  "Next lower",
              )
              .getBoundingClientRect().top,
            parts: [...root.children].map((node) => {
              const rect = node.getBoundingClientRect(),
                style = getComputedStyle(node);
              window.weekNodes.set(node.dataset.previewWeek, node);
              return {
                week: node.dataset.previewWeek,
                stage: node.dataset.previewStage,
                alpha: Number(style.opacity),
                width: rect.width,
                left: rect.left,
                top: rect.top,
                height: rect.height,
                transform: style.transform,
                clipTop: parseFloat(
                  style.clipPath.match(/inset\(([-\d.]+)/)?.[1] || "0",
                ),
              };
            }),
          });
        };
        const frame = () => {
          sample();
          window.motionFrame = requestAnimationFrame(frame);
        };
        sample();
        window.motionFrame = requestAnimationFrame(frame);
      });
      await move(lower);
      await page.waitForTimeout(300);
      const firstFrames = await page.evaluate(() => window.motionFrames);
      const active = firstFrames
        .at(-1)
        .parts.filter((p) => p.stage === "active");
      assert.equal(active.length, 2);
      assert.ok(firstFrames.every((f) => f.opacity === "1"));
      assert.ok(active[0].width > beforeWidth + 200);
      assert.equal(active[1].alpha, 1);
      assert.ok(
        firstFrames.every((frame) =>
          frame.parts.every((part) => part.clipTop === 0),
        ),
        "Unscrolled preview top edges are never prematurely clipped during movement",
      );
      const laneBases = await page
        .locator(".agenda-week-lane")
        .evaluateAll((es) =>
          es.map((e) => e.getBoundingClientRect().top - e.scrollTop),
        );
      assert.ok(
        active[0].top - laneBases[0] > 20,
        "The source week retains its existing row during resizing",
      );
      assert.ok(
        Math.abs(
          active[1].top -
            ((await peer.boundingBox()).y +
              (await peer.boundingBox()).height +
              3),
        ) < 0.2,
        "New weeks append the preview directly after existing rows without gaps",
      );
      assert.ok(
        Math.abs((await peer.boundingBox()).y - beforePeer) < 0.2,
        "Existing schedules retain their positions while dragging into a week",
      );
      assert.ok(
        firstFrames.every((frame) =>
          frame.parts
            .filter((part) => part.week === "2026-10-19")
            .every((part) => Math.abs(part.top - active[0].top) < 0.2),
        ),
        "Extending into another week never changes the source week's row",
      );
      const overlap = await page.evaluate(() => {
        const preview = document.querySelector(
          '.agenda-resize-segment[data-preview-week="2026-10-26"]',
        );
        const a = preview.getBoundingClientRect();
        return [
          ...document.querySelectorAll(
            '.agenda-week-lane[data-dates^="2026-10-26"] .agenda-chip:not(.agenda-drag-source)',
          ),
        ].some((e) => {
          const b = e.getBoundingClientRect();
          return (
            a.top < b.bottom - 0.2 &&
            a.bottom > b.top + 0.2 &&
            a.left < b.right &&
            a.right > b.left
          );
        });
      });
      assert.equal(
        overlap,
        false,
        "Inserted preview occupies a reserved row rather than covering another event",
      );
      if (reducedMotion === "no-preference") {
        assert.ok(
          firstFrames.every(
            (frame) => Math.abs(frame.peerTop - beforePeer) < 0.2,
          ),
          "Existing events do not start sorting before release",
        );
        assert.ok(
          firstFrames.every((frame) =>
            frame.parts.every((part) => part.transform === "none"),
          ),
          "Preview growth never stretches text or icons",
        );
        assert.ok(
          firstFrames.some((f) =>
            f.parts.some(
              (p) => p.week === "2026-10-26" && p.alpha > 0 && p.alpha < 1,
            ),
          ),
          "New week fades in",
        );
        assert.ok(
          firstFrames.some((f) =>
            f.parts.some(
              (p) =>
                p.week === "2026-10-19" &&
                p.width > beforeWidth + 1 &&
                p.width < active[0].width - 1,
            ),
          ),
          "Previous week fills gradually",
        );
        const firstLeft = firstFrames[0].parts[0].left;
        assert.ok(
          firstFrames.every((f) => Math.abs(f.parts[0].left - firstLeft) < 0.1),
        );
      }
      await page.evaluate(() => {
        window.motionFrames = [];
      });
      await move(upper);
      await page.waitForTimeout(240);
      const leaving = await page.evaluate(() => window.motionFrames);
      if (reducedMotion === "no-preference")
        assert.ok(
          leaving.some((f) =>
            f.parts.some(
              (p) =>
                p.week === "2026-10-26" &&
                p.stage === "exiting" &&
                p.alpha > 0 &&
                p.alpha < 1,
            ),
          ),
          "Removed week fades out",
        );
      assert.equal(
        await page
          .locator('.agenda-resize-segment[data-preview-week="2026-10-26"]')
          .count(),
        0,
      );
      await move(lower);
      await page.waitForTimeout(40);
      await move(upper);
      await page.waitForTimeout(40);
      await move(lower);
      await page.waitForTimeout(260);
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector(
              '.agenda-resize-segment[data-preview-week="2026-10-26"]',
            ) === window.weekNodes.get("2026-10-26"),
        ),
        "Reversals reuse the week node without stale removal callbacks",
      );
      await move(third);
      await page.waitForTimeout(260);
      assert.equal(
        await page
          .locator('.agenda-resize-segment[data-preview-stage="active"]')
          .count(),
        3,
      );
      const emptyWeekOffset = await page.evaluate(() => {
        const lane = document.querySelector(
          '.agenda-week-lane[data-dates^="2026-11-02"]',
        );
        const preview = document.querySelector(
          '.agenda-resize-segment[data-preview-week="2026-11-02"]',
        );
        return (
          preview.getBoundingClientRect().top -
          lane.getBoundingClientRect().top +
          lane.scrollTop
        );
      });
      assert.ok(
        Math.abs(emptyWeekOffset) < 0.2,
        "An empty third week starts at the top without inheriting earlier rows",
      );
      await move(lower);
      await page.waitForTimeout(260);
      assert.equal(
        await page
          .locator('.agenda-resize-segment[data-preview-stage="active"]')
          .count(),
        2,
      );
      if (reducedMotion === "no-preference") {
        fs.mkdirSync("artifacts", { recursive: true });
        await page
          .locator("#calendar")
          .screenshot({ path: "artifacts/agenda-preview-insertion.png" });
      }
      await move(third);
      await page.mouse.up();
      await page.waitForFunction(
        () => !document.querySelector(".agenda-drag-preview"),
      );
      await page.waitForTimeout(320);
      await page.evaluate(() => cancelAnimationFrame(window.motionFrame));
      assert.equal(
        await chips("Drag").last().getAttribute("data-agenda-segment-end"),
        "2026-11-04",
      );
      assert.equal(await page.locator(".agenda-preview-peer").count(), 0);
      const newHandle = await chips("Drag")
        .last()
        .locator(".agenda-resize-handle")
        .boundingBox();
      await page.mouse.move(
        newHandle.x + newHandle.width / 2,
        newHandle.y + newHandle.height / 2,
      );
      await page.mouse.down();
      await move(upper);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      assert.equal(
        await page.locator(".agenda-drag-preview,.agenda-preview-peer").count(),
        0,
      );
      assert.equal(
        await chips("Drag").last().getAttribute("data-agenda-segment-end"),
        "2026-11-04",
      );
      assert.deepEqual(errors, []);
      console.log(
        "Cross-week entry/exit, reversible fill, independently packed weeks, animated insertion, multi-week release and cancellation verified: " +
          reducedMotion,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
