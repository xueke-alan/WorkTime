"use strict";
// Review diagnostics: known defects are reported explicitly without changing production code.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=WorkTime",
  context,
);
const C = context.C;
const result = { checks: [], findings: [] };
function check(name, fn) {
  fn();
  result.checks.push(name);
}
check("default backup round trip", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(C.validateBackup(C.defaultState()))),
    JSON.parse(JSON.stringify(C.defaultState())),
  );
});
check("overlapping breaks deducted once", () => {
  assert.equal(
    C.duration(
      { start: "08:00", end: "17:00", nextDay: false },
      {
        breaks: [
          { start: 720, end: 780 },
          { start: 750, end: 810 },
        ],
      },
    ),
    450,
  );
});
check("overnight breaks on both dates", () => {
  assert.equal(
    C.duration(
      { start: "20:00", end: "08:00", nextDay: true },
      {
        breaks: [
          { start: 1320, end: 1380 },
          { start: 360, end: 420 },
        ],
      },
    ),
    600,
  );
});
check("OA parser incomplete, invalid date and multiple punches", () => {
  assert.equal(C.parseText("09/28\n08:00", 2026).records[0].status, "pending");
  assert.equal(C.parseText("02/30\n08:00\n17:30", 2026).records.length, 0);
  assert.equal(
    C.parseText("09/28\n08:00\n12:00\n17:30", 2026).records.length,
    0,
  );
});
check("incomplete import does not overwrite complete observation", () => {
  const old = {
    start: "08:00",
    end: "17:30",
    nextDay: false,
    status: "complete",
  };
  assert.equal(
    C.mergeObservation(old, {
      start: "08:00",
      end: "",
      nextDay: false,
      status: "pending",
    }).record,
    old,
  );
});
check("delete latest conflicting import restores earlier observation", () => {
  const state = C.defaultState(),
    date = "2026-09-28";
  const first = {
    date,
    start: "08:00",
    end: "17:30",
    nextDay: false,
    status: "complete",
    source: "a",
    raw: "",
  };
  const second = { ...first, end: "18:30", source: "b" };
  state.imports = [
    { id: "a", records: [first], sources: [] },
    { id: "b", records: [second], sources: [] },
  ];
  C.applyObservation(state, first, "a");
  C.applyObservation(state, second, "b");
  assert.equal(C.deleteImport(state, "b").restored, 1);
  assert.equal(state.days[date].oa.end, "17:30");
});
check("malformed backup rejected", () => {
  const state = C.defaultState();
  state.days["2026-02-30"] = {};
  assert.throws(() => C.validateBackup(state));
});
{
  const state = C.defaultState();
  state.settings = {
    ...state.settings,
    workStart: "08:00",
    workEnd: "12:00",
    standardMinutes: 480,
    breaks: [],
  };
  state.days["2026-09-28"] = { leaveMinutes: 480 };
  let rejection = "";
  try {
    C.validateBackup(state);
  } catch (e) {
    rejection = e.message;
  }
  if (rejection) {
    result.findings.push({
      id: "R03",
      name: "inconsistent normalized leave rejected",
      reproduced: false,
      rejection,
    });
  } else {
    const accepted = C.validateBackup(state);
    let secondValidationError = "";
    try {
      C.validateBackup(accepted);
    } catch (e) {
      secondValidationError = e.message;
    }
    result.findings.push({
      id: "R03",
      name: "backup validation is not closed under round trip",
      derivedStandard: accepted.settings.standardMinutes,
      leave: accepted.days["2026-09-28"].leaveMinutes,
      secondValidationError,
      reproduced: !!secondValidationError,
    });
  }
}
{
  const state = C.defaultState(),
    date = "2026-09-28";
  state.days[date] = {
    oa: {
      date,
      start: "",
      end: "",
      nextDay: false,
      status: "complete",
      effectiveMinutes: 480,
      source: "test",
      raw: "",
    },
  };
  let rejection = "";
  try {
    C.validateBackup(state);
  } catch (e) {
    rejection = e.message;
  }
  if (rejection) {
    result.findings.push({
      id: "R04",
      name: "OA correction field rejected",
      reproduced: false,
      rejection,
    });
  } else {
    const accepted = C.validateBackup(state);
    let secondValidationError = "";
    try {
      C.validateBackup(accepted);
    } catch (e) {
      secondValidationError = e.message;
    }
    result.findings.push({
      id: "R04",
      name: "OA effectiveMinutes accepted then discarded",
      completeAfterValidation: C.complete(accepted.days[date].oa),
      secondValidationError,
      reproduced: !!secondValidationError,
    });
  }
}
console.log(JSON.stringify(result, null, 2));
if (process.env.REVIEW_OUTPUT)
  fs.writeFileSync(
    process.env.REVIEW_OUTPUT,
    JSON.stringify(result, null, 2) + "\n",
  );
