"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const realm = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    fs.readFileSync("assets/js/ui/summary.js", "utf8") +
    ";globalThis.C=DomainTest;globalThis.UI=WorkTimeApp.ui",
  realm,
);
const { C, UI } = realm;
const date = "2026-09-15",
  end = "2026-09-30",
  start = "2026-09-01";
const empty = C.defaultState();
const baseline = C.targetPace(empty, start, end, date, 60);
for (const [name, day, startsTomorrow] of [
  ["empty", {}, false],
  [
    "blank manual draft",
    { draft: { start: "", end: "", nextDay: false } },
    false,
  ],
  ["OA off", { oa: { start: "", end: "", status: "off" } }, false],
  [
    "OA start only",
    { oa: { start: "08:00", end: "", status: "pending" } },
    true,
  ],
  [
    "manual start only",
    { draft: { start: "08:00", end: "", nextDay: false } },
    true,
  ],
  ["end only", { draft: { start: "", end: "18:00", nextDay: false } }, true],
  [
    "complete manual",
    {
      actual: {
        start: "08:00",
        end: "17:30",
        nextDay: false,
        effectiveMinutes: null,
      },
    },
    true,
  ],
  [
    "corrected zero duration",
    { actual: { start: "", end: "", nextDay: false, effectiveMinutes: 0 } },
    true,
  ],
  [
    "blank draft over OA",
    {
      draft: { start: "", end: "", nextDay: false },
      oa: { start: "08:00", end: "", status: "pending" },
    },
    true,
  ],
]) {
  const state = C.defaultState();
  state.days[date] = day;
  const pace = C.targetPace(state, start, end, date, 60);
  assert.equal(pace.startsTomorrow, startsTomorrow, name);
  assert.equal(
    pace.remainingDays,
    baseline.remainingDays - Number(startsTomorrow),
    name,
  );
  assert.equal(pace.requiredPerDay, pace.difference / pace.remainingDays, name);
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", innerHTML: "" });
    return elements.get(id);
  };
  const view = UI.createSummary({
    core: C,
    element,
    escape: String,
    getState: () => state,
    getView: () => ({ today: date }),
    getRange: () => [start, end],
    numbers: { set() {} },
  });
  view.renderTarget();
  const label = element("targetTotalLabel").innerHTML.replace(/<[^>]+>/g, "");
  assert.equal(
    label,
    (startsTomorrow ? "明日起后续" : "含今日后续") +
      pace.remainingDays +
      "天" +
      (startsTomorrow ? "需要加班" : "需加班"),
    name,
  );
}
const half = C.defaultState();
half.days[date] = { leaveMinutes: 240 };
assert.equal(
  C.targetPace(half, start, end, date, 60).remainingDays,
  baseline.remainingDays - 0.5,
);
half.days[date].draft = { start: "08:00", end: "", nextDay: false };
assert.equal(
  C.targetPace(half, start, end, date, 60).remainingDays,
  baseline.remainingDays - 1,
);
assert.equal(
  C.targetPace(half, "2026-10-01", "2026-10-31", date, 60).startsTomorrow,
  false,
);
console.log(
  "Target start day passed: empty/OA/manual/partial/zero/leave/range boundaries, matching copy and daily allocation.",
);
