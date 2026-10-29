"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setScheduleRange = require("./lib/agenda-test-range.cjs");
async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({
        viewport: { width: 1480, height: 1000 },
        reducedMotion,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-19T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.locator("#agendaMode").click();
      for (const [title, end] of [
        ["Short", "27"],
        ["Medium", "28"],
        ["Long", "29"],
      ]) {
        if (await page.locator("#agendaBack").isVisible())
          await page.locator("#agendaBack").click();
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill(title);
        await page.locator("#agendaScheduleOpen").click();
        await setScheduleRange(page, "2026-10-26", "2026-10-" + end);
        await page.locator("[data-schedule-close]").click();
        await page
          .locator("#agendaNote")
          .fill(title === "Medium" ? "A note\nAnother line" : "Note");
        await page.locator("#agendaSave").click();
        await page.waitForFunction(
          () => !document.querySelector("#agendaFields").disabled,
        );
      }
      // Month ribbons retain span-based sorting; packed multiweek rows retain creation order.
      await page.waitForTimeout(1000);
      const short = page.locator(".agenda-week-lane .agenda-chip").filter({
        has: page.locator(".agenda-chip-title-text", { hasText: "Short" }),
      });
      const rect = await short.locator(".agenda-resize-handle").boundingBox();
      const target = await page
        .locator('#calendar > .day[data-date="2026-10-30"]')
        .boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        target.x + target.width / 2,
        rect.y + rect.height / 2,
        { steps: 10 },
      );
      await page.waitForTimeout(80);
      await page.evaluate(() => {
        window.previewClassChanges = 0;
        window.previewSource = document.querySelector(".agenda-drag-source");
        window.previewSegment = document.querySelector(
          ".agenda-resize-segment",
        );
        window.previewObserver = new MutationObserver((records) => {
          window.previewClassChanges += records.length;
        });
        window.previewObserver.observe(window.previewSource, {
          attributes: true,
          attributeFilter: ["class"],
        });
      });
      const previewStyles = [];
      for (let step = 0; step < 8; step++) {
        await page.mouse.move(
          target.x + 16 + step * 8,
          rect.y + rect.height / 2 + (step % 2) * 12,
        );
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        previewStyles.push(
          await page.evaluate(() => {
            const node = document.querySelector(".agenda-resize-segment");
            const style = getComputedStyle(node),
              bounds = node.getBoundingClientRect();
            return {
              same: node === window.previewSegment,
              sourceOpacity: getComputedStyle(window.previewSource).opacity,
              opacity: style.opacity,
              parentOpacity: getComputedStyle(node.parentElement).opacity,
              transition: style.transitionProperty,
              background: style.backgroundColor,
              color: style.color,
              border: style.borderLeftColor,
              shadow: style.boxShadow,
              top: bounds.top,
              height: bounds.height,
              animating: node.getAnimations().length,
            };
          }),
        );
      }
      const steady = previewStyles[0];
      assert.ok(steady.same);
      assert.equal(steady.sourceOpacity, "0");
      assert.equal(steady.opacity, "1");
      assert.equal(steady.parentOpacity, "1");
      assert.equal(steady.transition, "none");
      assert.equal(steady.animating, 0);
      for (const style of previewStyles)
        assert.deepEqual(
          style,
          steady,
          "Preview appearance is stable while moving within one date",
        );
      assert.equal(
        await page.evaluate(() => {
          window.previewObserver.disconnect();
          return window.previewClassChanges;
        }),
        0,
        "Pointer updates do not toggle the source drag marker",
      );
      await page.evaluate(() => {
        const layer = document.querySelector(".agenda-week-layers");
        window.reorderFrames = [];
        const sample = () => {
          const chips = [...layer.querySelectorAll(".agenda-chip")].filter(
            (e) => !e.hidden,
          );
          const boxes = chips.map((e) => e.getBoundingClientRect());
          window.reorderFrames.push({
            order: chips
              .map(
                (e) => e.querySelector(".agenda-chip-title-text").textContent,
              )
              .join(","),
            opacity: Number(getComputedStyle(layer).opacity),
            ghost: !!document.querySelector(".agenda-drag-preview"),
            dateSelectionFlash: [
              ...document.querySelectorAll("#calendar > .day"),
            ].some((e) =>
              e
                .getAnimations()
                .some((a) => a.animationName === "motion-selection"),
            ),
            shortTop: chips
              .find(
                (e) =>
                  e.querySelector(".agenda-chip-title-text").textContent ===
                  "Short",
              )
              ?.getBoundingClientRect().top,
            moving: chips.filter((e) =>
              e.classList.contains("agenda-reorder-moving"),
            ).length,
            front: chips.some(
              (e) =>
                e.classList.contains("agenda-reorder-front") &&
                getComputedStyle(e).zIndex === "3",
            ),
            overlap: boxes.some((a, i) =>
              boxes.some(
                (b, j) =>
                  j > i &&
                  a.left < b.right &&
                  a.right > b.left &&
                  a.top < b.bottom - 0.5 &&
                  a.bottom > b.top + 0.5,
              ),
            ),
          });
        };
        sample();
        const frame = () => {
          sample();
          window.reorderFrame = requestAnimationFrame(frame);
        };
        window.reorderFrame = requestAnimationFrame(frame);
      });
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          !document.querySelector(".agenda-drag-preview") &&
          !document.body.classList.contains("agenda-is-dragging"),
      );
      await page.waitForTimeout(300);
      const frames = await page.evaluate(() => {
        cancelAnimationFrame(window.reorderFrame);
        return window.reorderFrames;
      });
      assert.equal(frames[0].order, "Long,Medium,Short");
      assert.equal(frames.at(-1).order, "Short,Long,Medium");
      assert.equal(frames.at(-1).opacity, 1);
      assert.ok(
        frames.every((frame) => !frame.dateSelectionFlash),
        "Resizing must never flash a background date-selection outline",
      );
      assert.ok(
        frames.every((frame) => frame.opacity === 1),
        "The lane layer never fades",
      );
      const changed = frames.findIndex(
        (frame) => frame.order !== frames[0].order,
      );
      assert.ok(changed > 0);
      assert.ok(
        frames.slice(changed).every((frame) => !frame.ghost),
        "Old drag preview is removed before reordering",
      );
      if (reducedMotion !== "reduce") {
        assert.ok(
          frames.some((frame) => frame.moving === 3 && frame.front),
          "All displaced strips move together with the resized item in front",
        );
        assert.ok(
          frames.every((frame) => !frame.overlap || frame.front),
          "Crossing strips have a single opaque foreground card: " +
            JSON.stringify(
              frames.filter((frame) => frame.overlap && !frame.front),
            ),
        );
        const movement = frames.slice(changed);
        assert.ok(frames[0].shortTop - movement.at(-1).shortTop > 40);
        for (let i = 1; i < movement.length; i++)
          assert.ok(
            movement[i].shortTop <= movement[i - 1].shortTop + 0.5,
            "Motion moves toward the final row without jumping backwards",
          );
      } else assert.ok(frames.every((frame) => frame.moving === 0));
      assert.equal(
        await page
          .locator(".agenda-reorder-moving,.agenda-reorder-front")
          .count(),
        0,
      );
      assert.equal(
        await short.getAttribute("data-agenda-segment-end"),
        "2026-10-30",
      );
      if (reducedMotion === "no-preference") {
        const handle = await short
          .locator(".agenda-resize-handle")
          .boundingBox();
        const earlier = await page
          .locator('#calendar > .day[data-date="2026-10-27"]')
          .boundingBox();
        await page.mouse.move(
          handle.x + handle.width / 2,
          handle.y + handle.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          earlier.x + earlier.width / 2,
          handle.y + handle.height / 2,
          { steps: 10 },
        );
        await page.mouse.up();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(350);
        assert.equal(
          await short.getAttribute("data-agenda-segment-end"),
          "2026-10-30",
        );
        assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
        assert.equal(
          await page
            .locator(".agenda-week-layers")
            .evaluate((e) => getComputedStyle(e).opacity),
          "1",
        );
        assert.equal(await page.locator("body.agenda-is-dragging").count(), 0);
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        "Resize synchronized movement, variable heights, opaque foreground, no fading/duplicate preview, persistence and cancellation verified: " +
          reducedMotion,
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
