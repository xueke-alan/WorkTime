"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    fs.readFileSync("assets/js/services/application.js", "utf8") +
    ";globalThis.C=DomainTest;globalThis.A=WorkTimeApp.services.application",
  context,
);
const { C, A } = context;
let writes = 0,
  fail = false,
  restored = 0;
const persistence = {
  save() {
    writes++;
    return fail
      ? {
          persisted: false,
          error: Object.assign(Error("quota"), { code: "QUOTA" }),
        }
      : { persisted: true };
  },
  replace(candidate) {
    restored++;
    return this.save(candidate);
  },
};
const original = C.defaultState();
const store = A.createState({ state: original, persistence, core: C });
original.settings.workStart = "09:00";
assert.equal(store.state.settings.workStart, "08:00");
assert.throws(
  () => {
    store.state.days.x = {};
  },
  { name: "TypeError" },
);
assert.throws(
  () => {
    store.state.settings.breaks.push({ start: 1, end: 2 });
  },
  { name: "TypeError" },
);
const date = "2026-09-01",
  day = {
    actual: {
      start: "08:00",
      end: "17:30",
      nextDay: false,
      effectiveMinutes: 0,
    },
  };
let result = store.saveDay(date, day);
assert.equal(result.changed, true);
assert.equal(result.applied, true);
assert.equal(result.persisted, true);
assert.equal(store.revision, 1);
day.actual.start = "09:00";
assert.equal(store.state.days[date].actual.start, "08:00");
store.saveDay(date, store.state.days[date]);
assert.equal(writes, 1, "No-op does not write");
assert.equal(store.revision, 1, "No-op does not invalidate statistics");
fail = true;
result = store.saveDay(date, { leaveMinutes: 60 });
assert.equal(result.persisted, false);
assert.equal(result.applied, true);
assert.equal(result.code, "QUOTA");
assert.equal(store.dirty, true);
assert.equal(store.state.days[date].leaveMinutes, 60);
const revision = store.revision;
store.saveDay(date, { leaveMinutes: 60 });
assert.equal(
  store.revision,
  revision,
  "Failed identical retry retains revision",
);
fail = false;
result = store.retry();
assert.equal(result.persisted, true);
assert.equal(result.changed, false);
assert.equal(store.dirty, false);
assert.equal(store.revision, revision);
const candidate = C.applyScheduleRange(
  store.state,
  { workStart: "09:00", workEnd: "18:00", breaks: [{ start: 720, end: 780 }] },
  null,
  null,
);
fail = true;
result = store.applySchedule(candidate);
assert.equal(result.applied, false);
assert.equal(
  store.dirty,
  false,
  "Rejected schedule is still a UI draft, not unsaved business state",
);
assert.equal(store.failed, true);
assert.equal(
  store.state.settings.workStart,
  "08:00",
  "Failed schedule preserves effective rules",
);
assert.equal(store.revision, revision);
fail = false;
result = store.applySchedule(candidate);
assert.equal(result.applied, true);
assert.equal(store.state.settings.workStart, "09:00");
assert.equal(store.revision, revision + 1);
const savedRevision = store.revision;
store.applySchedule(candidate);
assert.equal(store.revision, savedRevision);
fail = true;
result = store.restore(C.defaultState());
assert.equal(restored, 1);
assert.equal(result.applied, false);
assert.equal(result.persisted, false, "Restore must report failed persistence");
assert.equal(store.state.settings.workStart, "09:00");
assert.equal(store.revision, savedRevision);
fail = false;
assert.equal(store.restore(C.defaultState()).persisted, true);
assert.equal(store.state.settings.workStart, "08:00");
console.log(
  "Application state: immutable ownership, detached inputs, no-op revision/write, retained edit retry, atomic schedule and failed restore passed.",
);
