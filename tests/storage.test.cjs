"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../assets/js/namespace.js"), "utf8"),
  context,
);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../assets/js/storage.js"), "utf8") +
    ";globalThis.StorageAdapter=WorkTimeApp.services.storage",
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
assert.equal(rejected.error.code, "STORAGE_UNAVAILABLE");
assert.equal(raw, null);
assert.equal(state.days["2026-10-08"].note, "unsaved");
fail = false;
assert.equal(session.save(state).persisted, true);
assert.equal(session.status.dirty, false);
raw = "{broken";
const broken = create(storage);
assert.equal(broken.load().corrupt, true);
assert.equal(broken.originalText, "{broken");
const corruptResult = broken.save(state);
assert.equal(corruptResult.ok, false);
assert.equal(corruptResult.error.code, "CORRUPT_STORAGE");
assert.equal(raw, "{broken");
fail = true;
assert.equal(broken.replace(state).ok, false);
assert.equal(broken.loadIssue, "corrupt");
assert.equal(raw, "{broken");
fail = false;
assert.equal(broken.replace(state).ok, true);
assert.equal(broken.loadIssue, null);
const unavailable = context.StorageAdapter.create({
  key: "state",
  getStorage: () => {
    throw Error("denied");
  },
  validate: (v) => v,
  defaultState: () => ({ days: {} }),
});
assert.equal(unavailable.load().corrupt, true);
assert.equal(unavailable.loadIssue, "unavailable");
assert.equal(unavailable.readSucceeded, false);
assert.equal(unavailable.replace(state).persisted, false);
assert.equal(unavailable.save(state).persisted, false);
const quota = create({
  getItem: () => null,
  setItem() {
    throw Object.assign(Error("test quota"), {
      name: "QuotaExceededError",
      code: 22,
    });
  },
});
quota.load();
assert.equal(quota.save(state).error.code, "QUOTA_EXCEEDED");
raw = JSON.stringify(state);
const external = create(storage);
external.load();
raw = '{"days":{},"external":true}';
assert.equal(external.save(state).error.code, "EXTERNAL_UPDATE");
assert.equal(raw, '{"days":{},"external":true}');
console.log(
  "Storage passed: quota, retained edits, retry, corrupt source preservation and validated restore.",
);
