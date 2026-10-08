"use strict";
/** Pure import planning; both clipboard and pasted text use the same conflict policy. */
WorkTimeApp.services.imports = (() => {
  function prepare(core, state, sources, year, referenceDate = null) {
    const records = [],
      warnings = [],
      rows = [];
    const observations = new Map();
    for (const source of sources) {
      const parsed = core.parseText(
        source.raw,
        year,
        source.name,
        referenceDate,
      );
      records.push(...parsed.records);
      warnings.push(...parsed.warnings);
    }
    for (const record of records) {
      const repeated = observations.has(record.date);
      const old = repeated
        ? observations.get(record.date)
        : state.days[record.date]?.oa;
      const merged = core.mergeObservation(old, record);
      // Later rows must not silently revive a previous row that the user rejected.
      const result = repeated
        ? { ...merged, conflict: true, repeated: true }
        : merged;
      rows.push({ record, old, result });
      observations.set(record.date, result.record);
    }
    return {
      year,
      sources,
      records,
      warnings,
      rows,
      needsReview:
        warnings.length > 0 || rows.some((row) => row.result.conflict),
    };
  }
  function acceptedRecords(plan, choose = () => "new") {
    return plan.rows
      .filter(
        (row, index) => !row.result.conflict || choose(row, index) !== "old",
      )
      .map((row) => ({ ...row.record }));
  }
  return { prepare, acceptedRecords };
})();
