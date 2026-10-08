const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const c = {};
c.window = c;
vm.createContext(c);
vm.runInContext(require("./helpers/core-source.cjs").readCoreSource(), c);
for (const file of ["assets/js/date-info.js", "assets/js/payday.js"])
  vm.runInContext(fs.readFileSync(file, "utf8"), c);
const C = vm.runInContext("DomainTest", c),
  calculate = vm.runInContext("WorkTimeApp.domain.payday", c).calculate;
assert.equal(calculate("2026-10-02").date, "2026-10-15");
assert.equal(calculate("2026-02-01").date, "2026-02-14"); // Spring Festival; Saturday is a makeup workday.
assert.equal(calculate("2026-03-01").date, "2026-03-13"); // Sunday -> Friday.
assert.equal(calculate("2026-08-01").date, "2026-08-14"); // Saturday -> Friday.
assert.equal(calculate("2026-11-30").date, "2026-11-13");
assert.equal(calculate("2026-02-28").date, calculate("2026-02-01").date);
for (let month = 1; month <= 12; month++) {
  const result = calculate("2026-" + String(month).padStart(2, "0") + "-01");
  assert(C.calendarInfo(result.date).work);
  assert(result.date <= result.scheduled);
  const next = C.localDate(result.date);
  next.setDate(next.getDate() + 1);
  while (C.dateKey(next) <= result.scheduled) {
    assert(!C.calendarInfo(C.dateKey(next)).work);
    next.setDate(next.getDate() + 1);
  }
}
const calendar = vm.runInContext("WorkTimeApp.domain.calendar", c),
  original = calendar.calendarInfo;
try {
  calendar.calendarInfo = (date) => ({
    work:
      !["2026-01-15", "2026-01-14", "2026-01-13"].includes(date) &&
      original(date).work,
  });
  vm.runInContext(fs.readFileSync("assets/js/payday.js", "utf8"), c);
  assert.equal(
    vm.runInContext("WorkTimeApp.domain.payday", c).calculate("2026-01-01")
      .date,
    "2026-01-12",
  );
} finally {
  calendar.calendarInfo = original;
  vm.runInContext(fs.readFileSync("assets/js/payday.js", "utf8"), c);
}
assert.equal(calculate("2027-01-01").calendarKnown, false);
assert.equal(calculate("2026-02-01").shiftedDays, 1);
const dateInfo = vm.runInContext("WorkTimeApp.services.dateInfo", c);
assert(!dateInfo.list().some((provider) => provider.id === "payday"));
assert.equal(dateInfo.getContent("payday", "2026-02-01").ok, false);
assert.throws(() => calculate("2026-02-30"));
console.log(
  "Payday rules passed: weekdays, weekends, holiday, makeup workday, consecutive holidays, all 2026 months and no standalone provider.",
);
