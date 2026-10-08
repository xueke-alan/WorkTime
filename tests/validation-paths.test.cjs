"use strict";
const assert = require("node:assert/strict"),
  vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/conversion-source.cjs").readConversionSource() +
    ";globalThis.C=DomainTest;globalThis.convert=WorkBackupConversion.convert",
  context,
);
const C = context.C;
const plain = (value) => JSON.parse(JSON.stringify(value));
function example() {
  const s = plain(C.defaultState());
  s.days["2026-09-28"] = {
    actual: {
      start: "08:00",
      end: "17:30",
      nextDay: false,
      effectiveMinutes: null,
    },
    leaveMinutes: 0,
  };
  s.imports = [
    {
      id: "old",
      at: "2026-09-28T12:00:00Z",
      year: 2026,
      sources: [{ name: "old", raw: "09/28\n08:00\n17:30" }],
      count: 1,
      records: [
        {
          date: "2026-09-28",
          start: "08:00",
          end: "17:30",
          nextDay: false,
          status: "complete",
        },
      ],
    },
  ];
  s.timeTemplates = [
    { id: "one", name: "常规", start: "08:00", end: "17:30", nextDay: false },
  ];
  return s;
}
const cases = [
  [
    "settings.breaks[0]",
    (s) => {
      delete s.settings.breaks[0];
    },
  ],
  [
    "overtimeRequirements[0]",
    (s) => {
      delete s.overtimeRequirements[0];
    },
  ],
  [
    "imports[0]",
    (s) => {
      delete s.imports[0];
    },
  ],
  [
    "imports[0].sources[0]",
    (s) => {
      delete s.imports[0].sources[0];
    },
  ],
  [
    "imports[0].records[0]",
    (s) => {
      delete s.imports[0].records[0];
    },
  ],
  [
    "timeTemplates[0]",
    (s) => {
      delete s.timeTemplates[0];
    },
  ],
  [
    "imports[0].count",
    (s) => {
      s.imports[0].count = {};
    },
  ],
  [
    "imports[0].sources[0].raw",
    (s) => {
      s.imports[0].sources[0].raw = {};
    },
  ],
  ["$", () => null],
  [
    "schemaVersion",
    (s) => {
      s.schemaVersion = 2;
    },
  ],
  [
    "settings",
    (s) => {
      s.settings = [];
    },
  ],
  [
    "days",
    (s) => {
      s.days = [];
    },
  ],
  [
    "imports",
    (s) => {
      s.imports = {};
    },
  ],
  [
    "settings.configured",
    (s) => {
      s.settings.configured = 1;
    },
  ],
  [
    "settings.standardMinutes",
    (s) => {
      s.settings.standardMinutes = 0;
    },
  ],
  [
    "settings.breaks",
    (s) => {
      s.settings.breaks = null;
    },
  ],
  [
    "settings.breaks[0]",
    (s) => {
      s.settings.breaks[0] = null;
    },
  ],
  [
    "settings.breaks[0].start",
    (s) => {
      s.settings.breaks[0].start = -1;
    },
  ],
  [
    "settings.breaks[0].end",
    (s) => {
      s.settings.breaks[0].end = 0;
    },
  ],
  [
    "settings.workStart",
    (s) => {
      s.settings.workStart = "bad";
    },
  ],
  [
    "settings.workEnd",
    (s) => {
      s.settings.workEnd = "07:00";
    },
  ],
  [
    "personal.employmentDate",
    (s) => {
      s.personal.employmentDate = "2026-02-30";
    },
  ],
  [
    "oaUrl",
    (s) => {
      s.oaUrl = "file:///test";
    },
  ],
  [
    "overtimeRequirements[0]",
    (s) => {
      s.overtimeRequirements[0] = -1;
    },
  ],
  [
    "overtimeRequirements[0]",
    (s) => {
      s.overtimeRequirements[0] = null;
    },
  ],
  [
    "overtimeRequirements[3]",
    (s) => {
      s.overtimeRequirements[3] = "2";
    },
  ],
  [
    "days.2026-09-28.kind",
    (s) => {
      s.days["2026-09-28"].kind = "other";
    },
  ],
  [
    "days.2026-09-28.note",
    (s) => {
      s.days["2026-09-28"].note = {};
    },
  ],
  [
    "days.2026-09-28.plannedOvertime",
    (s) => {
      s.days["2026-09-28"].plannedOvertime = 1;
    },
  ],
  [
    "days.2026-09-28.leaveMinutes",
    (s) => {
      s.days["2026-09-28"].leaveMinutes = 481;
    },
  ],
  [
    "days.2026-09-28.actual",
    (s) => {
      s.days["2026-09-28"].actual = false;
    },
  ],
  [
    "days.2026-09-28.actual.start",
    (s) => {
      s.days["2026-09-28"].actual.start = null;
    },
  ],
  [
    "days.2026-09-28.actual.nextDay",
    (s) => {
      s.days["2026-09-28"].actual.nextDay = "false";
    },
  ],
  [
    "days.2026-09-28.actual.effectiveMinutes",
    (s) => {
      s.days["2026-09-28"].actual.effectiveMinutes = 2881;
    },
  ],
  [
    "days.2026-09-28.actual.end",
    (s) => {
      s.days["2026-09-28"].actual.end = "07:00";
    },
  ],
  [
    "imports[0].id",
    (s) => {
      s.imports[0].id = "";
    },
  ],
  [
    "imports[0].at",
    (s) => {
      s.imports[0].at = "bad";
    },
  ],
  [
    "imports[0].year",
    (s) => {
      s.imports[0].year = 0;
    },
  ],
  [
    "imports[0].sources[0]",
    (s) => {
      s.imports[0].sources[0] = null;
    },
  ],
  [
    "imports[0].count",
    (s) => {
      s.imports[0].count = "bad";
    },
  ],
  [
    "imports[0].records",
    (s) => {
      s.imports[0].records = {};
    },
  ],
  [
    "imports[0].records[0].date",
    (s) => {
      s.imports[0].records[0].date = "2025-09-28";
    },
  ],
  [
    "imports[0].records[0].effectiveMinutes",
    (s) => {
      Object.assign(s.imports[0].records[0], {
        start: "",
        end: "",
        effectiveMinutes: 480,
      });
    },
  ],
  [
    "timeTemplates",
    (s) => {
      s.timeTemplates = {};
    },
  ],
  [
    "timeTemplates[0].name",
    (s) => {
      s.timeTemplates[0].name = "";
    },
  ],
  [
    "timeTemplates[0].end",
    (s) => {
      s.timeTemplates[0].end = "07:00";
    },
  ],
  [
    "timeTemplates[1].id",
    (s) => {
      s.timeTemplates.push({ ...s.timeTemplates[0] });
    },
  ],
  [
    "imports[1].id",
    (s) => {
      s.imports.push({ ...s.imports[0] });
    },
  ],
];
for (const [expected, mutate] of cases) {
  const s = example(),
    value = mutate(s);
  assert.throws(
    () => C.validateBackup(value === null ? null : s),
    (error) => {
      assert.equal(error.name, "BackupValidationError");
      assert.equal(error.path, expected);
      assert(error.message.includes("[" + expected + "]"));
      assert(error.userMessage);
      return true;
    },
    expected,
  );
}
const legacy = example();
legacy.schemaVersion = 2;
for (const theme of ["green", "blue", "purple", "orange", "rose", "slate"]) {
  const themed = example();
  themed.preferences.pageTheme = theme;
  assert.equal(C.validateBackup(themed).preferences.pageTheme, theme);
}
for (const theme of ["invalid", null, 0, {}, "#a64165"]) {
  const invalid = example();
  invalid.preferences.pageTheme = theme;
  assert.throws(
    () => C.validateBackup(invalid),
    (error) => error.path === "preferences.pageTheme",
  );
}
assert.equal(Object.hasOwn(C.validateBackup(example()), "pageTheme"), false);
delete legacy.settings.workStart;
delete legacy.settings.workEnd;
delete legacy.scheduleDefaultsVersion;
delete legacy.overtimeRequirements;
delete legacy.timeTemplates;
delete legacy.imports[0].records;
legacy.imports[0].count = "1";
legacy.days["2026-09-28"].draft = null;
const first = context.convert(legacy),
  second = C.validateBackup(plain(first));
assert.deepEqual(plain(first), plain(second));
assert.equal(C.importRecords(first.imports[0]).length, 1);
assert(Object.hasOwn(first.imports[0], "records"));
console.log(
  `${cases.length} validation paths passed; legacy raw-only logs, optional fields and numeric count normalize round-trip.`,
);
