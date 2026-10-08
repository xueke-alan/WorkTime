"use strict";
const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const realm = vm.createContext({});
vm.runInContext(
  fs.readFileSync("assets/js/namespace.js", "utf8") +
    fs.readFileSync("assets/js/services/save-session.js", "utf8") +
    ";globalThis.create=WorkTimeApp.services.createSaveSession",
  realm,
);
function setup() {
  const calls = [],
    requests = [],
    owner = {
      state: { value: "initial" },
      loadCorrupt: false,
      retry() {
        calls.push("save:" + this.state.value);
        return { persisted: true };
      },
      reload(state) {
        calls.push("reload");
        this.state = state;
      },
      markUnsaved() {
        calls.push("unsaved");
      },
    },
    persistence = {
      canWrite: false,
      external: true,
      hasExternalUpdate() {
        return this.external;
      },
      load() {
        calls.push("load");
        return { state: { value: "external" } };
      },
      acquireWriteAccess(locks, options) {
        assert.equal(typeof locks.request, "function");
        return new Promise((resolve) => requests.push({ options, resolve }));
      },
    },
    draft = { active: false };
  const session = realm.create({
    owner,
    persistence,
    locks: { request() {} },
    hasDraft: () => draft.active,
    onCommit: () => calls.push("commit"),
    onReload: () => calls.push("view-reload"),
    onRecovered: () => calls.push("recovered"),
    onRecoveryError: (error) => calls.push("error:" + error.message),
    onAccessError: (error) => calls.push("access:" + error.code),
    onRecoveryDone: () => calls.push("done"),
  });
  return { session, owner, persistence, draft, calls, requests };
}
async function retry(fixture, result = { ok: true }) {
  const pending = fixture.session.retry();
  fixture.requests.at(-1).resolve(result);
  await pending;
}
(async () => {
  const clean = setup();
  await retry(clean);
  assert.deepEqual(clean.calls, [
    "load",
    "reload",
    "view-reload",
    "save:external",
    "commit",
    "recovered",
    "done",
  ]);
  for (const guard of ["draft", "state", "corrupt", "external"]) {
    const fixture = setup();
    if (guard === "draft") fixture.draft.active = true;
    if (guard === "state") fixture.owner.state.value = "local";
    if (guard === "corrupt") fixture.owner.loadCorrupt = true;
    if (guard === "external") fixture.persistence.external = false;
    await retry(fixture);
    assert.equal(fixture.calls.includes("load"), false, guard);
    assert.equal(fixture.calls.includes("recovered"), true, guard);
    assert.equal(
      fixture.owner.state.value,
      guard === "state" ? "local" : "initial",
    );
  }
  const failedCommit = setup();
  failedCommit.owner.state.value = "unsaved";
  failedCommit.session.commit({ persisted: false });
  await retry(failedCommit);
  assert.equal(failedCommit.calls.includes("reload"), false);
  assert.equal(failedCommit.owner.state.value, "unsaved");
  const badRead = setup();
  badRead.persistence.load = () => ({ error: Error("invalid") });
  await retry(badRead);
  assert.deepEqual(badRead.calls, [
    "unsaved",
    "commit",
    "error:invalid",
    "done",
  ]);
  const unavailable = setup();
  unavailable.persistence.loadIssue = "unavailable";
  unavailable.persistence.load = () => {
    unavailable.calls.push("load");
    unavailable.persistence.loadIssue = null;
    unavailable.persistence.external = false;
    return { state: { value: "original" } };
  };
  await retry(unavailable);
  assert.equal(unavailable.owner.state.value, "original");
  assert.equal(unavailable.calls.includes("save:original"), true);
  for (const guard of ["draft", "state"]) {
    const blocked = setup();
    blocked.persistence.loadIssue = "unavailable";
    if (guard === "draft") blocked.draft.active = true;
    else blocked.owner.state.value = "local";
    await retry(blocked);
    assert.equal(blocked.calls.includes("load"), false);
    assert.equal(blocked.calls.includes("recovered"), false);
  }
  const busy = setup();
  await retry(busy, { ok: false, error: { code: "LOCK_BUSY" } });
  assert.deepEqual(busy.calls, ["access:LOCK_BUSY"]);
  assert.equal(busy.requests.at(-1).options.wait, true);
  busy.session.dispose();
  busy.requests.at(-1).resolve({ ok: true });
  await Promise.resolve();
  assert.deepEqual(busy.calls, ["access:LOCK_BUSY"]);
  const exited = setup(),
    pending = exited.session.retry();
  exited.session.dispose();
  exited.requests[0].resolve({ ok: true });
  await pending;
  assert.deepEqual(exited.calls, []);
  await exited.session.retry();
  exited.session.wait();
  assert.equal(exited.requests.length, 1);
  console.log(
    "Save session passed: clean handover, four adoption guards, unsaved retention, corrupt read and no callbacks after disposal.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
