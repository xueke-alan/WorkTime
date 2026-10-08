"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm");
const realm = vm.createContext({});
vm.runInContext(require("./helpers/core-source.cjs").readCoreSource(), realm);
const calculate = vm.runInContext("DomainTest.employmentDay", realm);
for (const [start, selected, started, days] of [
  ["2026-10-04", "2026-10-04", true, 1],
  ["2026-10-04", "2026-10-05", true, 2],
  ["2026-10-04", "2026-10-03", false, 1],
  ["2024-02-28", "2024-03-01", true, 3],
  ["2026-02-28", "2026-03-01", true, 2],
  ["2024-03-01", "2024-02-28", false, 2],
  ["2026-12-31", "2027-01-01", true, 2],
  ["2026-03-07", "2026-03-09", true, 3],
  ["2026-10-31", "2026-11-02", true, 3],
]) {
  const result = calculate(start, selected);
  assert.equal(result.started, started);
  assert.equal(result.days, days);
  assert.notEqual(
    result,
    calculate(start, selected),
    "No mutable shared result",
  );
}
for (const start of ["", "2026-02-30", "2026-1-01", "1899-12-31"])
  assert.equal(calculate(start, "2026-10-05"), null);
assert.equal(calculate("2026-10-05", "2026-02-30"), null);
console.log(
  "Employment day passed: inclusive first day, future distance, leap/month/year and DST boundaries, invalid input and independent results.",
);
