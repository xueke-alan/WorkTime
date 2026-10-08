"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm");
const realm = vm.createContext({});
vm.runInContext(require("./helpers/core-source.cjs").readCoreSource(), realm);
const C = vm.runInContext("DomainTest", realm);

assert.equal(
  C.duration(
    { start: "08:00", end: "17:00", nextDay: false },
    {
      breaks: [
        { start: 720, end: 780 },
        { start: 750, end: 810 },
      ],
    },
  ),
  450,
  "Overlapping breaks are deducted once",
);
assert.equal(
  C.duration(
    { start: "20:00", end: "08:00", nextDay: true },
    {
      breaks: [
        { start: 1320, end: 1380 },
        { start: 360, end: 420 },
      ],
    },
  ),
  600,
  "Overnight records deduct breaks on both dates",
);
assert.equal(C.parseText("09/28\n08:00", 2026).records[0].status, "pending");
assert.equal(C.parseText("02/30\n08:00\n17:30", 2026).records.length, 0);
assert.equal(C.parseText("09/28\n08:00\n12:00\n17:30", 2026).records.length, 0);

const state = C.defaultState(),
  date = "2026-09-28",
  first = {
    date,
    start: "08:00",
    end: "17:30",
    nextDay: false,
    status: "complete",
    source: "a",
    raw: "",
  },
  second = { ...first, end: "18:30", source: "b" };
state.imports = [
  { id: "a", records: [first], sources: [] },
  { id: "b", records: [second], sources: [] },
];
C.applyObservation(state, first, "a");
C.applyObservation(state, second, "b");
assert.equal(state.days[date].oa.end, "18:30");
assert.equal(C.deleteImport(state, "b").restored, 1);
assert.equal(state.days[date].oa.end, "17:30");
assert.equal(state.days[date].oa.importId, "a");
assert.equal(state.imports.length, 1);
console.log(
  "Record contracts passed: overlapping/overnight breaks, malformed punches and accepted-history replay.",
);
