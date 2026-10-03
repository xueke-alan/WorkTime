"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  { readCoreSource } = require("./helpers/core-source.cjs");
const context = vm.createContext({ Date });
vm.runInContext(readCoreSource(), context);
vm.runInContext(
  fs.readFileSync("assets/js/services/derived.js", "utf8"),
  context,
);
const C = vm.runInContext("WorkTime", context),
  Derived = vm.runInContext("WorkDerived", context),
  state = C.defaultState();
state.settings.configured = true;
state.settings.standardMinutes = 480;
const dates = [];
for (let i = 1; i <= 30; i++) {
  const date = "2026-09-" + String(i).padStart(2, "0");
  if (C.calendarInfo(date, {}).work) dates.push(date);
}
assert.equal(dates.length, 22);
for (const date of dates.slice(0, 21))
  state.days[date] = {
    actual: {
      start: "08:00",
      end: "19:04",
      nextDay: false,
      effectiveMinutes: 574,
    },
  };
state.days["2026-09-30"] = {
  oa: { status: "pending", start: "08:55", end: null },
};
let revision = 0;
const cached = Derived.create({
  core: C,
  getState: () => state,
  getRevision: () => revision,
}).core;
const plain = (value) => JSON.parse(JSON.stringify(value));
function verify(end = "2026-09-30", preview) {
  const direct = C.cumulativeAverageOvertime(state, "2026-09-01", end, preview);
  assert.deepEqual(
    plain(cached.cumulativeAverageOvertime(state, "2026-09-01", end, preview)),
    plain(direct),
  );
  const total = C.summary(state, "2026-09-01", end);
  if (!preview && direct[end].averageMinutes !== null)
    assert(Math.abs(direct[end].averageMinutes - total.average) < 1e-9);
  return direct;
}
const pending = verify();
assert.equal((pending["2026-09-29"].averageMinutes / 60).toFixed(2), "1.57");
assert.equal(pending["2026-09-30"].averageMinutes, null);
assert.equal(pending["2026-09-30"].scheduledMinutes, 21 * 480);
assert.equal(
  (C.summary(state, "2026-09-01", "2026-09-30").average / 60).toFixed(3),
  "1.567",
);
verify("2026-09-30", { actual: { effectiveMinutes: 570 }, leaveMinutes: 120 });
state.days["2026-09-30"] = {
  estimate: { start: "08:00", end: "19:00", nextDay: false },
  leaveMinutes: 120,
};
revision++;
assert(verify()["2026-09-30"].averageMinutes !== null);
state.days["2026-09-30"] = { leaveMinutes: 480 };
revision++;
assert.equal(verify()["2026-09-30"].averageMinutes, 94);
state.days["2026-09-30"] = {
  draft: { start: "18:00", end: "08:00", nextDay: false },
};
revision++;
assert.equal(verify()["2026-09-30"].averageMinutes, null);
// A missing date does not prevent a subsequent completed workday from contributing.
delete state.days["2026-09-29"];
state.days["2026-09-30"] = { actual: { effectiveMinutes: 574 } };
revision++;
assert.equal(verify()["2026-09-30"].averageMinutes, 94);
assert.equal(verify("2026-09-26")["2026-09-26"].pending, false);
assert(verify("2026-09-26")["2026-09-26"].averageMinutes !== null);
delete state.days["2026-09-30"];
revision++;
assert.equal(verify()["2026-09-30"].averageMinutes, null);
console.log(
  "Cumulative average passed: incomplete dates, partial/full leave, rest days, manual records, shifted workdays, anomaly and cache/preview invalidation.",
);
