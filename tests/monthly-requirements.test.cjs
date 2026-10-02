const assert = require("node:assert/strict"),
  vm = require("node:vm");
const source = require("./helpers/core-source.cjs").readCoreSource();
const context = vm.createContext({});
vm.runInContext(source + ";globalThis.C=WorkTime", context);
const C = context.C,
  make = () => C.defaultState(),
  count = (s) => C.selectOvertimeRequirement(s, "2026-09-01", "2026-09-30"),
  record = {
    start: "08:00",
    end: "12:00",
    nextDay: false,
    effectiveMinutes: null,
  };
for (let n = 0; n <= 5; n++) {
  const s = make();
  s.overtimeRequirements = [120, 110, 100, 90, 80];
  ["2026-09-05", "2026-09-06", "2026-09-12", "2026-09-13", "2026-09-19"]
    .slice(0, n)
    .forEach((k) => (s.days[k] = { plannedOvertime: true }));
  assert.equal(count(s).tier, Math.min(n, 4));
  assert.equal(count(s).targetMinutes, s.overtimeRequirements[Math.min(n, 4)]);
}
const s = make();
s.days["2026-09-05"] = { actual: { ...record }, plannedOvertime: true };
s.days["2026-09-06"] = { plannedOvertime: true };
s.days["2026-09-20"] = { plannedOvertime: true };
s.days["2026-08-29"] = { plannedOvertime: true };
assert.equal(count(s).actualDays, 1);
assert.equal(count(s).plannedDays, 1);
assert.equal(count(s).targetMinutes, null);
const before = JSON.stringify(C.summary(s, "2026-09-01", "2026-09-30"));
delete s.days["2026-09-06"].plannedOvertime;
assert.equal(JSON.stringify(C.summary(s, "2026-09-01", "2026-09-30")), before);
s.days["2026-09-05"].kind = "work";
assert.equal(count(s).totalDays, 0);
s.days["2026-09-05"].kind = "rest";
assert.equal(count(s).totalDays, 1);
s.days["2026-09-06"] = { draft: { start: "08:00", end: "", nextDay: false } };
assert.equal(count(s).totalDays, 1);
s.days["2026-09-06"] = { actual: { ...record, effectiveMinutes: 0 } };
assert.equal(count(s).totalDays, 1);
const old = make();
delete old.overtimeRequirements;
old.targetAverageMinutes = 95;
const restored = C.validateBackup(old);
assert.equal(
  JSON.stringify(restored.overtimeRequirements),
  "[95,null,null,null,null]",
);
s.overtimeRequirements = [120, 90.6, 0, null, 20];
assert.equal(C.validateBackup(s).days["2026-09-05"].plannedOvertime, true);
assert.equal(
  JSON.stringify(C.validateBackup(s).overtimeRequirements),
  JSON.stringify(s.overtimeRequirements),
);
for (const values of [
  [null, 1, 2, 3, 4],
  [-1, 1, 2, 3, 4],
  [120, 1441, null, null, null],
  [120, NaN, null, null, null],
])
  assert.throws(() => C.validateOvertimeRequirements(values));
assert.throws(() =>
  C.validateBackup({
    ...s,
    days: { "2026-09-05": { plannedOvertime: "yes" } },
  }),
);
const base = make();
base.days["2026-09-05"] = { plannedOvertime: true };
base.overtimeRequirements = [120, 60, null, null, null];
const condition = count(base),
  pace = C.targetPace(
    base,
    "2026-09-01",
    "2026-09-30",
    "2026-09-01",
    condition.targetMinutes,
  );
assert.equal(pace.difference, pace.plannedDays * 60);
console.log("Monthly requirement core checks passed");

const removal = make(),
  date = "2026-09-05",
  oa = {
    date,
    start: "08:00",
    end: "12:00",
    nextDay: false,
    status: "complete",
    source: "test",
    raw: "",
  };
removal.days[date] = {
  oa: { ...oa, importId: "batch" },
  plannedOvertime: true,
};
removal.imports = [{ id: "batch", records: [oa], sources: [], count: 1 }];
C.deleteImport(removal, "batch");
assert.equal(removal.days[date].plannedOvertime, true);
assert.equal(count(removal).plannedDays, 1);
