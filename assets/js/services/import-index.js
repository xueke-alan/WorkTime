"use strict";
/** Raw-source lookup is separate from accepted records used by domain replay. */
const WorkImportIndex = (() => {
  function create({ core }) {
    let descriptions = new WeakMap(),
      indexedLogs = [],
      dates = new Map();
    function describe(log) {
      let value = descriptions.get(log);
      if (!value) {
        const rawDates = [
          ...new Set(
            log.sources.flatMap((source) =>
              core
                .parseText(source.raw, log.year, source.name)
                .records.map((record) => record.date),
            ),
          ),
        ].sort();
        const acceptedDates = Array.isArray(log.records)
          ? [...new Set(log.records.map((record) => record.date))].sort()
          : rawDates;
        value = Object.freeze({
          rawDates: Object.freeze(rawDates),
          acceptedDates: Object.freeze(acceptedDates),
          legacy: !Array.isArray(log.records),
        });
        descriptions.set(log, value);
      }
      return value;
    }
    function logsForDate(logs, date) {
      if (
        logs.length !== indexedLogs.length ||
        logs.some((log, i) => log !== indexedLogs[i])
      ) {
        dates = new Map();
        indexedLogs = logs.slice();
        for (const log of logs)
          for (const key of describe(log).rawDates) {
            if (!dates.has(key)) dates.set(key, []);
            dates.get(key).push(log);
          }
      }
      return (dates.get(date) || []).slice();
    }
    function dispose() {
      descriptions = new WeakMap();
      indexedLogs = [];
      dates.clear();
    }
    return { describe, logsForDate, dispose };
  }
  return { create };
})();
