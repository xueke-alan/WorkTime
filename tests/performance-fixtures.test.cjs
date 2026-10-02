"use strict";
const assert = require("node:assert/strict");
const {
  buildPerformanceFixture,
} = require("../scripts/performance-fixtures.cjs");
for (const [years, days] of [
  [1, 365],
  [5, 1826],
  [10, 3652],
]) {
  const fixture = buildPerformanceFixture(years);
  assert.equal(fixture.metadata.days, days);
  assert.equal(fixture.metadata.imports, years * 12);
  assert.equal(fixture.metadata.sources, years * 24);
  assert(fixture.metadata.bytes < 5 * 1024 * 1024);
  assert(fixture.state.days["2026-09-30"].oa);
  assert(Object.values(fixture.state.days).some((day) => day.actual && day.oa));
  assert(Object.values(fixture.state.days).some((day) => day.leaveMinutes > 0));
  if (years >= 5) assert(fixture.state.days["2024-02-29"]);
  if (years === 10) assert(fixture.state.days["2020-02-29"]);
}
assert.throws(() => buildPerformanceFixture(2));
assert.throws(() => buildPerformanceFixture(1, "2026-09-29"));
console.log(
  "Performance fixtures passed: complete 1/5/10 years, monthly accepted histories, leap dates, manual overrides and validated round trips.",
);
