"use strict";
const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const realm = vm.createContext({});
vm.runInContext(
  fs.readFileSync("assets/js/namespace.js", "utf8") +
    fs.readFileSync("assets/js/ui/workspace.js", "utf8") +
    ";globalThis.create=WorkTimeApp.ui.createWorkspace",
  realm,
);
const calls = [],
  observers = new Set(),
  model = {
    today: "2026-10-02",
    batchMode: true,
    batchDays: new Set(["2026-10-03"]),
    batchAnchor: "2026-10-03",
  },
  tabs = { style: {} },
  footer = { getBoundingClientRect: () => ({ height: 41.0625 }) };
let settingsOpen = true;
const view = realm.create({
  model,
  document: {
    querySelector: (s) => (s === ".calendar-footer" ? footer : tabs),
  },
  window: {
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        observers.add(this);
      }
      observe(target) {
        assert.equal(target, footer);
      }
      disconnect() {
        observers.delete(this);
      }
    },
  },
  element: (id) =>
    id === "settingsDialog"
      ? { open: settingsOpen }
      : id === "importDialog"
        ? { dispatchEvent: (event) => calls.push(event.type) }
        : { showModal: () => calls.push("modal:" + id) },
  sidebarPanels: { open: (id) => id === "importDialog" },
  notifications: {
    renderOAStaleNotice: () => calls.push("stale"),
    updateNotificationEmptyState: () => calls.push("empty"),
    toast: (message, tone) => calls.push([message, tone]),
  },
  renderStats: () => calls.push("stats"),
  renderCalendar: (force) => calls.push(force ? "calendar-force" : "calendar"),
  renderEditor: () => calls.push("editor"),
  refreshSettings: () => calls.push("settings"),
});
for (let round = 0; round < 3; round++) {
  calls.length = 0;
  view.mount();
  view.mount();
  assert.equal(observers.size, 1);
  assert.deepEqual(calls, ["stale", "stats", "calendar", "editor", "empty"]);
  assert.equal(tabs.style.height, "41.0625px");
  view.open("importDialog");
  assert.equal(calls.length, 5);
  view.open("templateDialog");
  assert.equal(calls.at(-1), "modal:templateDialog");
  calls.length = 0;
  view.reload();
  assert.equal(calls.includes("settings"), settingsOpen);
  assert.equal(calls.at(-1), "sidebar-open");
  settingsOpen = false;
  calls.length = 0;
  view.dateChanged("2026-10-04");
  assert.equal(model.today, "2026-10-04");
  assert.deepEqual(calls, ["stale", "stats", "calendar-force", "empty"]);
  model.batchMode = true;
  model.batchDays.add("2026-10-03");
  model.batchAnchor = "2026-10-03";
  calls.length = 0;
  view.leaveBatch();
  view.leaveBatch();
  assert.equal(model.batchMode, false);
  assert.equal(model.batchDays.size, 0);
  assert.equal(model.batchAnchor, null);
  assert.deepEqual(calls, ["calendar", "editor"]);
  view.saveFeedback(true, "saved");
  assert.deepEqual(calls.at(-1), ["saved", "countdown"]);
  view.saveFeedback(false, "ignored");
  assert.match(calls.at(-1)[0], /未能保存/);
  assert.equal(calls.at(-1)[1], "error");
  const staleObserver = [...observers][0];
  view.dispose();
  view.dispose();
  assert.equal(observers.size, 0);
  calls.length = 0;
  view.render();
  view.reload();
  view.dateChanged("2099-01-01");
  view.recoveryDone();
  view.open("templateDialog");
  view.saveFeedback(true, "saved");
  staleObserver.callback();
  assert.deepEqual(calls, []);
  assert.equal(model.today, "2026-10-04");
}
console.log(
  "Workspace passed: three mount/dispose rounds, view order, footer boundary, sidebar routing, batch exit and no late updates.",
);
