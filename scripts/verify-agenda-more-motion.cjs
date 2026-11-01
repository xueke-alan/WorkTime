"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1480, 390]) {
      let page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-29T04:00:00Z"));
      const url = pathToFileURL(
        path.resolve(process.argv[2] || ".", "index.html"),
      ).href;
      const ready = () =>
        page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading"),
        );
      await page.goto(url);
      await ready();
      const fixture = await page.evaluate(() => {
        const state = WorkTimeApp.domain.state.defaultState();
        state.agenda = Array.from({ length: 14 }, (_, index) => ({
          id: "overflow-" + index,
          title: "溢出日程 " + index,
          date: "2026-10-26",
          endDate: "2026-11-08",
          allDay: true,
          start: "",
          end: "",
          status: "pending",
          note: "第一行\n第二行\n第三行",
          createdAt: "2026-10-29T00:00:00Z",
          updatedAt: "2026-10-29T00:00:00Z",
        }));
        return state;
      });
      await page.close();
      page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        reducedMotion: "reduce",
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-29T04:00:00Z"));
      await page.addInitScript((state) => {
        localStorage.setItem("worktime-local-v1", JSON.stringify(state));
        localStorage.setItem(
          "worktime.calendarView",
          JSON.stringify({ mode: "agenda", weeks: 2 }),
        );
      }, fixture);
      await page.goto(url);
      await ready();
      const settle = () =>
        page.waitForFunction(
          () =>
            !document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })
              .some(
                (animation) =>
                  animation.pending || animation.playState === "running",
              ),
        );
      await settle();
      assert.ok(await page.locator(".agenda-day-more").count());
      const retained = await page.evaluate(() => {
        const label = document.querySelector(".agenda-day-more");
        const day = label.closest(".day");
        day.querySelector(".day-select").click();
        const current = document.querySelector(
          `.agenda-day-more[data-agenda-date="${label.dataset.agendaDate}"]`,
        );
        return (
          current?.textContent === label.textContent &&
          current.getAnimations().length === 0
        );
      });
      assert.equal(
        retained,
        true,
        "Selection keeps the date's overflow text without replaying an entrance",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      for (let step = 0; step < 2; step++) {
        const result = await page.evaluate(() => {
          document.querySelector("#agendaViewToggle").click();
          const labels = [...document.querySelectorAll(".agenda-day-more")];
          const animations = document
            .querySelector("#calendar")
            .getAnimations({ subtree: true });
          const samples = [];
          for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
            for (const animation of animations) {
              animation.pause();
              animation.currentTime =
                Number(animation.effect.getTiming().duration) * progress;
            }
            samples.push(
              labels.map((label) => {
                const day = label.parentElement;
                const card = day.getBoundingClientRect(),
                  rect = label.getBoundingClientRect();
                return {
                  right: card.right - rect.right,
                  bottom: card.bottom - rect.bottom,
                  opacity: getComputedStyle(label).opacity,
                  separate: label.getAnimations().length,
                  native: day.classList.contains("day"),
                };
              }),
            );
          }
          const overlay = !!document.querySelector(".agenda-more-motion");
          for (const animation of animations) animation.finish();
          return { samples, overlay };
        });
        assert.equal(
          result.overlay,
          false,
          "Overflow does not create its own animation layer",
        );
        assert.ok(result.samples[0].length);
        for (const sample of result.samples) {
          for (const [index, label] of sample.entries()) {
            const initial = result.samples[0][index];
            assert.ok(
              label.native,
              "The label belongs directly to its date card",
            );
            assert.equal(
              label.separate,
              0,
              "Only the date card owns the animation",
            );
            assert.equal(
              label.opacity,
              "1",
              "The label has no independent opacity effect",
            );
            assert.ok(
              Math.abs(label.right - initial.right) < 0.2 &&
                Math.abs(label.bottom - initial.bottom) < 0.2,
              "The label keeps its edge insets while the date card moves and resizes",
            );
          }
        }
        await settle();
        assert.ok(await page.locator(".agenda-day-more:visible").count());
      }
      await page.locator(".agenda-day-more").first().click();
      assert.ok(
        await page.locator("#agendaList .agenda-item").count(),
        "Overflow still opens the date's agenda",
      );
      await page.locator("#agendaViewToggle").click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await settle();
      assert.equal(await page.locator(".agenda-more-motion").count(), 0);
      const weekly = await page.evaluate(() => {
        const labels = [...document.querySelectorAll(".agenda-day-more")];
        return labels.map((label) => {
          const rect = label.getBoundingClientRect();
          const day = label.closest(".day"),
            card = day.getBoundingClientRect();
          const height = parseFloat(
            getComputedStyle(
              document.querySelector("#calendar"),
            ).getPropertyValue("--agenda-all-card-height"),
          );
          const hit = document.elementFromPoint(
            rect.right - 3,
            rect.top + rect.height / 2,
          );
          return {
            text: label.textContent,
            inAllDayRegion:
              rect.top > card.top && rect.bottom <= card.top + height,
            clickable: hit === label || label.contains(hit),
            independent: label.getAnimations().length,
          };
        });
      });
      assert.ok(weekly.length, "Single-week overflow remains visible");
      assert.ok(
        weekly.every((label) => label.text === "11+"),
        "Three visible lanes leave eleven overflowed events",
      );
      assert.ok(
        weekly.every((label) => label.inAllDayRegion && label.clickable),
        "Single-week overflow is inside the all-day region and above the timetable's hit surface",
      );
      assert.ok(weekly.every((label) => label.independent === 0));
      await page.locator("#agendaViewToggle").click();
      await settle();
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Overflow labels remain part of their date cards through resize, view changes, selection and reduced motion at desktop and mobile widths.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
