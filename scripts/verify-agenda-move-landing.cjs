"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setRange = require("./lib/agenda-test-range.cjs");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const weeks of [0, 3]) {
      for (const reducedMotion of ["no-preference", "reduce"]) {
        const page = await browser.newPage({
          viewport: { width: 1480, height: 1100 },
          reducedMotion,
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route(/^https?:/, (r) => r.abort());
        await page.clock.setFixedTime(new Date("2026-10-19T04:00:00Z"));
        await page.goto(
          pathToFileURL(path.resolve(process.argv[2] || ".", "index.html"))
            .href,
        );
        await page.waitForFunction(
          () => document.documentElement.dataset.appState === "ready",
        );
        await page.locator("#agendaMode").click();
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill("Move continuously");
        await page.locator("#agendaScheduleOpen").click();
        await setRange(page, "2026-10-19", "2026-10-20");
        await page.locator("[data-schedule-close]").click();
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
        if (weeks)
          for (let i = 0; i < 3; i++) {
            await page.locator("#agendaViewToggle").click();
            await page.waitForTimeout(400);
          }
        await page.waitForTimeout(600);
        const source = await page
          .locator(".agenda-week-lane .agenda-chip")
          .first()
          .boundingBox();
        const target = await page
          .locator('#calendar > .day[data-date="2026-10-26"]')
          .boundingBox();
        await page.mouse.move(source.x + 20, source.y + 10);
        await page.mouse.down();
        await page.mouse.move(target.x + target.width / 2, target.y + 150, {
          steps: 10,
        });
        await page.waitForSelector(".agenda-drag-preview");
        // Pointer updates are batched to animation frames. Sample the final
        // pointer position rather than an intermediate mouse.move step.
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await page.evaluate(() => {
          const ghost = document.querySelector(".agenda-drag-preview");
          window.moveGhost = ghost;
          window.releaseRect = ghost.getBoundingClientRect().toJSON();
          window.landingFrames = [];
          const sample = () => {
            if (!ghost.isConnected) return;
            const targets = [
              ...document.querySelectorAll(".agenda-drag-source"),
            ];
            window.landingFrames.push({
              x: ghost.getBoundingClientRect().x,
              y: ghost.getBoundingClientRect().y,
              opacity: getComputedStyle(ghost).opacity,
              fromTop: ghost.getAnimations()[0]?.effect.getKeyframes()[0].top,
              hiddenTargets: targets.every(
                (n) => Number(getComputedStyle(n).opacity) === 0,
              ),
              dropping: document.body.classList.contains("agenda-is-dropping"),
              datePulse:
                document.querySelector("#calendar > .day.motion-selection") !==
                null,
              dropMarks:
                document.querySelector(
                  ".agenda-drop-target, .agenda-drop-range",
                ) !== null,
            });
            requestAnimationFrame(sample);
          };
          sample();
        });
        await page.mouse.up();
        await page.waitForFunction(
          () => !document.querySelector(".agenda-drag-preview"),
        );
        const final = await page
          .locator(".agenda-week-lane .agenda-chip")
          .first()
          .boundingBox();
        const capture = await page.evaluate(() => ({
          start: window.releaseRect,
          frames: window.landingFrames,
          connected: window.moveGhost.isConnected,
        }));
        if (reducedMotion === "no-preference") {
          const frames = capture.frames.filter((f) => f.dropping);
          assert.ok(
            frames.length > 3,
            "The release continues on the existing ghost surface",
          );
          assert.ok(
            frames.every((f) => f.hiddenTargets),
            "No independent destination card is painted during landing",
          );
          assert.ok(
            frames.every((frame) => !frame.datePulse && !frame.dropMarks),
            "Release never flashes a date selection or retains drop highlights",
          );
          assert.ok(
            frames.every((f) => Number(f.opacity) === 0.9),
            "Landing does not replay a fade-out/fade-in",
          );
          assert.ok(
            frames.some(
              (frame) =>
                Math.abs(parseFloat(frame.fromTop) - capture.start.y) < 0.2,
            ),
            "Landing begins at the actual pointer-release position: " +
              JSON.stringify({
                start: capture.start,
                frames: frames.slice(0, 4),
              }),
          );
          assert.ok(
            frames.some(
              (f) =>
                Math.abs(f.y - capture.start.y) > 5 &&
                Math.abs(f.y - final.y) > 5,
            ),
            "The same card travels through intermediate positions",
          );
          assert.ok(
            Math.abs(frames.at(-1).y - final.y) < 2,
            "Landing meets the destination before handoff",
          );
        }
        assert.equal(capture.connected, false);
        assert.equal(
          await page
            .locator(".agenda-drag-source,body.agenda-is-dropping")
            .count(),
          0,
        );
        assert.equal(
          await page
            .locator(".agenda-week-lane .agenda-chip")
            .first()
            .getAttribute("data-agenda-segment-start"),
          "2026-10-26",
        );
        assert.deepEqual(errors, []);
        console.log(
          `Release-position landing, single-surface handoff and cleanup verified: ${weeks || "month"}, ${reducedMotion}`,
        );
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
