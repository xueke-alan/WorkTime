"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  { readCoreSource } = require("./helpers/core-source.cjs");
const realm = vm.createContext({ Date });
vm.runInContext(readCoreSource(), realm);
vm.runInContext(
  fs.readFileSync("assets/js/services/derived.js", "utf8"),
  realm,
);
const C = vm.runInContext("DomainTest", realm),
  Derived = vm.runInContext("WorkTimeApp.services.derived", realm),
  plain = (x) => JSON.parse(JSON.stringify(x));
const baseline = C.defaultState(),
  a = C.validateSchedule({
    workStart: "09:00",
    workEnd: "17:30",
    breaks: [{ start: 720, end: 810 }],
  }),
  b = C.validateSchedule({
    workStart: "08:00",
    workEnd: "16:30",
    breaks: [{ start: 720, end: 810 }],
  }),
  c = C.validateSchedule({
    workStart: "10:00",
    workEnd: "17:30",
    breaks: [{ start: 720, end: 810 }],
  });
let state = C.applyScheduleRange(baseline, a, "2026-09-01", null);
state = C.applyScheduleRange(state, b, "2026-11-01", null);
const before = JSON.stringify(state);
const temporary = C.applyScheduleRange(state, c, "2026-10-28", "2026-11-03");
assert.equal(
  JSON.stringify(state),
  before,
  "interval replacement is immutable",
);
for (const [date, minutes] of [
  ["2026-10-27", 420],
  ["2026-10-28", 360],
  ["2026-11-03", 360],
  ["2026-11-04", 420],
])
  assert.equal(C.scheduleForDate(temporary, date).standardMinutes, minutes);
assert.equal(C.scheduleForDate(temporary, "2026-11-04").workStart, "08:00");
const all = C.applyScheduleRange(temporary, c, null, null);
assert.equal(all.scheduleRanges.length, 0);
assert.equal(C.scheduleForDate(all, "1900-01-01").workStart, "10:00");
assert.equal(
  C.applyScheduleRange(
    C.applyScheduleRange(baseline, a, "2026-09-01", "2026-09-03"),
    a,
    "2026-09-04",
    "2026-09-06",
  ).scheduleRanges.length,
  1,
);
assert.equal(
  C.applyScheduleRange(state, baseline.settings, "2026-09-01", null)
    .scheduleRanges.length,
  0,
);
for (const [choice, today, end] of [
  ["week", "2026-12-29", "2027-01-04"],
  ["week", "2024-02-27", "2024-03-04"],
  ["month", "2024-02-01", "2024-02-29"],
  ["month", "2026-10-31", "2026-10-31"],
])
  assert.equal(C.scheduleRangeForChoice(choice, today).end, end);
assert.throws(() =>
  C.scheduleRangeForChoice("custom", "2026-01-01", "2026-02-02", "2026-02-01"),
);
assert.throws(() => C.scheduleRangeForChoice("week", "9999-12-31"));
// Compare repeated interval replacements to an independent day-by-day oracle.
let random = 17;
const next = () => {
  random = (random * 1664525 + 1013904223) >>> 0;
  return random;
};
let current = baseline;
const oracle = Array(60).fill(baseline.settings.workStart),
  dates = oracle.map((_, i) => C.dateKey(new Date(2026, 0, i + 1, 12)));
