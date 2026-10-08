"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";" +
    fs.readFileSync("assets/js/ui/summary.js", "utf8") +
    ";globalThis.C=DomainTest;globalThis.UI=WorkTimeApp.ui",
  context,
);
const C = context.C,
  elements = new Map(),
  state = C.defaultState();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, { textContent: "", innerHTML: "" });
  return elements.get(id);
};
let today = "2026-10-02";
const ui = context.UI.createSummary({
  core: {
    ...C,
    pendingWorkdays: (state, start, end, asOf) =>
      C.pendingWorkdays(
        state,
        start,
        end,
        asOf,
        new Date(asOf + "T12:00:00+08:00"),
      ),
  },
  element,
  escape: String,
  getState: () => state,
  getView: () => ({ today }),
  getRange: () => ["2026-09-01", "2026-09-30"],
  document: {},
  numbers: {
    set(element, value, format) {
      element.value = value;
      element.format = format;
    },
  },
});
function expect(label, hours) {
  ui.renderTarget();
  assert.equal(element("targetTotalLabel").textContent, label);
  assert.equal(element("targetMetric").value, hours);
  assert.equal(element("targetMetric").format.unit, "h");
  assert.equal(element("targetDailyMetric").value, 0);
  assert.equal(element("targetDailyMetric").format.unit, "h/d");
  assert.equal(element("targetDailyMetric").format.decimals, 1);
}
state.overtimeRequirements[0] = 120;
const pace = C.targetPace(state, "2026-09-01", "2026-09-30", today, 120);
expect("记录内差额", pace.difference / 60);
assert.equal(element("targetResult").textContent, "");
state.overtimeRequirements[0] = 0;
expect("已达标", 0);
state.days["2026-09-01"] = {
  actual: {
    start: "08:00",
    end: "17:30",
    nextDay: false,
    effectiveMinutes: 600,
  },
};
expect("超出目标", 2);
// All workdays complete before month-end: preserve the same real difference and show no daily allocation.
for (let day = 1; day <= 30; day++) {
  const date = "2026-09-" + C.pad(day);
  if (C.calendarInfo(date).work)
    state.days[date] = {
      actual: {
        start: "08:00",
        end: "17:30",
        nextDay: false,
        effectiveMinutes: 480,
      },
    };
}
today = "2026-09-01";
state.overtimeRequirements[0] = 120;
expect("未达标差额", pace.difference / 60);
assert.equal(element("targetResult").textContent, "");
console.log(
  "Target display passed: historical shortfall, met/surplus, all-complete current month and no false zero/daily allocation.",
);
