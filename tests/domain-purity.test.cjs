"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm");
class ExplicitDate extends Date {
  constructor(...args) {
    assert(args.length, "Domain must receive time explicitly");
    super(...args);
  }
  static now() {
    throw Error("Domain must not read Date.now");
  }
}
const realm = vm.createContext({ Date: ExplicitDate });
vm.runInContext(require("./helpers/core-source.cjs").readCoreSource(), realm);
const C = vm.runInContext("DomainTest", realm),
  state = C.defaultState();
const date = "2026-10-08",
  before = new Date("2026-10-07T23:59:00Z"),
  after = new Date("2026-10-08T00:00:00Z");
assert.equal(C.businessDate(after), date);
assert.equal(C.businessMinutes(after), 480);
assert.equal(C.pendingWorkdays(state, date, date, date, before), 0);
assert.equal(C.pendingWorkdays(state, date, date, date, after), 1);
state.days["2026-10-05"] = {
  oa: { status: "pending", start: "08:00", end: "", nextDay: false },
};
assert.equal(C.oaStaleness(state, date).days, 3);
assert.equal(C.oaStaleness(state, "2026-10-07").stale, false);
assert.equal(C.summary(state, date, date).average, null);
assert.equal(
  C.cumulativeAverageOvertime(state, date, date)[date].averageMinutes,
  null,
);
console.log(
  "Pure domain passed: ambient Date construction/now forbidden; explicit midnight/work-start/staleness and missing values preserved.",
);