for (let i = 0; i < 120; i++) {
  const left = next() % 60,
    right = left + (next() % (60 - left)),
    schedule = [a, b, c][next() % 3];
  current = C.applyScheduleRange(current, schedule, dates[left], dates[right]);
  for (let j = left; j <= right; j++) oracle[j] = schedule.workStart;
  assert.deepEqual(
    dates.map((d) => C.scheduleForDate(current, d).workStart),
    oracle,
  );
  C.validateBackup(current);
}
const legacy = plain(baseline);
legacy.schemaVersion = 1;
delete legacy.scheduleRanges;
assert.throws(
  () => C.validateBackup(legacy),
  (error) => error.code === "UNSUPPORTED_VERSION",
);
assert.deepEqual(plain(C.validateBackup(temporary)), plain(temporary));
for (const mutate of [
  (s) => s.scheduleRanges.reverse(),
  (s) => (s.scheduleRanges[0].end = "2026-01-01"),
  (s) => (s.scheduleRanges[0].schedule.standardMinutes = 1),
  (s) => delete s.scheduleRanges,
]) {
  const bad = plain(temporary);
  mutate(bad);
  assert.throws(
    () => C.validateBackup(bad),
    (e) => e.path.startsWith("scheduleRanges"),
  );
}
// Two full/partial workdays with independent hand-calculated denominators.
let mixed = C.applyScheduleRange(baseline, a, "2026-09-09", null);
mixed.days = {
  "2026-09-08": {
    actual: {
      start: "08:00",
      end: "18:30",
      nextDay: false,
      effectiveMinutes: 540,
    },
  },
  "2026-09-09": {
    actual: {
      start: "09:00",
      end: "18:30",
      nextDay: false,
      effectiveMinutes: 480,
    },
    leaveMinutes: 210,
  },
};
const summary = C.summary(mixed, "2026-09-08", "2026-09-09");
assert.equal(summary.workOvertime, 330);
assert.equal(summary.attendance, 1.5);
assert.equal(summary.average, 220);
const totals = C.attendanceHoursThrough(mixed, "2026-09-08", "2026-09-09");
assert.equal(totals.expectedMinutes, 690);
assert.equal(totals.expectedDays, 1.5);
assert.equal(totals.workedMinutes, 1020);
assert(Math.abs(totals.workedDays - (540 / 480 + 480 / 420)) < 1e-10);
assert.equal(
  C.cumulativeAverageOvertime(mixed, "2026-09-08", "2026-09-09")["2026-09-09"]
    .averageMinutes,
  220,
);
const cached = Derived.create({
  core: C,
  getState: () => mixed,
  getRevision: () => 0,
}).queries;
for (const name of ["attendanceHoursThrough", "cumulativeAverageOvertime"])
  assert.deepEqual(
    plain(
      cached[name](mixed, "2026-09-08", "2026-09-09", mixed.days["2026-09-09"]),
    ),
    plain(C[name](mixed, "2026-09-08", "2026-09-09", mixed.days["2026-09-09"])),
  );
assert.equal(
  C.targetPace(mixed, "2026-09-08", "2026-09-09", "2026-09-09", 120).difference,
  -150,
);
const leave = C.defaultState();
leave.days = {
  "2026-09-08": { leaveMinutes: 480 },
  "2026-09-09": { leaveMinutes: 480 },
};
assert.throws(
  () => C.applyScheduleRange(leave, c, "2026-09-08", null),
  /2026-09-08、2026-09-09/,
);
assert.doesNotThrow(() => C.applyScheduleRange(leave, c, "2026-09-10", null));
const badLeave = plain(
  C.applyScheduleRange(baseline, c, "2026-09-08", "2026-09-08"),
);
badLeave.days["2026-09-08"] = { leaveMinutes: 480 };
assert.throws(
  () => C.validateBackup(badLeave),
  (e) => e.path === "days.2026-09-08.leaveMinutes",
);
const overnight = { actual: { start: "20:00", end: "06:00", nextDay: true } };
assert.equal(
  C.calculate(
    "2026-09-08",
    overnight,
    C.scheduleForDate(mixed, "2026-09-08"),
    true,
  ).minutes,
  600,
);
assert.doesNotThrow(() =>
  C.applyScheduleRange(state, c, "1900-01-01", "9999-12-31"),
);
assert.equal(
  C.applyScheduleRange(baseline, c, "1900-01-01", "1900-01-01")
    .scheduleRanges[0].start,
  "1900-01-01",
);
console.log(
  "Schedules passed: interval oracle, boundaries, unsupported schema rejection, validation, mixed statistics, cache, leave and midnight records.",
);
