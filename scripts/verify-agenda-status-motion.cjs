"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1480, 390]) {
      let page = await browser.newPage();
      await page.route(/^https?:/, (route) => route.abort());
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
        state.agenda = ["pending", "in-progress", "completed", "cancelled"].map(
          (status, index) => ({
            id: "status-motion-" + index,
            title: "状态圆点 " + index,
            date: index === 3 ? "2026-10-31" : "2026-10-27",
            endDate: index === 3 ? "2026-10-31" : "2026-10-27",
            allDay: false,
            start: index === 1 ? "09:15" : "09:00",
            end: index === 1 ? "10:15" : "10:00",
            status,
            note: "备注",
            createdAt: "2026-10-29T00:00:00Z",
            updatedAt: "2026-10-29T00:00:00Z",
          }),
        );
        return state;
      });
      await page.close();
      page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: "no-preference",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-29T04:00:00Z"));
      await page.addInitScript((state) => {
        localStorage.setItem("worktime-local-v1", JSON.stringify(state));
        localStorage.setItem(
          "worktime.calendarView",
          JSON.stringify({ mode: "agenda", weeks: 1 }),
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
      for (let toggle = 0; toggle < 4; toggle++) {
        const result = await page.evaluate(() => {
          let cards = [
            ...document.querySelectorAll(
              '.timetable-event[data-agenda-edit^="status-motion-"]',
            ),
          ].filter((node) => node.dataset.agendaEdit !== "status-motion-3");
          const before = cards.map((node) => {
            const dot = node.querySelector(".agenda-chip-status");
            const card = node.getBoundingClientRect(),
              rect = dot.getBoundingClientRect();
            return {
              dot,
              inset: card.right - rect.right,
              top: rect.top - card.top,
              left: rect.left,
            };
          });
          document.querySelector("#agendaWorkdaysOnly").click();
          cards = cards.map((node) =>
            document.querySelector(
              `.timetable-event[data-agenda-edit="${node.dataset.agendaEdit}"]`,
            ),
          );
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
              cards.map((node, index) => {
                const dot = node.querySelector(".agenda-chip-status");
                const card = node.getBoundingClientRect(),
                  rect = dot.getBoundingClientRect();
                return {
                  error: Math.abs(
                    card.right - rect.right - before[index].inset,
                  ),
                  yError: Math.abs(rect.top - card.top - before[index].top),
                  startError: Math.abs(rect.left - before[index].left),
                };
              }),
            );
          }
          for (const animation of animations) animation.finish();
          return { samples, count: cards.length };
        });
        assert.equal(result.count, 3);
        assert.ok(
          result.samples
            .flat()
            .every((entry) => entry.error < 0.15 && entry.yError < 0.15),
          `Status indicators retain their card-edge inset throughout width animation: ${JSON.stringify(result.samples)}`,
        );
        assert.ok(
          result.samples[0].every((entry) => entry.startError < 0.15),
          "The first frame matches the previous indicator position",
        );
        await settle();
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.locator("#agendaWorkdaysOnly").click();
      await settle();
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Status indicators remain anchored through weekend collapse/restore, overlapping columns and reduced motion at desktop and mobile widths.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
