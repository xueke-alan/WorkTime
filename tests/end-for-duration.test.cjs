"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  { readCoreSource } = require("./helpers/core-source.cjs");
const realm = vm.createContext({ Date });
vm.runInContext(readCoreSource(), realm);
const C = vm.runInContext("DomainTest", realm),
  plain = (value) => JSON.parse(JSON.stringify(value));
const cases = [
  ["09:00", 0, [], { end: "09:00", nextDay: false }],
  ["09:00", 480, [{ start: 720, end: 780 }], { end: "18:00", nextDay: false }],
  ["12:30", 60, [{ start: 720, end: 780 }], { end: "14:00", nextDay: false }],
  [
    "09:00",
    480,
    [
      { start: 720, end: 780 },
      { start: 750, end: 810 },
    ],
    { end: "18:30", nextDay: false },
  ],
  ["23:00", 60, [], { end: "00:00", nextDay: true }],
  ["23:00", 120, [{ start: 0, end: 30 }], { end: "01:30", nextDay: true }],
  ["23:00", 720, [{ start: 600, end: 660 }], { end: "12:00", nextDay: true }],
  ["09:00", 1439, [], { end: "08:59", nextDay: true }],
  ["09:00", 1440, [], null],
  ["09:00", 1, [{ start: 0, end: 1440 }], null],
];
for (const [start, target, breaks, expected] of cases) {
  const schedule = { breaks },
    before = JSON.stringify(schedule);
  const actual = C.endForDuration(start, target, schedule);
  assert.deepEqual(plain(actual), expected, `${start}, target ${target}`);
  assert.equal(
    JSON.stringify(schedule),
    before,
    "Input schedule stays immutable",
  );
  if (actual && target > 0) {
    assert.equal(C.duration({ start, ...actual }, schedule), target);
    const minute = C.timeMin(actual.end) + (actual.nextDay ? 1440 : 0) - 1;
    const prior = {
      start,
      end: C.pad(Math.floor((minute % 1440) / 60)) + ":" + C.pad(minute % 60),
      nextDay: minute >= 1440,
    };
    assert(C.duration(prior, schedule) < target, "Earliest qualifying minute");
  }
}
console.log(
  "End inference passed: zero, overlapping breaks, overnight breaks, earliest minute and strict 24-hour boundary.",
);
