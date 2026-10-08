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
console.log(
  "Import planning passed: shared policy, explicit conflicts, immutable preview, accepted-only history and same-batch observations.",
);
