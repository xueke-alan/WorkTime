"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const evidence = [];
  for (const width of [390, 1600])
    for (const reducedMotion of ["reduce", "no-preference"]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion,
      });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.install({ time: new Date("2026-10-04T12:00:00+08:00") });
      await page.goto(
        require("node:url").pathToFileURL(
          path.resolve(__dirname, "../index.html"),
        ).href,
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(() => {
        const D = WorkTimeApp.domain,
          state = D.state.defaultState();
        const view = {
          today: "2026-10-04",
          selected: "2026-10-04",
          viewYear: 2026,
          month: "2026-10",
          yearMode: true,
          batchMode: false,
          batchDays: new Set(),
        };
        const calendar = WorkTimeApp.ui.createCalendar({
          core: {
            calendarKnown: D.calendar.calendarKnown,
            hours: D.time.hours,
          },
          element: (id) => document.getElementById(id),
          escape: WorkTimeApp.ui.createElements(document).escape,
          getState: () => state,
          getView: () => view,
          numbers: WorkTimeApp.ui.numbers,
          document,
          year: WorkTimeApp.ui.year,
          weatherLayer: { refresh() {} },
          closeLeavePanel() {},
          updateNotificationEmptyState() {},
        });
        calendar.renderCalendar();
        const root = document.getElementById("calendar");
        const original = [...root.querySelectorAll("[data-year-date]")];
        const focused = root.querySelector('[data-year-date="2026-09-28"]');
        focused.focus();
        const before = document.activeElement.dataset.yearDate;
        const updates = [];
        for (const end of ["20:00", "19:00", "18:00"]) {
          state.days["2026-09-28"] = {
            actual: {
              start: "08:00",
              end,
              nextDay: false,
              effectiveMinutes: null,
            },
          };
          calendar.renderCalendar();
          const current = [...root.querySelectorAll("[data-year-date]")];
          updates.push({
            sameButtons: original.every(
              (button, index) => button === current[index],
            ),
            focusPreserved: document.activeElement === focused,
            connected: focused.isConnected,
            description: focused.getAttribute("aria-label"),
            total: root.querySelectorAll(".year-month-stats")[8].textContent,
          });
        }
        const content = root.innerHTML;
        calendar.renderCalendar();
        const noChange =
          content === root.innerHTML && document.activeElement === focused;
        view.viewYear = 2024;
        calendar.renderCalendar();
        return {
          before,
          updates,
          noChange,
          leapDays: root.querySelectorAll("[data-year-date]").length,
          leapDate: !!root.querySelector('[data-year-date="2024-02-29"]'),
          oldYearDisconnected: original.every((button) => !button.isConnected),
        };
      });
      assert.equal(result.before, "2026-09-28");
      for (const update of result.updates) {
        assert(
          update.sameButtons && update.focusPreserved && update.connected,
          "Year attendance updates preserve every date button and keyboard focus",
        );
        assert.match(update.description, /加班/);
      }
      assert.equal(
        new Set(result.updates.map((update) => update.description)).size,
        3,
        "Descriptions update with changed records",
      );
      assert.equal(
        new Set(result.updates.map((update) => update.total)).size,
        3,
        "Monthly statistics update with changed records",
      );
      assert(result.noChange && result.oldYearDisconnected && result.leapDate);
      assert.equal(result.leapDays, 366);
      assert.deepEqual(errors, []);
      evidence.push({ width, reducedMotion, ...result });
      await context.close();
    }
  fs.writeFileSync(
    path.resolve(__dirname, "../test-results/year-local-update.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    "Year local update passed: four actual-page cases, three changed records, every date node and focus retained; unchanged and leap-year transitions verified.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => browser?.close());
