"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1480, 1000, 390]) {
      let page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        reducedMotion: "no-preference",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      const ready = () =>
        page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading"),
        );
      await ready();
      const dividerReveal = await page.evaluate(() => {
        document.querySelector("#agendaMode").click();
        document.querySelector("#agendaViewToggle").click();
        const line = document.querySelector(".timetable-divider");
        const reveal = line
          .getAnimations()
          .find((a) => a.animationName === "timetable-divider-reveal");
        const paint = (time) => {
          reveal.pause();
          reveal.currentTime = time;
          const style = getComputedStyle(line);
          return {
            scale: new DOMMatrix(style.transform).m11,
            opacity: Number(style.opacity),
          };
        };
        const first = paint(0),
          middle = paint(130),
          last = paint(520);
        for (const animation of document
          .querySelector("#calendar")
          .getAnimations({ subtree: true }))
          animation.finish();
        return { first, middle, last };
      });
      assert.equal(dividerReveal.first.scale, 0);
      assert.equal(dividerReveal.first.opacity, 0);
      assert.ok(
        dividerReveal.middle.scale > 0 && dividerReveal.middle.scale < 1,
      );
      assert.ok(
        dividerReveal.middle.opacity > 0 && dividerReveal.middle.opacity < 1,
      );
      assert.equal(dividerReveal.last.scale, 1);
      assert.equal(dividerReveal.last.opacity, 1);
      for (let toggle = 0; toggle < 2; toggle++) {
        const dividerFilter = await page.evaluate(() => {
          const line = document.querySelector(".timetable-divider");
          const animations = line.getAnimations();
          document.querySelector("#agendaWorkdaysOnly").click();
          const current = document.querySelector(".timetable-divider");
          const style = getComputedStyle(current);
          const result = {
            sameNode: current === line,
            sameAnimations: current
              .getAnimations()
              .every(
                (animation) =>
                  animations.includes(animation) &&
                  animation.playState === "finished",
              ),
            scale: new DOMMatrix(style.transform).m11,
            opacity: Number(style.opacity),
          };
          for (const animation of document
            .querySelector("#calendar")
            .getAnimations({ subtree: true }))
            animation.finish();
          return result;
        });
        assert.equal(dividerFilter.sameNode, true);
        assert.equal(
          dividerFilter.sameAnimations,
          true,
          "Filtering weekends does not replay the divider entrance",
        );
        assert.equal(dividerFilter.scale, 1);
        assert.equal(dividerFilter.opacity, 1);
      }
      const settled = () =>
        page.waitForFunction(
          () =>
            !document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })
              .some((a) => a.pending || a.playState === "running"),
        );
      await page.locator("#agendaWorkdaysOnly").click();
      await settled();
      const restoring = await page.evaluate(() => {
        document.querySelector("#agendaViewToggle").click();
        const calendar = document.querySelector("#calendar");
        const result = {
          view: document.querySelector("#agendaViewToggle").dataset.view,
          dates: calendar.querySelectorAll(":scope > .day[data-agenda-week]")
            .length,
          columnMotion: calendar
            .querySelector(".day[data-agenda-week]")
            .getAnimations()
            .some((a) => a.effect.getKeyframes().some((f) => f.width)),
        };
        for (const animation of calendar.getAnimations({ subtree: true }))
          animation.finish();
        return result;
      });
      assert.equal(
        restoring.view,
        "week",
        "Stage one restores dates before changing the view",
      );
      assert.equal(restoring.dates, 7);
      assert.equal(restoring.columnMotion, true);
      await page.waitForFunction(
        () =>
          document.querySelector("#agendaViewToggle").dataset.view ===
          "fortnight",
      );
      await settled();
      assert.equal(
        await page.locator("#agendaWorkdaysOnly").isVisible(),
        false,
      );
      assert.equal(
        await page.locator("#calendar > .day[data-agenda-week]").count(),
        14,
      );
      await page.evaluate(() =>
        document.querySelector("#agendaWorkdaysOnly").click(),
      );
      assert.equal(
        await page.locator("#calendar > .day[data-agenda-week]").count(),
        14,
        "The hidden filter is inactive in multiweek views",
      );
      await page.locator("#agendaViewToggle").click();
      await settled();
      assert.equal(
        await page.locator("#calendar > .day[data-agenda-week]").count(),
        21,
      );
      assert.equal(
        await page.locator("#agendaWorkdaysOnly").isVisible(),
        false,
      );
      await page.reload();
      await ready();
      await settled();
      assert.equal(
        await page.locator("#calendar > .day[data-agenda-week]").count(),
        21,
        "A saved filter cannot hide dates after restoring a multiweek view",
      );
      for (let index = 0; index < 2; index++)
        await page.locator("#agendaViewToggle").click();
      await settled();
      assert.equal(
        await page.locator("#calendar > .day[data-agenda-week]").count(),
        5,
        "Returning to single week restores the saved filter",
      );
      await page.evaluate(() => {
        const toggle = document.querySelector("#agendaViewToggle");
        toggle.click();
        for (const animation of document
          .querySelector("#calendar")
          .getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 120;
        }
        toggle.click();
      });
      await settled();
      assert.equal(
        await page.locator("#agendaViewToggle").getAttribute("data-view"),
        "threeweek",
        "A second request interrupts date restoration without committing the stale target",
      );
      assert.equal(
        await page.locator("#calendar > .day[data-agenda-week]").count(),
        21,
      );
      // Rendering uses an explicit preference; live OS changes are covered by
      // verify-motion-settings, which also runs in the release gate.
      await page.evaluate(async () => {
        const saved =
          await WorkTimeApp.services.preferences.page.saveMotionMode("reduce");
        if (!saved.persisted)
          throw Error("Motion test preference did not persist");
      });
      for (let index = 0; index < 2; index++)
        await page.locator("#agendaViewToggle").click();
      assert.equal(
        await page.locator("#calendar > .day[data-agenda-week]").count(),
        5,
      );
      await page.locator("#agendaViewToggle").click();
      assert.equal(
        await page.locator("#calendar > .day[data-agenda-week]").count(),
        14,
        "Reduced motion settles both stages immediately",
      );
      const fixture = await page.evaluate(() => {
        const state = WorkTimeApp.domain.state.defaultState();
        const item = (id, extra = {}) => ({
          id,
          title: id,
          date: "2026-10-28",
          endDate: "2026-10-28",
          allDay: true,
          start: "",
          end: "",
          note: "",
          status: "pending",
          createdAt: "2026-10-28T00:00:00Z",
          updatedAt: "2026-10-28T00:00:00Z",
          ...extra,
        });
        state.agenda = [
          item("all-day-ribbon", { date: "2026-10-27", endDate: "2026-10-29" }),
          item("all-day-second"),
          item("edge-to-saturday", {
            date: "2026-10-26",
            endDate: "2026-10-31",
          }),
          ...Array.from({ length: 10 }, (_, index) =>
            item("timed-" + index, {
              allDay: false,
              start:
                String(8 + Math.floor(index / 2)).padStart(2, "0") +
                (index % 2 ? ":30" : ":00"),
              end:
                String(8 + Math.floor(index / 2)).padStart(2, "0") +
                (index % 2 ? ":50" : ":20"),
              note: "第一行备注\n第二行备注\n第三行备注",
            }),
          ),
          item("overnight", {
            allDay: false,
            start: "16:30",
            end: "09:00",
            endDate: "2026-10-29",
          }),
          item("incoming-week", { date: "2026-11-04", endDate: "2026-11-04" }),
          item("gap-previous", { date: "2026-11-01", endDate: "2026-11-02" }),
          item("gap-long", { date: "2026-11-02", endDate: "2026-11-05" }),
          item("gap-reused", { date: "2026-11-03", endDate: "2026-11-04" }),
        ];
        return state;
      });
      await page.close();
      page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        reducedMotion: "no-preference",
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
      await page.addInitScript((state) => {
        localStorage.clear();
        localStorage.setItem("worktime-local-v1", JSON.stringify(state));
        localStorage.setItem(
          "worktime.calendarView",
          JSON.stringify({ mode: "agenda", weeks: 1 }),
        );
      }, fixture);
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await ready();
      await page.waitForFunction(
        () =>
          !document
            .querySelector("#calendar")
            .getAnimations({ subtree: true })
            .some((a) => a.pending || a.playState === "running"),
      );
      for (const expected of [1, 0]) {
        const edge = await page.evaluate(() => {
          document.querySelector("#agendaWorkdaysOnly").click();
          const chip = document.querySelector(
            '.agenda-chip[data-agenda-edit="edge-to-saturday"]',
          );
          const face =
            [...chip.querySelectorAll(".agenda-chip-face")].at(-1) || chip;
          const animations = document
            .querySelector("#calendar")
            .getAnimations({ subtree: true });
          const sample = (time) => {
            for (const animation of animations) {
              animation.pause();
              animation.currentTime = time;
            }
            return Number(getComputedStyle(face, "::after").opacity);
          };
          const start = sample(0),
            middle = sample(180),
            end = sample(360);
          const animated = face
            .getAnimations({ subtree: true })
            .some((animation) => animation.effect.pseudoElement === "::after");
          for (const animation of animations) animation.finish();
          return { start, middle, end, animated };
        });
        assert.equal(
          edge.animated,
          true,
          "Continuation edge receives a transition when date columns are rebuilt: " +
            JSON.stringify(edge),
        );
        assert.equal(edge.start, 1 - expected);
        assert.ok(edge.middle > 0 && edge.middle < 1);
        assert.equal(edge.end, expected);
      }
      const orderOnDate = (date, ids) =>
        page.evaluate(
          ({ date, ids }) =>
            [
              ...document.querySelectorAll(
                ".agenda-week-lane .agenda-chip:not([hidden])",
              ),
            ]
              .filter(
                (node) =>
                  ids.includes(node.dataset.agendaEdit) &&
                  node.dataset.agendaSegmentStart <= date &&
                  node.dataset.agendaSegmentEnd >= date,
              )
              .sort(
                (a, b) =>
                  a.getBoundingClientRect().top - b.getBoundingClientRect().top,
              )
              .map((node) => node.dataset.agendaEdit),
          { date, ids },
        );
      const allDayIds = [
        "all-day-ribbon",
        "all-day-second",
        "edge-to-saturday",
      ];
      const singleOrder = await orderOnDate("2026-10-28", allDayIds);
      assert.deepEqual(singleOrder, [
        "all-day-ribbon",
        "all-day-second",
        "edge-to-saturday",
      ]);
      const result = await page.evaluate(() => {
        const calendar = document.querySelector("#calendar");
        const before = [
          ...calendar.querySelectorAll(
            ".agenda-chip[data-agenda-edit]:not([hidden])",
          ),
        ].map((node) => ({
          id: node.dataset.agendaEdit,
          date: node.dataset.agendaSegmentStart || node.dataset.timetableDate,
          end: node.dataset.agendaSegmentEnd || node.dataset.timetableDate,
          rect: node.getBoundingClientRect().toJSON(),
        }));
        document.querySelector("#agendaViewToggle").click();
        const animations = calendar.getAnimations({ subtree: true });
        const sample = (time) =>
          animations.forEach((a) => {
            a.pause();
            a.currentTime = time;
          });
        const visible = [
          ...calendar.querySelectorAll(
            ".agenda-packed-row .agenda-chip:not([hidden])",
          ),
        ]
          .map((node) => {
            const matches = before.filter(
              (old) =>
                old.id === node.dataset.agendaEdit &&
                old.date <= node.dataset.agendaSegmentEnd &&
                old.end >= node.dataset.agendaSegmentStart,
            );
            return {
              node,
              old:
                matches.find(
                  (old) => old.date === node.dataset.agendaSegmentStart,
                ) || matches[0],
            };
          })
          .filter(({ old }) => old);
        const exits = [...calendar.querySelectorAll(".agenda-chip-view-exit")];
        sample(0);
        const startError = Math.max(
          ...visible.flatMap(({ node, old }) => {
            const rect = node.getBoundingClientRect();
            return ["left", "top", "width", "height"].map((key) =>
              Math.abs(rect[key] - old.rect[key]),
            );
          }),
        );
        const sourceExits = exits.map((node) => ({
          node,
          rect: node.getBoundingClientRect().toJSON(),
        }));
        sample(520);
        const ends = visible.map(({ node }) =>
          node.getBoundingClientRect().toJSON(),
        );
        sample(130);
        const moving = visible.some(
          ({ node, old }) =>
            Math.abs(node.getBoundingClientRect().top - old.rect.top) > 1,
        );
        const fadingWhileMoving = sourceExits.filter(({ node, rect }) => {
          const next = node.getBoundingClientRect();
          const opacity = Number(getComputedStyle(node).opacity);
          return (
            opacity > 0 &&
            opacity < 1 &&
            Math.hypot(next.left - rect.left, next.top - rect.top) > 1
          );
        }).length;
        const hiddenExits = exits.filter((node) =>
          [
            ...calendar.querySelectorAll(
              ".agenda-packed-row .agenda-chip[hidden]",
            ),
          ].some((target) => target.dataset.agendaEdit === node.dataset.exitId),
        );
        sample(519);
        const endError = Math.max(
          ...visible.flatMap(({ node }, index) => {
            const rect = node.getBoundingClientRect();
            return ["left", "top", "width", "height"].map((key) =>
              Math.abs(rect[key] - ends[index][key]),
            );
          }),
        );
        const hiddenEndOpacity = Math.max(
          ...hiddenExits.map((node) => Number(getComputedStyle(node).opacity)),
        );
        const hiddenDestinationError = Math.max(
          ...hiddenExits.map((node) => {
            const target = [
              ...calendar.querySelectorAll(
                ".agenda-packed-row .agenda-chip[hidden]",
              ),
            ].find(
              (item) =>
                item.dataset.agendaEdit === node.dataset.exitId &&
                item.dataset.agendaSegmentStart === node.dataset.exitDate,
            );
            if (!target) return 0;
            const origin = target.parentElement.getBoundingClientRect();
            const rect = node.getBoundingClientRect();
            return Math.max(
              Math.abs(rect.left - origin.left - parseFloat(target.style.left)),
              Math.abs(rect.top - origin.top - parseFloat(target.style.top)),
            );
          }),
        );
        const duplicateTimeBlocks = calendar.querySelectorAll(
          ".agenda-week-return-exits .timetable-event",
        ).length;
        sample(200);
        document.querySelector("#agendaViewToggle").click();
        return {
          visible: visible.length,
          startError,
          endError,
          moving,
          fadingWhileMoving,
          hidden: hiddenExits.length,
          hiddenEndOpacity,
          hiddenDestinationError,
          duplicateTimeBlocks,
        };
      });
      assert.ok(result.visible >= 2, JSON.stringify(result));
      assert.ok(
        result.startError < 1,
        "Retained events start at their actual single-week position: " +
          JSON.stringify(result),
      );
      assert.ok(
        result.endError < 0.1,
        "Retained events arrive at their packed position: " +
          JSON.stringify(result),
      );
      assert.ok(result.moving, "Time blocks move into the packed row");
      assert.ok(
        result.hidden > 0 && result.fadingWhileMoving >= result.hidden,
        "Overflow events move and fade together: " + JSON.stringify(result),
      );
      assert.ok(result.hiddenEndOpacity < 0.01);
      assert.ok(
        result.hiddenDestinationError < 0.1,
        "Hidden events move toward their packed slot: " +
          JSON.stringify(result),
      );
      assert.equal(result.duplicateTimeBlocks, 0);
      await page.waitForFunction(
        () =>
          !document
            .querySelector("#calendar")
            .getAnimations({ subtree: true })
            .some((a) => a.pending || a.playState === "running"),
      );
      assert.equal(
        await page
          .locator(".agenda-chip-view-exits, .agenda-week-return-exits")
          .count(),
        0,
        "Interrupting the transition removes outgoing copies",
      );
      await page.evaluate(async () => {
        const saved =
          await WorkTimeApp.services.preferences.page.saveMotionMode("reduce");
        if (!saved.persisted)
          throw Error("Motion test preference did not persist");
      });
      for (let index = 0; index < 3; index++) {
        await page.locator("#agendaViewToggle").click();
        if (index === 1) {
          assert.equal(await page.locator(".timetable-divider").count(), 1);
          assert.equal(
            await page
              .locator(".timetable-divider")
              .evaluate((line) => line.getAnimations().length),
            0,
            "Reduced motion shows the divider immediately",
          );
        }
      }
      assert.equal(
        await page.locator("#agendaViewToggle").getAttribute("data-view"),
        "fortnight",
      );
      assert.equal(await page.locator(".agenda-chip-view-exits").count(), 0);
      assert.deepEqual(
        await orderOnDate("2026-10-28", allDayIds),
        singleOrder,
        "Fortnight preserves the single-week stable all-day order",
      );
      const gapIds = ["gap-long", "gap-reused"];
      assert.deepEqual(
        await orderOnDate("2026-11-03", gapIds),
        ["gap-long", "gap-reused"],
        "Reused single-week lanes keep their relative order in the second row",
      );
      await page.locator("#agendaViewToggle").click();
      assert.deepEqual(
        await orderOnDate("2026-10-28", allDayIds),
        singleOrder,
        "Three-week all-day order matches single week",
      );
      assert.deepEqual(await orderOnDate("2026-11-03", gapIds), [
        "gap-long",
        "gap-reused",
      ]);
      for (let index = 0; index < 2; index++)
        await page.locator("#agendaViewToggle").click();
      await page.locator("#nextMonth").click();
      assert.deepEqual(
        await orderOnDate("2026-11-03", gapIds),
        ["gap-long", "gap-reused"],
        "Single week and multiweek agree when an earlier ribbon leaves a gap",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Single-week to fortnight event destinations, simultaneous overflow movement/fade, interruption and reduced motion verified at desktop and mobile widths.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
