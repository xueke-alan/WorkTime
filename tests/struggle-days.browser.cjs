"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=DomainTest;globalThis.calendar=WorkTimeApp.domain.calendar;",
  context,
);
const dates = [...vm.runInContext("WorkTimeApp.data.struggleDays", context)];
assert.equal(dates.length, 12);
for (const [index, date] of dates.entries()) {
  const d = new Date(date + "T00:00:00Z");
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), index);
  assert.equal(d.getUTCDay(), 6);
  d.setUTCDate(d.getUTCDate() + 7);
  assert.notEqual(
    d.getUTCMonth(),
    index,
    "Only the month's final Saturday is listed",
  );
  assert.equal(context.C.calendarInfo(date).label, "奋斗日");
  assert.equal(
    context.C.calendarInfo(date).work,
    context.calendar.makeups.has(date),
  );
  assert.equal(
    context.C.calendarInfo(date).weekend,
    !context.calendar.makeups.has(date),
  );
  assert.equal(
    context.C.calendarInfo(date, { kind: "work" }).label,
    "工作日 · 手动",
  );
}
assert.equal(context.C.calendarInfo("2026-10-24").label, "周末");
assert.equal(context.C.calendarInfo("2026-10-01").label, "国庆");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 2250, height: 1244 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:/, (r) => r.abort());
  await page.clock.install({ time: new Date("2026-10-31T12:00:00+08:00") });
  await page.goto(pathToFileURL(path.resolve("index.html")).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  for (let i = 0; i < 9; i++) await page.locator("#prevMonth").click();
  for (const date of dates) {
    const card = page.locator(`[data-date="${date}"]`);
    assert.match(await card.textContent(), /奋斗日/);
    assert.match(await card.getAttribute("aria-label"), /奋斗日/);
    assert.equal(
      await page
        .locator("#calendar button.day[data-date]")
        .filter({ hasText: "奋斗日" })
        .count(),
      1,
    );
    await page.locator("#nextMonth").click();
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "Simulated struggle days: all 12 final Saturdays, labels, manual overrides, ordinary weekends and offline calendar passed.",
  );
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
