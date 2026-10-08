"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const values = new Map(),
  writes = [],
  target = new EventTarget();
let fail = false;
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => {
    writes.push([key, value]);
    if (fail) throw Error("quota");
    values.set(key, value);
  },
};
target.localStorage = storage;
const realm = vm.createContext({ window: target });
vm.runInContext(
  [
    "assets/js/namespace.js",
    "assets/js/domain/preferences.js",
    "assets/js/services/preferences.js",
  ]
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n") + ";globalThis.P=WorkTimeApp.services.preferences",
  realm,
);
const service = realm.P;
service.page.dispose();
const owner = service.create({ getStorage: () => storage }),
  updates = [];
assert(Object.isFrozen(owner.state));
assert.equal(owner.state.pageTheme, "green");
const unsubscribe = owner.subscribe((state, result) =>
  updates.push({ theme: state.pageTheme, result }),
);
assert.equal(owner.saveTheme("green").changed, false);
assert.equal(writes.length, 0);
const saved = owner.saveTheme("blue");
assert.equal(saved.applied, true);
assert.equal(saved.persisted, true);
assert.equal(owner.revision, 1);
owner.saveTheme("blue");
assert.equal(writes.length, 1);
assert.equal(updates.length, 1);
fail = true;
const failed = owner.saveTheme("rose");
assert.equal(failed.code, "PREFERENCE_WRITE_FAILED");
assert.equal(failed.dirty, true);
assert.equal(failed.persisted, false);
assert.equal(owner.state.pageTheme, "rose");
assert.equal(owner.revision, 2);
owner.saveTheme("rose");
assert.equal(owner.revision, 2);
fail = false;
assert.equal(owner.saveTheme("rose").persisted, true);
assert.equal(owner.dirty, false);
assert.equal(owner.revision, 2);
assert(
  writes.every(([key]) => key === service.key),
  "Theme operations never write business records",
);
const event = (key, area = storage) => {
  const e = new Event("storage");
  Object.assign(e, { key, storageArea: area });
  return e;
};
for (let round = 0; round < 3; round++) {
  owner.mount(target);
  owner.mount(target);
  const before = updates.length;
  values.set(service.key, "purple");
  target.dispatchEvent(event(service.key));
  assert.equal(updates.length, before + 1);
  assert.equal(owner.state.pageTheme, "purple");
  values.set(service.key, "blue");
  target.dispatchEvent(event(service.key, {}));
  assert.equal(owner.state.pageTheme, "purple");
  values.delete(service.key);
  target.dispatchEvent(event(null));
  assert.equal(owner.state.pageTheme, "green");
  owner.dispose();
  const disposed = updates.length;
  target.dispatchEvent(event(service.key));
  assert.equal(updates.length, disposed);
  owner.subscribe((state, result) =>
    updates.push({ theme: state.pageTheme, result }),
  );
}
unsubscribe();
owner.dispose();
console.log(
  "Preference state passed: frozen snapshots, no-op, failed-session retention/retry, isolated writes, external events and three mount/dispose rounds.",
);
