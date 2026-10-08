const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const context = {};
context.window = context;
vm.createContext(context);
vm.runInContext(require("./helpers/core-source.cjs").readCoreSource(), context);
vm.runInContext(fs.readFileSync("assets/js/payday.js", "utf8"), context);
const C = vm.runInContext("DomainTest", context);
const metadata = vm.runInContext(
  "WorkTimeApp.data.calendars.metadata",
  context,
);
assert.deepEqual(Array.from(metadata.coverage), [2020, 2026]);
assert.equal(metadata.timezone, "Asia/Shanghai");
for (let year = 2020; year <= 2026; year++) {
  assert(C.validDate(metadata.sources[year].publishedAt));
  assert(metadata.sources[year].urls.length);
  for (const url of metadata.sources[year].urls)
    assert.equal(new URL(url).protocol, "https:");
}
const expected = {
  2020: [30, 6],
  2021: [31, 7],
  2022: [32, 7],
  2023: [26, 7],
  2024: [30, 8],
  2025: [28, 5],
  2026: [33, 6],
};
for (const [year, [holidayCount, makeupCount]] of Object.entries(expected)) {
  let holidays = 0,
    makeups = 0;
  for (
    let date = C.localDate(year + "-01-01");
    C.dateKey(date).startsWith(year + "-");
    date.setDate(date.getDate() + 1)
  ) {
    const info = C.calendarInfo(C.dateKey(date));
    if (info.holiday) {
      holidays++;
      assert(!info.work);
    }
    if (info.makeup) {
      makeups++;
      assert(info.work);
      assert([0, 6].includes(date.getDay()));
    }
  }
  assert.equal(holidays, holidayCount, year + " holiday dates");
  assert.equal(makeups, makeupCount, year + " makeup dates");
  for (let month = 1; month <= 12; month++) {
    const result = vm
      .runInContext("WorkTimeApp.domain.payday", context)
      .calculate(year + "-" + C.pad(month) + "-01");
    assert(result.calendarKnown);
    assert(C.calendarInfo(result.date).work);
  }
}
assert.equal(C.calendarInfo("2020-02-01").holiday, "春节");
assert.equal(C.calendarInfo("2020-02-03").work, true);
assert.equal(C.calendarInfo("2022-12-31").holiday, "元旦");
assert.equal(C.calendarInfo("2024-02-09").work, true);
assert.equal(C.calendarInfo("2025-09-28").work, true);
assert.equal(C.calendarInfo("2021-02-12", { kind: "work" }).work, true);
assert.equal(C.calendarInfo("2021-02-07", { kind: "rest" }).work, false);
assert.equal(
  vm.runInContext("WorkTimeApp.domain.payday", context).calculate("2019-01-01")
    .calendarKnown,
  false,
);
// Festival dates exist independently of published holiday/makeup schedules.
for (const [date, name] of [
  ["2027-01-01", "元旦"],
  ["2027-02-06", "春节"],
  ["2027-04-05", "清明"],
  ["2027-05-01", "劳动节"],
  ["2027-06-09", "端午"],
  ["2027-09-15", "中秋"],
  ["2027-10-01", "国庆"],
]) {
  const info = C.calendarInfo(date);
  assert.equal(C.calendarKnown(date), false);
  assert.equal(info.label, name);
  assert.equal(info.holiday, "", "Festival names do not create days off");
  assert.equal(info.makeup, false);
  assert.equal(info.work, ![0, 6].includes(C.localDate(date).getDay()));
}
assert.equal(C.calendarInfo("2027-10-02").label, "周末");
assert.equal(
  C.calendarInfo("2027-06-09", { kind: "rest" }).label,
  "休息日 · 手动",
);
assert.equal(C.calendarInfo("2027-05-01", { kind: "work" }).work, true);
assert.equal(C.festivalName("2020-10-01"), "国庆、中秋");
assert.equal(
  C.festivalName("2027-02-20"),
  "",
  "Lantern Festival is outside the requested seven categories",
);
assert.equal(C.festivalName("2200-01-01"), "元旦");
assert.equal(C.festivalName("2200-02-01"), "");
assert.equal(
  fs.readFileSync("assets/data/major-festivals.js", "utf8"),
  require("../scripts/sync-major-festivals.cjs").build(),
  "Offline festival table matches the bundled lunar library",
);
console.log(
  "2020–2026 calendars passed: holiday/makeup totals, extension, cross-year, manual overrides and 84 payroll months.",
);
