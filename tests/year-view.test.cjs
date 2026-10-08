const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const context = {};
vm.createContext(context);
vm.runInContext(require("./helpers/core-source.cjs").readCoreSource(), context);
vm.runInContext(fs.readFileSync("assets/js/year-view.js", "utf8"), context);
const C = vm.runInContext("DomainTest", context),
  Y = vm.runInContext("WorkTimeApp.ui.year", context),
  state = C.defaultState();
assert.equal(Y.heatColor(0, 480).background, "rgba(231,238,233,0.8500)");
assert.equal(Y.heatColor(480, 480).background, "rgba(74,145,106,1.0000)");
assert.equal(Y.heatColor(240, 480).background, "rgba(153,192,170,0.9250)");
assert.equal(Y.heatColor(-60, 480).ratio, 0);
assert.equal(Y.heatColor(null, 0).ratio, 0);
assert.notEqual(
  Y.heatColor(120, 480).background,
  Y.heatColor(121, 480).background,
);
assert.equal(Y.heatColor(0, 480).text, "#3c4a45");
assert.equal(Y.heatColor(240, 480).text, "#3c4a45");
assert.equal(Y.heatColor(480, 480).text, "#ffffff");
for (let minutes = 0; minutes <= 480; minutes++) {
  const color = Y.heatColor(minutes, 480),
    values = color.background.match(/[\d.]+/g).map(Number),
    alpha = values[3];
  const linear = values.slice(0, 3).map((value) => {
    const s = (value * alpha + 255 * (1 - alpha)) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const l = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  assert(
    (color.text === "#3c4a45"
      ? (l + 0.05) /
        (0.2126 * ((60 / 255 + 0.055) / 1.055) ** 2.4 +
          0.7152 * ((74 / 255 + 0.055) / 1.055) ** 2.4 +
          0.0722 * ((69 / 255 + 0.055) / 1.055) ** 2.4 +
          0.05)
      : 1.05 / (l + 0.05)) >= 3,
  );
}
for (const [minutes, maximum] of [
  [0, 0],
  [165, 180],
  [180, 180],
  [181, 240],
  [-60, 0],
])
  assert.equal(Y.scaleMaximum([{ days: [{ overtime: minutes }] }]), maximum);
for (const [minutes, minimum] of [
  [0, 0],
  [-165, -180],
  [-180, -180],
  [-181, -240],
  [60, 0],
])
  assert.equal(Y.scaleMinimum([{ days: [{ overtime: minutes }] }]), minimum);
assert.equal(
  Y.heatColor(-180, 240, -180).background,
  "rgba(194,101,96,1.0000)",
);
assert.equal(
  Y.heatColor(-90, 240, -180).background,
  "rgba(213,170,165,0.9250)",
);
assert.equal(Y.heatColor(-60, 0, -180).ratio, 1 / 3);
assert.equal(Y.heatColor(null, 240, -180).ratio, 0);
const deficitState = C.defaultState();
deficitState.days["2026-09-28"] = {
  actual: { start: "08:00", end: "15:45", nextDay: false },
};
const deficitMonths = Y.months(deficitState, 2026, "2026-10-02"),
  deficitDay = deficitMonths[8].days[27];
assert(deficitDay.overtime < 0);
assert(deficitDay.color.ratio > 0);
assert(deficitDay.description.includes("欠工时"));
const categories = Y.months(C.defaultState(), 2026, "2026-01-01").flatMap(
  (month) => month.days,
);
const holidayColors = new Set(
  categories.filter((day) => day.holiday).map((day) => day.color.background),
);
const weekendColors = new Set(
  categories
    .filter((day) => day.weekend && !day.holiday)
    .map((day) => day.color.background),
);
assert.deepEqual([...holidayColors], ["#f4e7d6"]);
assert.deepEqual([...weekendColors], ["#dce8e3"]);
assert.equal(
  categories.find((day) => day.date === "2026-10-10").weekend,
  false,
);
const restWorkState = C.defaultState();
restWorkState.days["2026-10-11"] = {
  actual: { start: "08:00", end: "10:00", nextDay: false },
};
assert.notEqual(
  Y.months(restWorkState, 2026, "2026-10-03")[9].days[10].color.background,
  "#dce8e3",
);
for (const year of [2024, 2026, 2028, 2100]) {
  const months = Y.months(state, year, "2026-10-02"),
    dates = months.flatMap((m) => m.days.map((d) => d.date));
  assert.equal(dates.length, year === 2024 || year === 2028 ? 366 : 365);
  assert.equal(new Set(dates).size, dates.length);
  assert(dates.every(C.validDate));
  for (const m of months)
    assert.equal(m.offset, (C.localDate(m.days[0].date).getDay() + 6) % 7);
}
state.days["2026-09-28"] = {
  actual: { start: "08:00", end: "20:30", nextDay: false },
  leaveMinutes: 60,
};
let result = Y.months(state, 2026, "2026-10-02").flatMap((m) => m.days);
let day = result.find((d) => d.date === "2026-09-28");
assert(day.leave);
assert.equal(day.color.ratio, 210 / 240);
assert(!day.rest);
assert(result.find((d) => d.date === "2026-09-27").rest);
assert(!result.find((d) => d.date === "2026-10-04").rest);
assert(!result.find((d) => d.date === "2026-09-29").rest);
state.days["2026-10-04"] = { kind: "rest" };
state.days["2026-09-27"] = {
  actual: { start: "08:00", end: "17:30", nextDay: false },
};
result = Y.months(state, 2026, "2026-10-02").flatMap((m) => m.days);
assert(result.find((d) => d.date === "2026-10-04").rest);
assert(!result.find((d) => d.date === "2026-09-27").rest);
assert.equal(result.find((d) => d.date === "2026-09-27").color.ratio, 1);
assert.equal(
  result.find((d) => d.date === "2026-09-28").color.ratio,
  210 / 480,
);
state.days["2026-09-28"].actual.end = "22:30";
assert.equal(
  Y.months(state, 2026, "2026-10-02")[8].days[27].color.ratio,
  330 / 480,
);
console.log(
  "Year view data passed: complete years, leap years, Monday offsets, continuous interpolation, mixed leave/overtime, rest and edits.",
);
