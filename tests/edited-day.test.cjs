"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm");
const realm = vm.createContext({ Date });
vm.runInContext(require("./helpers/core-source.cjs").readCoreSource(), realm);
const C = vm.runInContext("DomainTest", realm);
const record = {
  start: "09:00",
  end: "17:00",
  nextDay: false,
  effectiveMinutes: null,
};
const completeOA = { ...record, status: "complete", raw: "original OA" };
const pendingOA = { ...completeOA, end: "", status: "pending" };
const input = (start = "09:00", end = "17:00", nextDay = false) => ({
  start,
  end,
  nextDay,
  leaveMinutes: 30,
});
const draft = { start: "08:00", end: "", nextDay: false };
const cases = [
  ["new manual filling", {}, input(), { estimate: record }],
  [
    "existing actual remains actual",
    { actual: record },
    input(),
    { actual: record },
  ],
  [
    "unchanged complete OA clears draft",
    { oa: completeOA, draft },
    input(),
    {},
  ],
  [
    "unchanged pending OA clears draft",
    { oa: pendingOA, draft },
    input("09:00", ""),
    {},
  ],
  ["pending OA end filling", { oa: pendingOA }, input(), { estimate: record }],
  [
    "changed pending OA start is actual",
    { oa: pendingOA },
    input("08:00"),
    { actual: { ...record, start: "08:00" } },
  ],
  [
    "changed complete OA end is actual",
    { oa: completeOA },
    input("09:00", "18:00"),
    { actual: { ...record, end: "18:00" } },
  ],
  [
    "partial actual retains original and draft",
    { actual: record },
    input("09:00", ""),
    { actual: record, draft: { start: "09:00", end: "", nextDay: false } },
  ],
  [
    "empty without OA clears all manual layers",
    { actual: record, estimate: record, draft },
    input("", ""),
    {},
  ],
  [
    "empty with OA preserves source and draft",
    { oa: completeOA },
    input("", ""),
    { draft: { start: "", end: "", nextDay: false } },
  ],
  [
    "next-day flag alone is draft",
    {},
    input("", "", true),
    { draft: { start: "", end: "", nextDay: true } },
  ],
  [
    "overnight completion",
    {},
    input("23:00", "01:00", true),
    { estimate: { ...record, start: "23:00", end: "01:00", nextDay: true } },
  ],
  [
    "earlier end without next-day is draft",
    {},
    input("23:00", "01:00"),
    { draft: { start: "23:00", end: "01:00", nextDay: false } },
  ],
];
function freeze(value) {
  for (const child of Object.values(value))
    if (child && typeof child === "object") freeze(child);
  return Object.freeze(value);
}
for (const [name, layers, edit, expected] of cases) {
  const old = freeze({
      note: "retained note",
      kind: "work",
      plannedOvertime: true,
      leaveMinutes: 15,
      ...layers,
    }),
    before = JSON.stringify(old);
  freeze(edit);
  const candidate = C.editedDay(old, edit);
  const expectedDay = {
    note: old.note,
    kind: old.kind,
    plannedOvertime: true,
    leaveMinutes: 30,
    ...(old.oa ? { oa: old.oa } : {}),
    ...expected,
  };
  assert.deepEqual(JSON.parse(JSON.stringify(candidate)), expectedDay, name);
  assert.notEqual(candidate, old, "Independent candidate object");
  assert.equal(JSON.stringify(old), before, name + " preserves old day");
  if (old.oa)
    assert.equal(
      candidate.oa,
      old.oa,
      "Original OA identity and raw text retained",
    );
}
console.log(
  "Edited day passed: OA preservation, actual/estimate transitions, partial/empty/overnight drafts and frozen inputs.",
);
