"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/conversion-source.cjs").readConversionSource({
    withOracle: true,
  }) +
    ";globalThis.C=DomainTest;globalThis.L=FrozenLegacyOracle;globalThis.convert=WorkBackupConversion.convert",
  context,
);
const C = context.C;
const plain = (value) => JSON.parse(JSON.stringify(value));
for (const breaks of [
  [],
  [{ start: 720, end: 780 }],
  [
    { start: 660, end: 720 },
    { start: 700, end: 760 },
  ],
]) {
  const input = context.L.core.defaultState();
  delete input.scheduleDefaultsVersion;
  input.settings.breaks = breaks;
  input.settings.workStart = "09:00";
  input.settings.workEnd = "18:00";
  input.settings.configured = false;
  const state = context.convert(input),
    { employmentDate, workCity, ...before } = plain(
      context.L.validate(input).settings,
    );
  assert.deepEqual(
    plain(state.settings),
    before,
    "Legacy migration must preserve custom settings",
  );
  assert.equal(state.schemaVersion, 3);
  assert.deepEqual(plain(state.personal), { employmentDate, workCity });
  assert.deepEqual(plain(C.validateBackup(state).settings), before);
}
const first = C.defaultState(),
  second = C.defaultState();
assert.equal(
  first.oaUrl,
  "https://hr.huawei.com/apps/servicetimeflow/#/myServicetime",
);
assert.equal(C.validateBackup({ ...second, oaUrl: "" }).oaUrl, first.oaUrl);
assert.equal(
  C.validateBackup({ ...second, oaUrl: "https://example.com/oa" }).oaUrl,
  "https://example.com/oa",
);
first.settings.breaks[0].start++;
assert.notEqual(
  first.settings.breaks[0].start,
  second.settings.breaks[0].start,
);
console.log(
  "Migrations passed: custom/empty/overlapping breaks, configured flag, independent defaults and idempotent round trip.",
);
