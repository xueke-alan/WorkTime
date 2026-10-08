"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/conversion-source.cjs").readConversionSource({
    withOracle: true,
  }) +
    ";globalThis.C=DomainTest;globalThis.L=FrozenLegacyOracle;globalThis.converter=WorkLegacyV2;globalThis.convert=WorkBackupConversion.convert",
  context,
);
const { C, L, convert } = context,
  plain = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(Object.keys(context.converter).sort(), [
  "acceptedRecords",
  "validate",
]);
const legacy = JSON.parse(
  fs.readFileSync("tests/fixtures/legacy-schema1.json", "utf8"),
);
const original = JSON.stringify(legacy);
const current = L.core.defaultState();
current.pageTheme = "purple";
current.settings.employmentDate = "2024-10-14";
current.settings.workCity = "深圳市";
current.days = legacy.days;
current.imports = legacy.imports;
current.scheduleRanges = [
  {
    start: "2026-09-29",
    end: null,
    schedule: {
      workStart: "09:00",
      workEnd: "18:00",
      standardMinutes: 480,
      breaks: [{ start: 720, end: 780 }],
    },
  },
];
for (const input of [legacy, current]) {
  const old = L.validate(input),
    result = convert(input);
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.preferences.pageTheme, input.pageTheme || "green");
  assert.deepEqual(plain(result.personal), {
    employmentDate: old.settings.employmentDate,
    workCity: old.settings.workCity,
  });
  assert.deepEqual(
    plain(C.summary(result, "2026-09-01", "2026-09-30")),
    plain(L.core.summary(old, "2026-09-01", "2026-09-30")),
  );
  assert.deepEqual(plain(result.scheduleRanges), plain(old.scheduleRanges));
  assert.deepEqual(plain(result.days), plain(old.days));
  assert.deepEqual(plain(C.validateBackup(result)), plain(result));
  assert(result.imports.every((log) => Array.isArray(log.records)));
  assert.throws(
    () => C.validateBackup(input),
    (error) => error.code === "UNSUPPORTED_VERSION",
  );
  const a = plain(old),
    b = plain(result);
  L.core.deleteImport(a, "legacy");
  C.deleteImport(b, "legacy");
  assert.deepEqual(b.days, a.days);
}
assert.equal(
  JSON.stringify(legacy),
  original,
  "Conversion never mutates input",
);
const rejected = L.core.defaultState();
rejected.imports = [
  {
    id: "rejected",
    at: "2026-09-30T05:00:00Z",
    year: 2026,
    count: 1,
    sources: [{ name: "raw", raw: "09/28\n08:00\n18:00" }],
    records: [],
  },
];
assert.equal(
  convert(rejected).imports[0].records.length,
  0,
  "Explicitly rejected raw data is never accepted by conversion",
);
assert.throws(
  () => convert({ ...legacy, days: { invalid: {} } }),
  /days.invalid/,
);
console.log(
  "Backup conversion: schema 1/2, profile/theme, per-date schedules, monthly statistics, accepted-only replay, immutable inputs and version rejection passed.",
);
