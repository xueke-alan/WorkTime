"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { readCoreSource } = require("./helpers/core-source.cjs"),
  { buildPerformanceFixture } = require("../scripts/performance-fixtures.cjs");
const context = vm.createContext({ console, Date });
vm.runInContext(readCoreSource(), context);
for (const file of ["derived", "import-index"])
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../assets/js/services", file + ".js"),
      "utf8",
    ),
    context,
  );
const core = vm.runInContext("DomainTest", context),
  derivedService = vm.runInContext("WorkTimeApp.services.derived", context),
  indexService = vm.runInContext("WorkTimeApp.services.importIndex", context),
  plain = (value) => JSON.parse(JSON.stringify(value));
let state = buildPerformanceFixture(10).state,
  revision = 0,
  now = new Date("2026-09-30T07:59:00+08:00"),
  summaryCalls = 0,
  parseCalls = 0;
const derived = derivedService.create({
    core: {
      ...core,
      summary(...args) {
        summaryCalls++;
        return core.summary(...args);
      },
    },
    getState: () => state,
    getRevision: () => revision,
    now: () => now,
  }),
  C = derived.queries;
function compare(name, ...args) {
  assert.deepEqual(
    plain(C[name](state, ...args)),
    plain(core[name](state, ...args)),
    name,
  );
}
for (const [start, end] of [
  ["2026-09-01", "2026-09-30"],
  ["2016-10-01", "2026-09-30"],
  ["2024-02-01", "2024-02-29"],
]) {
  for (const name of [
    "summary",
    "countRestOvertimeDays",
    "selectOvertimeRequirement",
    "attendanceHoursThrough",
    "cumulativeAverageOvertime",
  ])
    compare(name, start, end);
  compare("targetPace", start, end, "2026-09-30", 120);
}
const beforeCalls = summaryCalls;
C.summary(state, "2026-09-01", "2026-09-30");
C.targetPace(state, "2026-09-01", "2026-09-30", "2026-09-30", 120);
assert.equal(
  summaryCalls,
  beforeCalls,
  "same revision reuses summary and target",
);
const preview = {
  ...state.days["2026-09-30"],
  leaveMinutes: 120,
  actual: {
    start: "08:00",
    end: "22:00",
    nextDay: false,
    effectiveMinutes: null,
  },
};
for (const name of ["attendanceHoursThrough", "cumulativeAverageOvertime"])
  compare(name, "2026-09-01", "2026-09-30", preview);
assert.equal(
  state.days["2026-09-30"].leaveMinutes || 0,
  0,
  "preview does not mutate state",
);
state.days["2026-09-30"] = preview;
revision++;
compare("summary", "2026-09-01", "2026-09-30");
state.settings = {
  ...state.settings,
  standardMinutes: state.settings.standardMinutes - 60,
};
revision++;
compare("targetPace", "2026-09-01", "2026-09-30", "2026-09-30", 120);
state = buildPerformanceFixture(1).state;
compare("summary", "2026-09-01", "2026-09-30");
delete state.days["2026-09-30"];
revision++;
compare("pendingWorkdays", "2026-09-01", "2026-09-30", "2026-09-30", now);
now = new Date("2026-09-30T09:00:00+08:00");
compare("pendingWorkdays", "2026-09-01", "2026-09-30", "2026-09-30", now);
let midnightSamples = 0;
const midnight = derivedService.create({
  core,
  getState: () => state,
  getRevision: () => revision,
  now: () => {
    midnightSamples++;
    return new Date(
      midnightSamples === 1
        ? "2026-09-30T23:59:59.999+08:00"
        : "2026-10-01T00:00:00.000+08:00",
    );
  },
});
assert.equal(
  midnight.queries.pendingWorkdays(state, "2026-09-30", "2026-09-30"),
  core.pendingWorkdays(
    state,
    "2026-09-30",
    "2026-09-30",
    "2026-09-30",
    new Date("2026-09-30T23:59:59.999+08:00"),
  ),
  "default business date and time use the same instant at midnight",
);
assert.equal(midnightSamples, 1, "one clock sample per pending query");
midnight.dispose();
const index = indexService.create({
    core: {
      ...core,
      parseText(...args) {
        parseCalls++;
        return core.parseText(...args);
      },
    },
  }),
  log = {
    id: "rejected",
    year: 2026,
    sources: [{ name: "raw", raw: "09/30\n08:00\n19:30" }],
    records: [],
  };
assert.deepEqual(plain(index.describe(log).acceptedDates), []);
assert.deepEqual(plain(index.describe(log).rawDates), ["2026-09-30"]);
assert.equal(index.logsForDate([log], "2026-09-30")[0], log);
assert.equal(index.logsForDate([log], "2026-09-30")[0], log);
assert.equal(parseCalls, 1, "raw sources parse once per immutable log");
assert.deepEqual(
  plain(core.importRecords(log)),
  [],
  "rejected records never become replay input",
);
assert.equal(
  index.logsForDate([], "2026-09-30").length,
  0,
  "deleted log removed from lookup",
);
index.dispose();
derived.dispose();
console.log(
  "derived-services: range equivalence, reuse, preview, revision/settings/restore invalidation, clock boundary and raw/accepted separation passed",
);
