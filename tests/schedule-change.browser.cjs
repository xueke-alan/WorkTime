"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");

let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [2250, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 1244 },
      timezoneId: "Asia/Shanghai",
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.install({ time: new Date("2026-10-04T12:00:00+08:00") });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const fixture = await page.evaluate(() => {
      const state = WorkTimeApp.domain.state.defaultState();
      const base = state.settings;
      const shifted = WorkTimeApp.domain.schedule.validateSchedule({
        ...base,
        workStart: "08:30",
        workEnd: "18:00",
        breaks: [
          { start: 720, end: 810 },
          { start: 1080, end: 1110 },
        ],
        standardMinutes: undefined,
      });
      const rests = WorkTimeApp.domain.schedule.validateSchedule({
        ...base,
        breaks: [
          { start: 780, end: 870 },
          { start: 1050, end: 1080 },
        ],
      });
      state.scheduleRanges = [
        { start: "2026-09-30", end: "2026-10-02", schedule: shifted },
        { start: "2026-10-04", end: "2026-10-06", schedule: shifted },
        { start: "2026-10-08", end: "2026-10-09", schedule: rests },
        {
          start: "2026-10-12",
          end: "2026-10-13",
          schedule: WorkTimeApp.domain.schedule.validateSchedule({
            ...base,
            breaks: [...base.breaks].reverse(),
          }),
        },
        { start: "2026-10-31", end: "2026-10-31", schedule: shifted },
      ];
      state.days["2026-10-04"] = { plannedOvertime: true };
      return state;
    });
    assert.equal(
      fixture.scheduleRanges[0].schedule.standardMinutes,
      fixture.settings.standardMinutes,
      "Changing start/end times with unchanged total hours still needs a tag",
    );
    async function restore(state) {
      await page.locator("#backupFile").setInputFiles({
        name: "schedule.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(state)),
      });
      await page.locator("#restoreDialog").waitFor({ state: "visible" });
      await page.locator("#confirmRestore").click();
    }
    await restore(fixture);
    const markers = await page
      .locator("#calendar .schedule-change-tag")
      .evaluateAll((tags) =>
        tags.map((tag) => {
          const card = tag.closest(".day");
          return card.dataset.date || card.dataset.previewDate;
        }),
      );
    assert.deepEqual(markers, [
      "2026-09-30",
      "2026-10-03",
      "2026-10-04",
      "2026-10-07",
      "2026-10-08",
      "2026-10-10",
      "2026-10-31",
      "2026-11-01",
    ]);
    const changed = page.locator('[data-date="2026-10-04"]');
    assert.match(await changed.getAttribute("aria-label"), /工时变更/);
    assert.match(
      await changed.locator(".daystatus").textContent(),
      /计划加班.*工时变更/,
    );
    assert.ok(
      await changed.locator(".schedule-change-tag").evaluate((tag) => {
        const card = tag.closest(".day").getBoundingClientRect();
        const status = tag.closest(".daystatus").getBoundingClientRect();
        return (
          status.left >= card.left &&
          status.right <= card.right + 1 &&
          status.bottom <= card.bottom
        );
      }),
    );
    await page.locator("#batchToggle").click();
    assert.equal(await changed.locator(".schedule-change-tag").count(), 1);
    await page.locator("#batchCancel").click();
    await restore(
      await page.evaluate(() => WorkTimeApp.domain.state.defaultState()),
    );
    assert.equal(
      await page.locator("#calendar .schedule-change-tag").count(),
      0,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Schedule change tags: effective transitions, same-hour shifts, rest changes, equivalent schedules, month boundaries, batch mode and restore passed.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => browser?.close());
