"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const ctx = vm.createContext({});
vm.runInContext(require("./helpers/core-source.cjs").readCoreSource(), ctx);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../assets/js/imports.js"), "utf8"),
  ctx,
);
const C = vm.runInContext("DomainTest", ctx),
  I = vm.runInContext("WorkTimeApp.services.imports", ctx);
const state = C.defaultState(),
  date = "2026-09-28";
state.days[date] = {
  oa: {
    date,
    start: "08:00",
    end: "17:30",
    nextDay: false,
    status: "complete",
  },
};
const original = JSON.stringify(state),
  raw = "09/28\n08:00\n20:00";
for (const name of ["粘贴文本", "剪贴板"]) {
  const plan = I.prepare(C, state, [{ name, raw }], 2026);
  assert.equal(plan.needsReview, true);
  assert.equal(I.acceptedRecords(plan, () => "old").length, 0);
  assert.equal(I.acceptedRecords(plan, () => "new")[0].end, "20:00");
  assert.equal(JSON.stringify(state), original);
  const rejected = {
    id: "rejected",
    records: I.acceptedRecords(plan, () => "old"),
    sources: [{ name, raw }],
    year: 2026,
  };
  assert.equal(C.importRecords(rejected).length, 0);
}
assert.equal(
  I.prepare(C, state, [{ name: "duplicate", raw: "09/28\n08:00\n17:30" }], 2026)
    .needsReview,
  false,
);
assert.equal(
  I.prepare(C, state, [{ name: "warning", raw: "09/28\n08:00\n07:00" }], 2026)
    .needsReview,
  true,
);
const combined = I.prepare(
  C,
  C.defaultState(),
  [{ name: "same-batch", raw: raw + "\n09/28\n08:00\n21:00" }],
  2026,
);
assert.equal(combined.rows[1].old.end, "20:00");
assert.equal(combined.rows[1].result.conflict, true);
const repeatedRejected = I.prepare(
  C,
  state,
  [{ name: "duplicates", raw: raw + "\n" + raw }],
  2026,
);
assert.equal(repeatedRejected.rows[1].result.conflict, true);
assert.equal(I.acceptedRecords(repeatedRejected, () => "old").length, 0);
const crossYearDates = [
  "12/30",
  "12/31",
  "01/01",
  "01/02",
  "01/03",
  "01/04",
  "01/05",
];
const oaText = (dates) =>
  dates.map((date) => date + "\n08:00\n17:30").join("\n");
const expected = [
  "2026-12-30",
  "2026-12-31",
  "2027-01-01",
  "2027-01-02",
  "2027-01-03",
  "2027-01-04",
  "2027-01-05",
];
for (const dates of [crossYearDates, [...crossYearDates].reverse()]) {
  const plan = I.prepare(
    C,
    C.defaultState(),
    [{ name: "跨年", raw: oaText(dates) }],
    2027,
    "2027-01-05",
  );
  assert.deepEqual(
    Array.from(plan.records, (record) => record.date).sort(),
    expected,
  );
  assert.equal(plan.needsReview, true, "Inferred years require confirmation");
  assert.equal(plan.warnings.length, 2);
}
const parseAt = (dates, today) =>
  C.parseText(oaText(dates), Number(today.slice(0, 4)), "测试", today);
assert.equal(parseAt(["12/31"], "2027-01-05").records[0].date, "2026-12-31");
assert.equal(parseAt(["12/31"], "2027-01-31").records[0].date, "2026-12-31");
assert.equal(parseAt(["12/31"], "2027-02-01").records[0].date, "2027-12-31");
assert.match(parseAt(["12/31"], "2027-02-01").warnings[0], /无法可靠推断/);
assert.equal(parseAt(["01/06"], "2027-01-05").records[0].date, "2027-01-06");
assert.equal(parseAt(["02/29"], "2027-01-05").records.length, 0);
assert.equal(parseAt(["12/30", "01/05"], "2027-01-05").records.length, 2);
assert.equal(
  C.parseText(oaText(["12/31"]), 2027).records[0].date,
  "2027-12-31",
  "Historical parsing without an anchor remains unchanged",
);
assert.match(
  C.parseText(
    "12/31\n星期四\n08:00\n17:30",
    2027,
    "测试",
    "2027-01-05",
  ).warnings.join("\n"),
  /跨年/,
);
assert.equal(
  C.parseText("12/31\n星期四\n08:00\n17:30", 2027, "测试", "2027-01-05")
    .warnings.length,
  1,
  "Weekday validates against the inferred year",
);
console.log(
  "Import planning passed: shared policy, explicit conflicts, immutable preview, accepted-only history and same-batch observations.",
);
