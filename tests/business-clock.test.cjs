"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    fs.readFileSync("assets/js/services/clock.js", "utf8") +
    ";globalThis.C=DomainTest;globalThis.Clock=WorkTimeApp.services.clock",
  context,
);
const C = context.C;
for (const [month, last] of [
  ["2024-02", "2024-02-29"],
  ["2026-02", "2026-02-28"],
  ["2026-12", "2026-12-31"],
])
  assert.deepEqual(Array.from(C.monthBounds(month)), [month + "-01", last]);
const detachedSource = C.defaultState(),
  detached = C.cloneState(detachedSource);
detached.personal.workCity = "上海";
detached.settings.breaks[0].end = 811;
assert.equal(detachedSource.personal.workCity, "");
assert.equal(detachedSource.settings.breaks[0].end, 810);
for (const [timestamp, expected, minutes] of [
  ["2026-09-30T15:59:59Z", "2026-09-30", 1439],
  ["2026-09-30T16:00:00Z", "2026-10-01", 0],
  ["2026-12-31T16:00:00Z", "2027-01-01", 0],
  ["2028-02-28T16:00:00Z", "2028-02-29", 0],
]) {
  assert.equal(C.businessDate(new Date(timestamp)), expected);
  assert.equal(C.businessMinutes(new Date(timestamp)), minutes);
}
const state = C.defaultState();
assert.equal(
  C.pendingWorkdays(
    state,
    "2026-10-08",
    "2026-10-08",
    "2026-10-08",
    new Date("2026-10-07T23:59:00Z"),
  ),
  0,
);
assert.equal(
  C.pendingWorkdays(
    state,
    "2026-10-08",
    "2026-10-08",
    "2026-10-08",
    new Date("2026-10-08T00:00:00Z"),
  ),
  1,
);
let timestamp = "2026-12-31T15:59:59Z",
  callback,
  delay,
  canceled = 0;
const listeners = new Map(),
  changes = [],
  doc = {
    visibilityState: "visible",
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    defaultView: {
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name),
    },
  };
// Dates are created in the service realm, preserving its explicit clock contract.
context.timestamp = timestamp;
const now = vm.runInContext("() => new Date(globalThis.timestamp)", context);
const clock = context.Clock.create({ now, dateKey: C.businessDate });
const dispose = clock.watch({
  document: doc,
  onChange: (date) => changes.push(date),
  schedule(fn, ms) {
    callback = fn;
    delay = ms;
    return 1;
  },
  cancel() {
    canceled++;
  },
});
assert.equal(delay, 1020);
context.timestamp = "2026-12-31T16:00:01Z";
callback();
assert.deepEqual(changes, ["2027-01-01"]);
listeners.get("focus")();
assert.equal(changes.length, 1, "same date does not redraw");
doc.visibilityState = "hidden";
context.timestamp = "2027-01-05T16:00:00Z";
listeners.get("visibilitychange")();
assert.equal(changes.length, 1);
doc.visibilityState = "visible";
listeners.get("visibilitychange")();
assert.deepEqual(changes, ["2027-01-01", "2027-01-06"]);
dispose();
assert.equal(listeners.size, 0);
callback();
assert.equal(changes.length, 2);
assert(canceled > 0);
console.log(
  "Business clock passed: China midnight/year/leap day, work-start boundary, resume, deduplication and disposal.",
);
