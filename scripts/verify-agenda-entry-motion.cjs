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
    for (const width of [1480, 1000, 390]) {
      for (const { weeks, today } of [
        { weeks: 1, today: "2026-11-04T04:00:00Z" },
        { weeks: 1, today: "2026-10-20T04:00:00Z" },
        { weeks: 2, today: "2026-10-20T04:00:00Z" },
        { weeks: 1, today: "2026-12-30T04:00:00Z" },
      ]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          locale: "zh-CN",
          reducedMotion: "no-preference",
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route(/^https?:/, (route) => route.abort());
        await page.clock.setFixedTime(new Date(today));
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
            const oldWeekDates = cards
              .filter((card) => card.hasAttribute("data-agenda-week"))
              .map((card) => card.dataset.date || card.dataset.previewDate)
              .sort();
            const oldLowers = [
              ...document.querySelectorAll(".timetable-bottom-card"),
            ].map((node) => node.getBoundingClientRect());
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
            const ghosts = [
              ...document.querySelectorAll(
                ".agenda-week-return-exits > .timetable-bottom-card",
              ),
            ];
            result.lowerCount = ghosts.length;
            result.lowerStartError = ghosts.length
              ? Math.max(
                  ...ghosts.flatMap((node, index) => {
                    const rect = node.getBoundingClientRect();
                    return ["x", "y", "width", "height"].map((key) =>
                      Math.abs(rect[key] - oldLowers[index][key]),
                    );
                  }),
                )
              : 0;
            result.handoffError = 0;
            result.handoffOpacityError = 0;
            const surrounding = cards.filter(
              (card) =>
                !oldWeekDates.includes(
                  card.dataset.date || card.dataset.previewDate,
                ) && card.getClientRects().length,
            );
            result.surroundingCount = surrounding.length;
            result.visibleCount = cards.filter(
              (card) => card.getClientRects().length,
            ).length;
            result.surroundingMoving = surrounding.filter((card) =>
              card
                .getAnimations()
                .some((a) => a.effect.getKeyframes().some((f) => f.height)),
            ).length;
            result.surroundingReveal = surrounding.some((card) =>
              card
                .getAnimations()
                .some((a) =>
                  a.effect
                    .getKeyframes()
                    .some((f) => f.opacity !== undefined || f.clipPath),
                ),
            );
            result.rowError = 0;
            if (ghosts.length) {
              for (const time of [0, 115, 230, 345, 459]) {
                for (const animation of document
                  .querySelector("#calendar")
                  .getAnimations({ subtree: true })) {
                  animation.pause();
                  animation.currentTime = time;
                }
                for (const ghost of ghosts) {
                  const date = ghost.dataset.timetableDate;
                  const target = document.querySelector(
                    '#calendar > .day[data-date="' +
                      date +
                      '"],#calendar > .day[data-preview-date="' +
                      date +
                      '"]',
                  );
                  if (!target) continue;
                  const rect = ghost.getBoundingClientRect(),
                    destination = target.getBoundingClientRect();
                  // The time region follows its own date; it never becomes the next week.
                  result.handoffError = Math.max(
                    result.handoffError,
                    Math.abs(rect.x - destination.x),
                    Math.abs(rect.width - destination.width),
                  );
                  const opacityTrack = target
                    .getAnimations()
                    .find((a) =>
                      a.effect
                        .getKeyframes()
                        .some((f) => f.opacity !== undefined),
                    );
                  const finalOpacity =
                    Number(
                      opacityTrack?.effect.getKeyframes().at(-1).opacity,
                    ) ||
                    Number(getComputedStyle(target).opacity) ||
                    1;
                  result.handoffOpacityError = Math.max(
                    result.handoffOpacityError,
                    Math.abs(
                      (1 - Number(getComputedStyle(ghost).opacity)) *
                        (1 -
                          Number(getComputedStyle(target).opacity) /
                            finalOpacity),
                    ),
                  );
                }
                const selectedIndex = cards.indexOf(selected);
                const row = Math.floor(selectedIndex / 7);
                const gap =
                  parseFloat(
                    getComputedStyle(document.querySelector("#calendar"))
                      .rowGap,
                  ) || 0;
                for (const card of surrounding) {
                  const index = cards.indexOf(card);
                  const anchor = cards[row * 7 + (index % 7)];
                  const owner = anchor.getBoundingClientRect();
                  const rect = card.getBoundingClientRect();
                  const rows = row - Math.floor(index / 7);
                  result.rowError = Math.max(
                    result.rowError,
                    Math.abs(rect.left - owner.left),
                    Math.abs(rect.width - owner.width),
                    Math.abs(rect.height - owner.height),
                    Math.abs(
                      rect.top - (owner.top - rows * (owner.height + gap)),
                    ),
                  );
                }
              }
            }
            return result;
          });
          const weekReturn = !entering && weeks === 1;
          assert.equal(result.timing?.duration, weekReturn ? 460 : 520);
          assert.deepEqual(
            result.lateMeasurements,
            [],
            "Calendar geometry is fully measured before animations start",
          );
          assert.equal(
            result.timing.easing,
            weekReturn
              ? "cubic-bezier(0.32, 0, 0.22, 1)"
              : "cubic-bezier(0.22, 1, 0.36, 1)",
          );
          if (weekReturn) {
            assert.equal(
              result.lowerCount,
              7,
              "Preserve every lower time card during the return",
            );
            assert.ok(
              result.lowerStartError < 1,
              "Lower cards begin exactly where they were painted",
            );
            assert.ok(
              result.handoffError < 1,
              "Outgoing time regions stay aligned with their own date cards",
            );
            assert.ok(
              result.handoffOpacityError < 0.02,
              "Old and new cards maintain continuous opacity through the handoff",
            );
            assert.equal(
              result.surroundingCount,
              result.visibleCount - 7,
              "Exercise every row around the expanded week",
            );
            assert.equal(
              result.surroundingMoving,
              result.surroundingCount,
              "Every surrounding row shares the returning week's geometry animation",
            );
            assert.equal(
              result.surroundingReveal,
              false,
              "Surrounding rows use natural container clipping without a fade reveal",
            );
            assert.ok(
              result.rowError < 1,
              `Surrounding rows keep their size, columns and spacing: ${JSON.stringify(result)}`,
            );
          }
          assert.ok(
            Math.abs(parseFloat(result.frames[0].height) - result.initial[3]) <
              0.01,
          );
          if (entering) assert.ok(result.leaving > 0);
          else
            assert.ok(
              result.returning > 0 || (weekReturn && result.lowerCount === 7),
              "Other month cards slide and fade back in",
            );
          assert.equal(result.inert, true);
          result.initial.forEach((value, index) =>
            assert.ok(
              Math.abs(value - result.animated[index]) < 1,
              `Switch preserves starting geometry: entering=${entering}, ${width}px, ${weeks} weeks, ${JSON.stringify(result)}`,
            ),
          );
          if (
            weekReturn &&
            today.startsWith("2026-11-04") &&
            process.env.WORKTIME_MOTION_SCREENSHOTS
          ) {
            const fs = require("node:fs");
            const output = path.resolve(
              process.env.WORKTIME_MOTION_SCREENSHOTS,
            );
            fs.mkdirSync(output, { recursive: true });
            for (const time of [0, 230, 460]) {
              await page.evaluate((time) => {
                for (const animation of document
                  .querySelector("#calendar")
                  .getAnimations({ subtree: true })) {
                  animation.pause();
                  animation.currentTime = time;
                }
              }, time);
              await page.screenshot({
                path: path.join(output, `return-${width}-${time}.png`),
                fullPage: true,
              });
            }
          }
          await page.evaluate(() => {
            for (const animation of document
              .querySelector("#calendar")
              .getAnimations({ subtree: true }))
              animation.finish();
          });
          await settled();
          assert.equal(
            await page.locator(".agenda-week-return-exits").count(),
            0,
          );
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
    for (const width of [1480, 390]) {
      for (const weeks of [1]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          reducedMotion: "no-preference",
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route(/^https?:/, (route) => route.abort());
        await page.clock.setFixedTime(new Date("2026-10-20T04:00:00Z"));
        await page.addInitScript((weeks) => {
          localStorage.setItem(
            "worktime.calendarView",
            JSON.stringify({ mode: "attendance", weeks, workdaysOnly: true }),
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
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.locator("#agendaMode").click();
        await page.locator("#agendaNew").click();
        await page
          .locator("#agendaTitle")
          .fill("七格布局的长日程文本应该到第二段才逐渐展开".repeat(3));
        await page.locator("#agendaNote").fill("备注随日期宽度变化");
        await page.locator("#agendaScheduleOpen").click();
        await page.locator("#agendaAllDay").check();
        await setScheduleRange(page, "2026-10-20");
        await page.locator("#agendaEndDateInput").fill("2026-10-22");
        await page.locator("[data-schedule-close]").click();
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
        await page.emulateMedia({ reducedMotion: "no-preference" });
        const settle = (target, all = false) =>
          page.waitForFunction(
            ({ target, all }) => {
              const calendar = document.querySelector("#calendar");
              return (
                document
                  .querySelector("#agendaMode")
                  .getAttribute("aria-pressed") === String(target) &&
                (!target ||
                  document
                    .querySelector("#agendaWorkdaysOnly")
                    .getAttribute("aria-checked") === String(!all)) &&
                !calendar
                  .getAnimations({ subtree: true })
                  .some((a) => a.pending || a.playState === "running")
              );
            },
            { target, all },
          );
        const capture = (click = null) =>
          page.evaluate((click) => {
            if (click) document.querySelector(click).click();
            const calendar = document.querySelector("#calendar");
            const effect = (node, property = "width") => {
              const animation = node
                ?.getAnimations()
                .find((a) => a.effect.getKeyframes().some((f) => f[property]));
              return (
                animation && {
                  duration: animation.effect.getTiming().duration,
                  easing: animation.effect.getTiming().easing,
                  widths: animation.effect
                    .getKeyframes()
                    .map((f) => parseFloat(f[property])),
                }
              );
            };
            const ribbon = calendar.querySelector(
              ".agenda-week-lane .agenda-chip[data-agenda-segment-start]:not([hidden])",
            );
            return {
              day: effect(calendar.querySelector(".day.selected")),
              ribbon: effect(ribbon),
              title: effect(
                ribbon?.querySelector(".agenda-chip-title-text"),
                "maxWidth",
              ),
              titleMax: parseFloat(
                getComputedStyle(
                  ribbon?.querySelector(".agenda-chip-title-text") || calendar,
                ).maxWidth,
              ),
              active:
                document
                  .querySelector("#agendaMode")
                  .getAttribute("aria-pressed") === "true",
              days: calendar.querySelectorAll("[data-agenda-week]").length,
              preference: JSON.parse(
                localStorage.getItem("worktime.calendarView"),
              ).workdaysOnly,
              outlines: calendar.querySelectorAll(".agenda-date-edges").length,
            };
          }, click);
        const sameEffect = (actual, expected) => {
          for (const key of ["day", "ribbon", "title"]) {
            assert.equal(actual[key]?.duration, expected[key]?.duration);
            assert.equal(actual[key]?.easing, expected[key]?.easing);
            assert.equal(
              actual[key]?.widths.length,
              expected[key]?.widths.length,
            );
            actual[key]?.widths.forEach((n, i) =>
              assert.ok(Math.abs(n - expected[key].widths[i]) < 1),
            );
          }
        };
        // Take the weekday button itself as the visual reference, including
        // long ribbon text. Mode switching must run these exact width tracks.
        const expand = await capture("#agendaWorkdaysOnly");
        await settle(true, true);
        const fullSeven = await capture();
        const collapse = await capture("#agendaWorkdaysOnly");
        await settle(true);
        const returning = await capture("#agendaMode");
        assert.equal(
          returning.active,
          true,
          "Keep the agenda mounted throughout column restoration",
        );
        assert.equal(returning.days, weeks * 7);
        assert.equal(
          returning.preference,
          true,
          "Temporary expansion never changes the saved filter",
        );
        sameEffect(returning, expand);
        await page.waitForFunction(
          () =>
            document
              .querySelector("#agendaMode")
              .getAttribute("aria-pressed") === "false",
        );
        const pageReturn = await capture();
        assert.equal(pageReturn.day?.duration, weeks === 1 ? 460 : 360);
        assert.equal(pageReturn.outlines, 0);
        const rowError = await page.evaluate(() => {
          const calendar = document.querySelector("#calendar");
          const cards = [...calendar.querySelectorAll(":scope > .day")];
          const row = Math.floor(
            cards.findIndex((card) => card.classList.contains("selected")) / 7,
          );
          const gap = parseFloat(getComputedStyle(calendar).rowGap) || 0;
          let error = 0;
          for (const time of [0, 115, 230, 345, 459]) {
            for (const animation of calendar.getAnimations({ subtree: true })) {
              animation.pause();
              animation.currentTime = time;
            }
            for (let index = 0; index < cards.length; index++) {
              if (Math.floor(index / 7) === row) continue;
              const rect = cards[index].getBoundingClientRect();
              const anchor = cards[row * 7 + (index % 7)];
              const owner = anchor.getBoundingClientRect();
              const track = (card) =>
                card
                  .getAnimations()
                  .find((a) => a.effect.getKeyframes().some((f) => f.height));
              if (
                track(cards[index])?.effect.getTiming().duration !==
                track(anchor)?.effect.getTiming().duration
              )
                throw Error(
                  "Surrounding rows must share their anchor's timing",
                );
              error = Math.max(
                error,
                Math.abs(rect.left - owner.left),
                Math.abs(rect.width - owner.width),
                Math.abs(rect.height - owner.height),
                Math.abs(
                  rect.top -
                    (owner.top -
                      (row - Math.floor(index / 7)) * (owner.height + gap)),
                ),
              );
            }
          }
          for (const animation of calendar.getAnimations({ subtree: true }))
            animation.finish();
          return error;
        });
        assert.ok(
          rowError < 1,
          `Filtered return preserves row geometry: ${rowError}`,
        );
        await settle(false);
        const entering = await capture("#agendaMode");
        assert.equal(
          entering.days,
          weeks * 7,
          "Enter a real seven-column agenda before filtering",
        );
        assert.equal(entering.day?.duration, 360);
        assert.ok(
          (Number.isNaN(entering.titleMax) &&
            Number.isNaN(fullSeven.titleMax)) ||
            Math.abs(entering.titleMax - fullSeven.titleMax) < 1,
          `Seven-column text stays intact during the page transition: ${JSON.stringify({ width, weeks, entering: entering.titleMax, seven: fullSeven.titleMax })}`,
        );
        await page.waitForFunction(
          () =>
            document
              .querySelector("#agendaWorkdaysOnly")
              .getAttribute("aria-checked") === "true",
        );
        const modeCollapse = await capture();
        sameEffect(modeCollapse, collapse);
        await settle(true);
        let target = true;
        for (const clicks of [1, 3, 1]) {
          target = !target;
          await page.evaluate((clicks) => {
            for (let i = 0; i < clicks; i++)
              document.querySelector("#agendaMode").click();
          }, clicks);
          await settle(target);
          assert.equal((await capture()).preference, true);
          assert.equal(
            await page.locator("#calendar > .day[inert]").count(),
            0,
          );
        }
        await page.evaluate(() => {
          document.querySelector("#agendaMode").click();
          window.dispatchEvent(new Event("resize"));
        });
        await settle(true);
        await page.evaluate(() =>
          document.querySelector("#agendaMode").click(),
        );
        await page.emulateMedia({ reducedMotion: "reduce" });
        await settle(false);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.locator("#agendaMode").click();
        assert.equal(
          await page.evaluate(
            () => document.querySelector("#calendar").getAnimations().length,
          ),
          0,
        );
        assert.ok(
          await page.locator("#calendar [data-agenda-week]:visible").count(),
          "Filtered agenda remains usable after interrupted transitions",
        );
        await page.waitForTimeout(700);
        const alignment = await page.evaluate(async () => {
          const original = document.createRange;
          let measurements = 0;
          document.createRange = function () {
            measurements++;
            return original.call(this);
          };
          const tick = () => new Promise(requestAnimationFrame);
          try {
            const edge = document.querySelector(".agenda-date-edge");
            for (let i = 0; i < 6; i++) {
              edge.style.left = i + "px";
              await tick();
              await tick();
            }
            const decorationMeasurements = measurements;
            const text = document.querySelector(".day.selected .daynum-text");
            text.textContent += " ";
            await tick();
            await tick();
            return {
              decorationMeasurements,
              textMeasurements: measurements - decorationMeasurements,
            };
          } finally {
            document.createRange = original;
          }
        });
        assert.equal(
          alignment.decorationMeasurements,
          0,
          "Moving borders must not remeasure live text every frame",
        );
        assert.ok(
          alignment.textMeasurements > 0,
          "Real text changes still trigger alignment",
        );
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
    console.log(
      "Attendance entry/return geometry, filtered two-stage card transitions, interruptions and reduced motion verified at desktop and mobile widths.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
