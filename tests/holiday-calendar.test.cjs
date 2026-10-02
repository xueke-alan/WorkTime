const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const context = {};
context.window = context;
vm.createContext(context);
for (const file of ["assets/js/core.js", "assets/js/payday.js"])
  vm.runInContext(
    file === "assets/js/core.js"
      ? require("./helpers/core-source.cjs").readCoreSource()
      : fs.readFileSync(file, "utf8"),
    context,
  );
const C = vm.runInContext("WorkTime", context);
const metadata = vm.runInContext("WorkCalendarData.metadata", context);
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
    if (info.label === "调休补班") {
      makeups++;
      assert(info.work);
      assert([0, 6].includes(date.getDay()));
    }
  }
  assert.equal(holidays, holidayCount, year + " holiday dates");
  assert.equal(makeups, makeupCount, year + " makeup dates");
  for (let month = 1; month <= 12; month++) {
    const result = context.Payday.calculate(year + "-" + C.pad(month) + "-01");
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
assert.equal(context.Payday.calculate("2019-01-01").calendarKnown, false);
console.log(
  "2020–2026 calendars passed: holiday/makeup totals, extension, cross-year, manual overrides and 84 payroll months.",
);
