"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm");
const realm = vm.createContext({});
vm.runInContext(require("./helpers/core-source.cjs").readCoreSource(), realm);
const C = vm.runInContext("DomainTest", realm);
const pending = { start: "08:00", end: "", nextDay: false, status: "pending" },
  complete = { ...pending, end: "17:30", status: "complete" },
  changed = { ...complete, end: "20:00" },
  off = { start: "", end: "", nextDay: false, status: "off" };
for (const [old, incoming, code, selected, conflict] of [
  [null, pending, "ADDED", pending, false],
  [
    complete,
    { ...complete, source: "different provenance" },
    "DUPLICATE",
    complete,
    false,
  ],
  [complete, pending, "KEEP_COMPLETE", complete, false],
  [complete, changed, "COMPLETE_CONFLICT", changed, true],
  [pending, complete, "COMPLETED", complete, false],
  [pending, off, "KEEP_START", pending, false],
  [off, pending, "UPDATED", pending, false],
]) {
  const original = JSON.stringify([old, incoming]);
  const result = C.mergeObservation(old, incoming);
  assert.equal(result.code, code);
  assert.equal(result.record, selected);
  assert.equal(Boolean(result.conflict), conflict);
  assert(!Object.hasOwn(result, "action"));
  assert.equal(JSON.stringify([old, incoming]), original);
}
console.log(
  "Observation codes passed: seven semantic branches, identity, conflict policy and no localized domain actions.",
);
