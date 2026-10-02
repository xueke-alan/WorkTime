"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=WorkTime",
  context,
);
const C = context.C;
const plain = (value) => JSON.parse(JSON.stringify(value));
function roundTrip(state) {
  const first = C.validateBackup(plain(state));
  const second = C.validateBackup(plain(first));
  assert.deepEqual(plain(second), plain(first));
  assert.deepEqual(
    plain(C.summary(second, "2026-09-01", "2026-09-30")),
    plain(C.summary(first, "2026-09-01", "2026-09-30")),
  );
  return first;
}
roundTrip(C.defaultState());
const inconsistent = C.defaultState();
inconsistent.settings = {
  ...inconsistent.settings,
  workStart: "08:00",
  workEnd: "12:00",
  standardMinutes: 480,
  breaks: [],
};
inconsistent.days["2026-09-28"] = { leaveMinutes: 480 };
assert.throws(() => C.validateBackup(inconsistent), /leaveMinutes/);
inconsistent.days["2026-09-28"].leaveMinutes = 240;
assert.equal(roundTrip(inconsistent).settings.standardMinutes, 240);
const invalidOA = C.defaultState(),
  date = "2026-09-28";
invalidOA.days[date] = {
  oa: {
    date,
    start: "",
    end: "",
    nextDay: false,
    status: "complete",
    effectiveMinutes: 480,
  },
};
assert.throws(() => C.validateBackup(invalidOA), /oa.effectiveMinutes/);
for (const name of ["actual", "estimate"]) {
  const state = C.defaultState();
  state.days[date] = {
    [name]: { start: "", end: "", nextDay: false, effectiveMinutes: 480 },
    leaveMinutes: 60,
  };
  assert.equal(roundTrip(state).days[date][name].effectiveMinutes, 480);
}
const old = C.defaultState();
delete old.overtimeRequirements;
delete old.timeTemplates;
delete old.settings.workStart;
delete old.settings.workEnd;
assert.equal(roundTrip(old).settings.standardMinutes, 480);
const overlapping = C.defaultState();
overlapping.settings.breaks = [
  { start: 720, end: 780 },
  { start: 750, end: 810 },
];
roundTrip(overlapping);
console.log(
  "Backup integrity passed: normalized leave bounds, OA field contract, manual corrections, legacy migration and round-trip invariants.",
);
