"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../assets/js/storage.js"), "utf8") +
    ";globalThis.StorageAdapter=WorkStorage",
  context,
);
function create(storage) {
  return context.StorageAdapter.create({
    key: "state",
    getStorage: () => storage,
    defaultState: () => ({ days: {} }),
    validate: (value) => value,
  });
}
let raw = null,
  fail = false;
const storage = {
  getItem: () => raw,
  setItem: (key, value) => {
    if (fail) throw Error("quota");
    raw = value;
  },
};
const session = create(storage);
assert.equal(session.load().corrupt, false);
const state = { days: { "2026-10-08": { note: "unsaved" } } };
fail = true;
const rejected = session.save(state);
assert.equal(rejected.ok, false);
assert.equal(rejected.persisted, false);
assert.equal(rejected.dirty, true);
assert.equal(raw, null);
assert.equal(state.days["2026-10-08"].note, "unsaved");
fail = false;
assert.equal(session.save(state).persisted, true);
assert.equal(session.status.dirty, false);
raw = "{broken";
const broken = create(storage);
assert.equal(broken.load().corrupt, true);
assert.equal(broken.originalText, "{broken");
assert.equal(broken.save(state).ok, false);
assert.equal(raw, "{broken");
broken.allowValidatedRestore();
assert.equal(broken.save(state).ok, true);
const unavailable = context.StorageAdapter.create({
  key: "state",
  getStorage: () => {
    throw Error("denied");
  },
  validate: (v) => v,
  defaultState: () => ({ days: {} }),
});
assert.equal(unavailable.load().corrupt, true);
assert.equal(unavailable.save(state).persisted, false);
console.log(
  "Storage passed: quota, retained edits, retry, corrupt source preservation and validated restore.",
);
