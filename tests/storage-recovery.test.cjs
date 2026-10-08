"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const realm = vm.createContext({ AbortController });
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    fs.readFileSync("assets/js/storage.js", "utf8") +
    fs.readFileSync("assets/js/services/application.js", "utf8") +
    ";globalThis.C=DomainTest;globalThis.S=WorkTimeApp.services.storage;globalThis.A=WorkTimeApp.services.application",
  realm,
);
const { C, S, A } = realm;
function setup(text, { denied = false, quota = false } = {}) {
  const disk = { text, denied, quota, writes: 0 };
  const persistence = S.create({
    key: C.KEY,
    validate: C.validateBackup,
    defaultState: C.defaultState,
    getStorage() {
      if (disk.denied) throw Error("denied");
      return {
        getItem: () => disk.text,
        setItem(key, value) {
          assert.equal(key, C.KEY);
          if (disk.quota) throw new DOMException("full", "QuotaExceededError");
          disk.text = value;
          disk.writes++;
        },
      };
    },
  });
  const loaded = persistence.load();
  const owner = A.createState({
    state: loaded.state,
    persistence,
    core: C,
    corrupt: loaded.corrupt,
    failed: !!loaded.error,
    unsaved: !!loaded.error,
  });
  return { disk, persistence, loaded, owner };
}
(async () => {
  assert.equal(setup(null).loaded.loadIssue, null);
  for (const text of ["", "{broken", "null", '{"schemaVersion":3}']) {
    const { loaded, persistence } = setup(text);
    assert.equal(loaded.loadIssue, "corrupt", text);
    assert.equal(loaded.readSucceeded, true);
    assert.equal(persistence.originalText, text);
  }
  const old = setup('{"schemaVersion":1}');
  assert.equal(old.loaded.loadIssue, "unsupported");
  assert.throws(() => old.owner.initialize("blue"), /仅损坏/);
  const denied = setup("original", { denied: true });
  assert.equal(denied.loaded.loadIssue, "unavailable");
  assert.equal(denied.loaded.readSucceeded, false);
  assert.throws(() => denied.owner.initialize("blue"), /仅损坏/);
  denied.disk.denied = false;
  assert.equal(denied.owner.restore(C.defaultState()).persisted, false);
  assert.equal(denied.disk.text, "original");

  const corrupt = setup("{original", { quota: true });
  corrupt.owner.saveDay("2026-10-08", { note: "temporary" });
  const before = JSON.stringify(corrupt.owner.state),
    revision = corrupt.owner.revision;
  const failed = corrupt.owner.initialize("blue");
  assert.equal(failed.code, "QUOTA_EXCEEDED");
  assert.equal(failed.applied, false);
  assert.equal(corrupt.disk.text, "{original");
  assert.equal(JSON.stringify(corrupt.owner.state), before);
  assert.equal(corrupt.owner.revision, revision);
  assert.equal(corrupt.owner.loadCorrupt, true);
  assert.equal(corrupt.owner.dirty, true);
  corrupt.disk.quota = false;
  assert.equal(corrupt.owner.initialize("blue").persisted, true);
  assert.equal(corrupt.owner.loadCorrupt, false);
  assert.equal(corrupt.owner.dirty, false);
  assert.equal(Object.keys(corrupt.owner.state.days).length, 0);
  assert.equal(JSON.parse(corrupt.disk.text).preferences.pageTheme, "blue");
  assert.equal(
    corrupt.owner.saveDay("2026-10-08", { note: "saved" }).persisted,
    true,
  );

  const external = setup("{old");
  external.disk.text = JSON.stringify(C.defaultState());
  assert.equal(external.owner.initialize("green").code, "EXTERNAL_UPDATE");
  assert.equal(external.persistence.loadIssue, "corrupt");
  assert.equal(external.disk.writes, 0);

  const invalid = setup("{broken");
  assert.equal(invalid.persistence.replace({}).persisted, false);
  assert.equal(invalid.disk.writes, 0);
  assert.equal(invalid.persistence.loadIssue, "corrupt");

  const locked = setup("{broken");
  await locked.persistence.acquireWriteAccess({
    request: async (key, options, callback) => callback(null),
  });
  assert.equal(locked.owner.initialize("green").code, "LOCK_BUSY");
  assert.equal(locked.disk.text, "{broken");
  const locks = { request: async (key, options, callback) => callback({}) };
  await locked.persistence.acquireWriteAccess(locks, { retry: true });
  assert.equal(locked.owner.initialize("green").persisted, true);
  locked.persistence.releaseWriteAccess();
  console.log(
    "Storage recovery passed: issue classification, atomic replacement, source preservation, validation, lock, external update and retry.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
