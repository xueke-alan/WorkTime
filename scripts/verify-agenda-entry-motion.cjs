"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const width of [1480, 1000, 390]) {
      for (const weeks of [1, 2]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          locale: "zh-CN",
          reducedMotion: "no-preference",
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route(/^https?:/, (route) => route.abort());
        await page.addInitScript((weeks) => {
          localStorage.setItem(
            "worktime.calendarView",
            JSON.stringify({ mode: "attendance", weeks }),
          );
        }, weeks);
        await page.goto(
          pathToFileURL(path.resolve(process.argv[2] || ".", "index.html"))
            .href,
        );
        await page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading"),
        );
        const settled = () =>
          page.waitForFunction(
            () =>
              !document.querySelector(".agenda-week-leaving") &&
              !document
                .querySelector("#calendar")
                .getAnimations({ subtree: true })
                .some(
                  (animation) =>
                    animation.effect?.target?.matches(
                      "#calendar,.day,.timetable-bottom-card",
                    ) &&
                    (animation.pending || animation.playState === "running"),
                ),
          );
        for (const entering of [true, false]) {
          const result = await page.evaluate(() => {
            const cards = [...document.querySelectorAll("#calendar > .day")];
            const before = new Map(
              cards.map((card) => [
                card.dataset.date || card.dataset.previewDate,
                card.getBoundingClientRect(),
              ]),
            );
            const animate = Element.prototype.animate;
            const bounds = Element.prototype.getBoundingClientRect;
            let geometryStarted = false;
            const lateMeasurements = [];
            Element.prototype.animate = function (...args) {
              if (this.matches("#calendar > .day,.agenda-week-lane"))
                geometryStarted = true;
              return animate.apply(this, args);
            };
            Element.prototype.getBoundingClientRect = function (...args) {
              if (geometryStarted && this.closest("#calendar"))
                lateMeasurements.push(this.className);
              return bounds.apply(this, args);
            };
            try {
              document.querySelector("#agendaMode").click();
            } finally {
              Element.prototype.animate = animate;
              Element.prototype.getBoundingClientRect = bounds;
            }
            const selected = document.querySelector("#calendar .day.selected");
            const animation = selected
              .getAnimations()
              .find((animation) =>
                animation.effect.getKeyframes().some((frame) => frame.height),
              );
            const timing = animation?.effect.getTiming();
            const frames = animation?.effect.getKeyframes();
            for (const animation of document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })) {
              animation.pause();
              animation.currentTime = 0;
            }
            const oldRect = before.get(
              selected.dataset.date || selected.dataset.previewDate,
            );
            const rect = selected.getBoundingClientRect();
            const leaving = document.querySelectorAll(".agenda-week-leaving");
            const result = {
              timing,
              frames,
              lateMeasurements,
              initial: [oldRect.x, oldRect.y, oldRect.width, oldRect.height],
              animated: [rect.x, rect.y, rect.width, rect.height],
              leaving: leaving.length,
              inert: [...leaving].every((card) => card.inert),
              returning: cards.filter((card) =>
                card.getAnimations().some((animation) => {
                  const frames = animation.effect.getKeyframes();
                  return (
                    frames[0].opacity === "0" && frames.at(-1).opacity !== "0"
                  );
                }),
              ).length,
            };
            for (const animation of document
              .querySelector("#calendar")
              .getAnimations({ subtree: true }))
              animation.finish();
            return result;
          });
          assert.equal(result.timing?.duration, 520);
          assert.deepEqual(
            result.lateMeasurements,
            [],
            "Calendar geometry is fully measured before animations start",
          );
          assert.equal(result.timing.easing, "cubic-bezier(0.22, 1, 0.36, 1)");
          assert.ok(
            Math.abs(parseFloat(result.frames[0].height) - result.initial[3]) <
              0.01,
          );
          if (entering) assert.ok(result.leaving > 0);
          else
            assert.ok(
              result.returning > 0,
              "Other month cards slide and fade back in",
            );
          assert.equal(result.inert, true);
          result.initial.forEach((value, index) =>
            assert.ok(
              Math.abs(value - result.animated[index]) < 1,
              `Switch preserves starting geometry: entering=${entering}, ${width}px, ${weeks} weeks, ${JSON.stringify(result)}`,
            ),
          );
          await settled();
          assert.equal(
            await page.locator("#calendar [data-agenda-week]").count(),
            entering ? weeks * 7 : 0,
          );
        }
        const reversal = await page.evaluate(() => {
          const calendar = document.querySelector("#calendar");
          const freeze = (time) => {
            for (const animation of calendar.getAnimations({ subtree: true })) {
              animation.pause();
              animation.currentTime = time;
            }
          };
          document.querySelector("#agendaMode").click();
          freeze(208);
          const before = calendar
            .querySelector(".day.selected")
            .getBoundingClientRect();
          document.querySelector("#agendaMode").click();
          freeze(0);
          const after = calendar
            .querySelector(".day.selected")
            .getBoundingClientRect();
          const delta = Math.max(
            ...["x", "y", "width", "height"].map((key) =>
              Math.abs(before[key] - after[key]),
            ),
          );
          for (const animation of calendar.getAnimations({ subtree: true }))
            animation.finish();
          return delta;
        });
        assert.ok(
          reversal < 1,
          "Reversal continues from the painted card without snapping to its previous endpoint",
        );
        await settled();
        // Interrupt both directions before the first frame.
        await page.evaluate(() => {
          document.querySelector("#agendaMode").click();
          document.querySelector("#agendaMode").click();
          document.querySelector("#agendaMode").click();
          document.querySelector("#agendaMode").click();
        });
        await settled();
        assert.equal(await page.locator("#calendar > .day[inert]").count(), 0);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.locator("#agendaMode").click();
        await settled();
        assert.equal(
          await page.locator("#calendar [data-agenda-week]").count(),
          weeks * 7,
        );
        await page.locator("#agendaMode").click();
        await settled();
        assert.equal(
          await page.locator("#calendar [data-agenda-week]").count(),
          0,
        );
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
    console.log(
      "Attendance entry and return reuse week/fortnight card geometry and timing at desktop, compact and mobile widths; interruptions and reduced motion verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
