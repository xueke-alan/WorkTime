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
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-20T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.waitForTimeout(800);
      const settle = async () => {
        await page.evaluate(async () => {
          for (const element of document.querySelectorAll(
            "#calendar, .calendar-navigation-copy",
          ))
            for (const animation of element.getAnimations()) animation.finish();
          await new Promise(requestAnimationFrame);
        });
        assert.equal(
          await page.locator(".calendar-navigation-viewport").count(),
          0,
        );
        assert.equal(
          await page.locator(".calendar-navigation-copy").count(),
          0,
        );
        assert.equal(
          await page
            .locator("#calendar")
            .evaluate((element) => element.style.willChange),
          "",
          "Release compositing hints after navigation",
        );
      };
      let captured = false;
      const slide = async (id, sign, expected = true) => {
        const sample = await page.evaluate(
          ({ id }) => {
            window.scrollTo({ top: 0, behavior: "instant" });
            const weekdays = document.querySelector("#panelContent>.weekdays");
            const before = weekdays.getBoundingClientRect().top;
            const previousSelected = [
              ...document.querySelectorAll("#calendar>.day.selected"),
            ].find((card) => getComputedStyle(card).display !== "none");
            const previousSelection =
              previousSelected &&
              (previousSelected.dataset.date ||
                previousSelected.dataset.previewDate);
            const oldDays = new Map(
              [
                ...document.querySelectorAll(
                  "#calendar .day[data-agenda-week]",
                ),
              ].map((card) => [
                card.dataset.date || card.dataset.previewDate,
                card.getBoundingClientRect().top,
              ]),
            );
            const oldBounds = document
              .getElementById("calendar")
              .getBoundingClientRect();
            const wasHidden = getComputedStyle(weekdays).display === "none";
            (document.getElementById(id) || document.querySelector(id)).click();
            const live = document.getElementById("calendar");
            const copy = document.querySelector(".calendar-navigation-copy");
            if (!copy) return null;
            const pair = [copy, live];
            const frames = pair.map((element) =>
              element.getAnimations().map((animation) => {
                animation.pause();
                animation.currentTime = 160;
                return animation.effect.getKeyframes();
              }),
            );
            const rects = pair.map((element) => {
              const rect = element.getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom };
            });
            const shared = [
              ...live.querySelectorAll(".day[data-agenda-week]"),
            ].filter((card) =>
              oldDays.has(card.dataset.date || card.dataset.previewDate),
            );
            const sharedMotion = shared.map((card) => ({
              previous: oldDays.get(
                card.dataset.date || card.dataset.previewDate,
              ),
              current: card.getBoundingClientRect().top,
              resting:
                card.getBoundingClientRect().top -
                new DOMMatrix(getComputedStyle(live).transform).m42,
            }));
            const oldCards = [
              ...copy.querySelectorAll(".day[data-agenda-week]"),
            ];
            const rowStride =
              oldCards.length > 7
                ? oldCards[7].getBoundingClientRect().top -
                  oldCards[0].getBoundingClientRect().top
                : 0;
            const ids = [...document.querySelectorAll("[id]")].map(
              (element) => element.id,
            );
            return {
              frames,
              rects,
              timing: live.getAnimations()[0].effect.getTiming(),
              weekView: live.classList.contains("agenda-week-view"),
              previousSelection,
              visibleDates: [...live.querySelectorAll(":scope>.day")]
                .filter((card) => getComputedStyle(card).display !== "none")
                .map((card) => card.dataset.date || card.dataset.previewDate),
              selectedDates: [...live.querySelectorAll(":scope>.day.selected")]
                .filter((card) => getComputedStyle(card).display !== "none")
                .map((card) => card.dataset.date || card.dataset.previewDate),
              sharedMotion,
              rowStride,
              oldHeight: oldBounds.height,
              clipped: copy.style.clipPath,
              rows: oldDays.size / 7,
              opacity: pair.map((element) => getComputedStyle(element).opacity),
              stationary:
                wasHidden ||
                getComputedStyle(weekdays).display === "none" ||
                Math.abs(before - weekdays.getBoundingClientRect().top) < 1,
              inert: copy.inert && copy.getAttribute("aria-hidden") === "true",
              duplicates: ids.length - new Set(ids).size,
              lanes: [copy, live].map(
                (element) =>
                  element.querySelectorAll(".agenda-week-layers").length,
              ),
            };
          },
          { id },
        );
        if (!expected) {
          assert.equal(sample, null);
          return;
        }
        assert.ok(sample, `${width}: ${id} creates paired pages`);
        if (sample.visibleDates.length && !id.startsWith("[data-year-date")) {
          assert.deepEqual(
            sample.selectedDates,
            sample.visibleDates.includes(sample.previousSelection)
              ? [sample.previousSelection]
              : [],
            "Keep the original visible card selected; clear selection when it leaves, without selecting a replacement",
          );
        }
        if (!sample.weekView) {
          assert.equal(
            sample.timing.duration,
            520,
            "Full month/year travel has enough time to remain readable",
          );
          assert.equal(sample.timing.easing, "cubic-bezier(0.4, 0, 0.2, 1)");
        } else if (sample.sharedMotion.length || sample.rows === 1)
          assert.equal(
            sample.timing.duration,
            320,
            "A one-week step keeps its existing pace",
          );
        assert.deepEqual(sample.opacity, ["1", "1"]);
        assert.equal(
          sample.stationary,
          true,
          `${width}: ${id} keeps weekday labels stationary`,
        );
        assert.equal(sample.inert, true);
        assert.equal(sample.duplicates, 0);
        assert.deepEqual(sample.lanes.slice(0, 1), sample.lanes.slice(1));
        for (const frames of sample.frames) {
          assert.equal(frames.length, 1);
          assert.ok(
            frames[0].every((frame) =>
              /^translateY\(-?[\d.]+px\)$/.test(frame.transform),
            ),
          );
          assert.ok(frames[0].every((frame) => frame.opacity === undefined));
        }
        const firstOffset =
          sample.frames[1][0][0].transform.match(/-?[\d.]+/)[0];
        assert.equal(Math.sign(Number(firstOffset)), sign);
        const seam =
          sign > 0
            ? sample.rects[0].bottom - sample.rects[1].top
            : sample.rects[1].bottom - sample.rects[0].top;
        if (sample.sharedMotion.length && sample.rows > 1) {
          const movedRows = (sample.rows * 7 - sample.sharedMotion.length) / 7;
          assert.ok(
            Math.abs(
              Math.abs(Number(firstOffset)) - sample.rowStride * movedRows,
            ) < 1,
            "Overlapping date ranges move by the actual number of weeks",
          );
          assert.ok(
            Math.abs(Number(firstOffset)) < sample.oldHeight,
            "One-week navigation does not move the full multiweek view",
          );
          assert.ok(
            sample.clipped.startsWith("inset("),
            "Only departing old rows remain visible",
          );
          for (const shared of sample.sharedMotion) {
            assert.ok(
              Math.abs(shared.previous - shared.resting - Number(firstOffset)) <
                1,
              "Shared dates align with their previous row positions",
            );
          }
        } else assert.ok(Math.abs(seam) < 1, `Pages stay joined: ${seam}`);
        if (
          !captured ||
          (sample.rows === 3 && sample.sharedMotion.length === 14)
        ) {
          await page.screenshot({
            path: path.resolve(
              "test-results",
              "calendar-slide-" + width + "-rows-" + sample.rows + ".png",
            ),
          });
          captured = true;
        }
        await settle();
      };
      await page
        .locator('#calendar [data-date="2026-10-31"] .day-select')
        .click();
      await slide("nextMonth", 1);
      assert.equal(
        await page
          .locator('#calendar [data-preview-date="2026-10-31"].selected')
          .count(),
        1,
      );
      await slide("nextMonth", 1);
      assert.equal(await page.locator("#calendar>.day.selected").count(), 0);
      await slide("prevMonth", -1);
      assert.equal(
        await page.locator("#calendar>.day.selected").count(),
        0,
        "Returning to a date does not resurrect its cancelled selection",
      );
      await slide("todayButton", -1);
      await page
        .locator('#calendar [data-date="2026-10-20"] .day-select')
        .click();
      await slide("nextMonth", 1);
      await slide("prevMonth", -1);
      await slide("todayButton", 0, false);
      await page.locator("#monthTitle").click();
      await page.waitForTimeout(400);
      await slide("nextMonth", 1);
      await slide("prevMonth", -1);
      await slide('[data-year-date="2026-02-01"]', -1);
      await slide("nextMonth", 1);
      await slide("todayButton", 1);
      for (let i = 0; i < 3; i++) await slide("nextMonth", 1);
      assert.ok(await page.locator('#calendar [data-date^="2027-01"]').count());
      await slide("todayButton", -1);

      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.locator("#agendaMode").click();
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill("跨周导航验证");
      await page.locator("#agendaScheduleOpen").click();
      await setScheduleRange(page, "2026-10-20");
      await page.locator("#agendaEndDateInput").fill("2026-11-12");
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
      for (let step = 0; step < 3; step++)
        await page.locator("#agendaViewToggle").click();
      await page
        .locator('#calendar [data-date="2026-10-29"] .day-select')
        .click({ position: { x: 5, y: 5 } });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await slide("nextMonth", 1);
      assert.equal(
        await page
          .locator('#calendar [data-date="2026-10-29"].selected')
          .count(),
        1,
      );
      assert.ok(
        (await page.locator("#agendaDate").textContent()).includes("29"),
        "Editor keeps the retained selected date",
      );
      await slide("nextMonth", 1);
      assert.equal(await page.locator("#calendar>.day.selected").count(), 0);
      await slide("prevMonth", -1);
      assert.equal(await page.locator("#calendar>.day.selected").count(), 0);
      await page
        .locator('#calendar [data-date="2026-10-29"] .day-select')
        .click({ position: { x: 5, y: 5 } });
      assert.equal(
        await page
          .locator(
            '#calendar [data-date="2026-10-29"].selected .day-select[aria-pressed="true"]',
          )
          .count(),
        1,
      );
      await slide("todayButton", -1);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.locator("#agendaViewToggle").click();
      await page
        .locator('#calendar [data-date="2026-10-20"] .day-select')
        .click({ position: { x: 5, y: 5 } });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      for (let view = 0; view < 4; view++) {
        await slide("nextMonth", 1);
        await slide("prevMonth", -1);
        await slide("todayButton", 0, false);
        if (view === 3) {
          await slide("nextMonth", 1);
          await slide("nextMonth", 1);
          await slide("todayButton", -1);
          for (let step = 0; step < 4; step++) await slide("nextMonth", 1);
          await slide("todayButton", -1);
        }
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.locator("#agendaViewToggle").click();
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
      // A new request replaces paused pages immediately, without queuing renders.
      await page.evaluate(() => {
        for (const id of ["nextMonth", "nextMonth", "prevMonth"])
          (document.getElementById(id) || document.querySelector(id)).click();
      });
      assert.equal(await page.locator(".calendar-navigation-copy").count(), 1);
      await settle();
      await slide("todayButton", -1);
      await page.evaluate(() => {
        document.getElementById("nextMonth").click();
        window.dispatchEvent(new Event("resize"));
      });
      await settle();
      await page.evaluate(() => document.getElementById("prevMonth").click());
      await page.emulateMedia({ reducedMotion: "reduce" });
      await settle();
      await slide("nextMonth", 0, false);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => {
        window.originalAnimate = Element.prototype.animate;
        Element.prototype.animate = undefined;
      });
      await slide("prevMonth", 0, false);
      await page.evaluate(() => {
        Element.prototype.animate = window.originalAnimate;
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Opaque vertical calendar navigation passed: attendance month/year, all agenda views, cross-week lanes, one/two-week travel, retained/cancelled selection, seams, reversal, today, resize, reduced motion and API fallback at 1440/390/320px.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
