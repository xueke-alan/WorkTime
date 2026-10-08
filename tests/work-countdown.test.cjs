const assert = require("assert"),
  vm = require("vm"),
  fs = require("fs");
const c = {};
c.window = c;
vm.createContext(c);
vm.runInContext(require("./helpers/core-source.cjs").readCoreSource(), c);
for (const p of ["assets/js/date-info.js", "assets/js/work-countdown.js"])
  vm.runInContext(fs.readFileSync(p, "utf8"), c);
const C = vm.runInContext("DomainTest", c);
const s = C.defaultState(),
  calc = (date) =>
    vm
      .runInContext("WorkTimeApp.services.countdown", c)
      .calculate(s, new Date(date));
assert.strictEqual(calc("2026-10-08T16:30:00+08:00").time, "01:00:00");
assert.strictEqual(calc("2026-10-08T17:30:00+08:00").status, "done");
assert.strictEqual(calc("2026-10-01T12:00:00+08:00").status, "rest");
s.days["2026-10-01"] = { plannedOvertime: true };
assert.strictEqual(calc("2026-10-01T12:00:00+08:00").status, "counting");
s.days["2026-10-08"] = { leaveMinutes: 480 };
assert.strictEqual(calc("2026-10-08T12:00:00+08:00").status, "leave");
delete s.days["2026-10-08"];
s.timeTemplates = [
  { name: "常规下班", start: "08:00", end: "18:00", nextDay: false },
];
assert.strictEqual(calc("2026-10-08T17:00:00+08:00").time, "00:30:00");
s.timeTemplates[0] = {
  name: "常规下班",
  start: "20:00",
  end: "06:00",
  nextDay: true,
};
assert.strictEqual(calc("2026-10-08T23:00:00+08:00").status, "done");
assert.strictEqual(calc("2026-10-07T16:00:00Z").date, "2026-10-08");
console.log("Countdown rules passed");
