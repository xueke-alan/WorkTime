"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const realm = vm.createContext({
  Event,
  clearTimeout,
  console: { error() {} },
});
vm.runInContext(
  fs.readFileSync("assets/js/namespace.js", "utf8") +
    fs.readFileSync("assets/js/services/bootstrap.js", "utf8"),
  realm,
);
const bootstrap = vm.runInContext("WorkTimeApp.services.bootstrap", realm);
function fixture() {
  const listeners = new Set(),
    restoreListeners = new Set(),
    reloads = [],
    view = new EventTarget();
  view.location = { reload: () => reloads.push(true) };
  const add = view.addEventListener.bind(view),
    remove = view.removeEventListener.bind(view);
  view.addEventListener = (type, listener, options) => {
    if (type === "pagehide") listeners.add(listener);
    if (type === "pageshow") restoreListeners.add(listener);
    add(type, listener, options);
  };
  view.removeEventListener = (type, listener, options) => {
    if (type === "pagehide") listeners.delete(listener);
    if (type === "pageshow") restoreListeners.delete(listener);
    remove(type, listener, options);
  };
  const controls = [{ disabled: false }],
    events = [],
    notices = [];
  const document = {
    defaultView: view,
    documentElement: { dataset: {}, classList: { remove() {} } },
    dispatchEvent(event) {
      events.push(event.type);
    },
    querySelectorAll() {
      return controls;
    },
    createElement() {
      return { setAttribute() {} };
    },
    querySelector() {
      return null;
    },
    body: {
      prepend(notice) {
        notices.push(notice);
      },
    },
  };
  return {
    document,
    view,
    listeners,
    restoreListeners,
    reloads,
    controls,
    events,
    notices,
  };
}
(async () => {
  for (const mode of ["ready", "failure", "pending"])
    for (let round = 0; round < 3; round++) {
      const f = fixture(),
        calls = [];
      let owner, release;
      const result = bootstrap.run(
        async (lifecycle) => {
          owner = lifecycle;
          lifecycle.defer(() => calls.push("first"));
          lifecycle.defer(() => {
            calls.push("second");
            if (mode === "failure") throw Error("cleanup failure");
          });
          if (mode === "failure") throw Error("initialization failure");
          if (mode === "pending")
            await new Promise((resolve) => {
              release = resolve;
            });
        },
        { document: f.document },
      );
      if (mode === "pending") {
        f.view.dispatchEvent(new Event("pagehide"));
        release();
      }
      const finished = await result;
      if (mode === "ready") {
        assert.equal(finished.ok, true);
        assert.equal(f.listeners.size, 1);
        assert.deepEqual(f.events, ["worktime:ready"]);
        f.view.dispatchEvent(new Event("pagehide"));
      } else if (mode === "failure") {
        assert.equal(finished.ok, false);
        assert.equal(f.document.documentElement.dataset.appState, "failed");
        assert.deepEqual(f.events, ["worktime:failed"]);
        assert.equal(f.controls[0].disabled, true);
        assert.equal(f.notices.length, 1);
      } else {
        assert.equal(finished.closed, true);
        assert.deepEqual(f.events, []);
      }
      assert.equal(f.listeners.size, 0);
      assert.deepEqual(calls, ["second", "first"]);
      owner.dispose();
      f.view.dispatchEvent(new Event("pagehide"));
      assert.deepEqual(calls, ["second", "first"]);
      owner.defer(() => calls.push("late"));
      assert.deepEqual(calls, ["second", "first", "late"]);
    }
  for (const persisted of [true, false])
    for (let round = 0; round < 3; round++) {
      const f = fixture();
      let cleaned = 0;
      await bootstrap.run((lifecycle) => lifecycle.defer(() => cleaned++), {
        document: f.document,
      });
      const hide = new Event("pagehide");
      Object.defineProperty(hide, "persisted", { value: true });
      f.view.dispatchEvent(hide);
      assert.equal(cleaned, 1);
      assert.equal(f.listeners.size, 0);
      assert.equal(f.restoreListeners.size, 1);
      const show = new Event("pageshow");
      Object.defineProperty(show, "persisted", { value: persisted });
      f.view.dispatchEvent(show);
      assert.equal(f.restoreListeners.size, 0);
      assert.equal(f.reloads.length, Number(persisted));
      f.view.dispatchEvent(show);
      assert.equal(f.reloads.length, Number(persisted));
    }
  console.log(
    "Bootstrap lifetime passed: 15 ready/failure/pending/cache rounds, ordered cleanup, listener release, one-shot restore and no late readiness.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
