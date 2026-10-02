const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const c = {};
c.window = c;
vm.createContext(c);
for (const file of [
  "assets/js/core.js",
  "assets/js/date-info.js",
  "assets/js/payday.js",
])
  vm.runInContext(
    file === "assets/js/core.js"
      ? require("./helpers/core-source.cjs").readCoreSource()
      : fs.readFileSync(file, "utf8"),
    c,
  );
const C = vm.runInContext("WorkTime", c),
  calculate = c.Payday.calculate;
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
const original = C.calendarInfo;
try {
  C.calendarInfo = (date) => ({
    work:
      !["2026-01-15", "2026-01-14", "2026-01-13"].includes(date) &&
      original(date).work,
  });
  assert.equal(calculate("2026-01-01").date, "2026-01-12");
} finally {
  C.calendarInfo = original;
}
assert.equal(calculate("2027-01-01").calendarKnown, false);
assert.equal(calculate("2026-02-01").shiftedDays, 1);
assert(!c.DateInfo.list().some((provider) => provider.id === "payday"));
assert.equal(c.DateInfo.getContent("payday", "2026-02-01").ok, false);
assert.throws(() => calculate("2026-02-30"));
console.log(
  "Payday rules passed: weekdays, weekends, holiday, makeup workday, consecutive holidays, all 2026 months and no standalone provider.",
);
