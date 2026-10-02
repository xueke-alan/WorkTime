"use strict";
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { readCoreSource } = require("../tests/helpers/core-source.cjs");
const realm = vm.createContext({});
vm.runInContext(readCoreSource() + ";globalThis.C = WorkTime", realm);
const C = realm.C;
/** Generated data only; never reads a user's browser storage. */
function buildPerformanceFixture(years, end = "2026-09-30") {
  assert([1, 5, 10].includes(years));
  assert(C.validDate(end));
  const endDate = new Date(end + "T00:00:00Z");
  const nextMonth = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1),
  );
  assert.equal(
    nextMonth.getTime() - endDate.getTime(),
    86400000,
    "End must be a month end",
  );
  const start = new Date(
    Date.UTC(nextMonth.getUTCFullYear() - years, nextMonth.getUTCMonth(), 1),
  );
  const state = C.defaultState();
  state.settings.employmentDate = start.toISOString().slice(0, 10);
  state.timeTemplates = [
    {
      id: "perf-standard",
      name: "标准白班",
      start: "08:00",
      end: "17:30",
      nextDay: false,
    },
    {
      id: "perf-overtime",
      name: "加班白班",
      start: "08:00",
      end: "20:00",
      nextDay: false,
    },
    {
      id: "perf-night",
      name: "跨日夜班",
      start: "21:00",
      end: "06:00",
      nextDay: true,
    },
  ];
  const months = new Map();
  for (
    let time = start.getTime();
    time <= endDate.getTime();
    time += 86400000
  ) {
    const key = new Date(time).toISOString().slice(0, 10),
      month = key.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(key);
  }
  let index = 0;
  for (const [month, dates] of months) {
    const id = "perf-" + month,
      year = Number(month.slice(0, 4));
    const sources = [
      dates.filter((date) => Number(date.slice(8)) <= 15),
      dates.filter((date) => Number(date.slice(8)) > 15),
    ].map((part, i) => ({
      name: `${month} OA ${i + 1}`,
      raw: part
        .map((date) => `${date.slice(5).replace("-", "/")}\n08:00\n19:30`)
        .join("\n"),
    }));
    const records = sources.flatMap((source) => {
      const parsed = C.parseText(source.raw, year, source.name);
      assert.equal(parsed.warnings.length, 0);
      return parsed.records.map((record) => ({ ...record, importId: id }));
    });
    state.imports.push({
      id,
      year,
      at: dates.at(-1) + "T12:00:00+08:00",
      sources,
      records,
      count: records.length,
    });
    for (const record of records) {
      const day = { oa: { ...record } };
      if (index % 17 === 0)
        day.actual = {
          start: "08:00",
          end: "21:00",
          nextDay: false,
          effectiveMinutes: null,
        };
      if (index % 23 === 0) day.leaveMinutes = 60;
      if (index % 31 === 0) day.kind = "rest";
      if (index % 11 === 0) day.note = "性能样本：保留OA导入及手动覆盖。";
      state.days[record.date] = day;
      index++;
    }
  }
  const clean = C.validateBackup(state);
  assert.equal(Object.keys(clean.days).length, index);
  assert.equal(clean.imports.length, years * 12);
  const accepted = clean.imports.flatMap((log) => C.importRecords(log));
  assert.equal(accepted.length, index);
  assert.equal(new Set(accepted.map((record) => record.date)).size, index);
  const plain = JSON.parse(JSON.stringify(clean));
  assert.deepEqual(JSON.parse(JSON.stringify(C.validateBackup(plain))), plain);
  return {
    state: plain,
    metadata: {
      years,
      start: start.toISOString().slice(0, 10),
      end,
      days: index,
      imports: clean.imports.length,
      sources: clean.imports.reduce((n, log) => n + log.sources.length, 0),
      bytes: Buffer.byteLength(JSON.stringify(plain)),
    },
  };
}
module.exports = { buildPerformanceFixture };
