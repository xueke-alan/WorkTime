"use strict";
/** Converts old backups in memory; neither reads nor writes browser storage. */
const WorkBackupConversion = (() => {
  function convert(input) {
    const old = WorkLegacyV2.validate(input);
    const { employmentDate, workCity, ...settings } = old.settings;
    const candidate = {
      schemaVersion: WorkTimeApp.domain.state.SCHEMA,
      settings,
      personal: { employmentDate, workCity },
      preferences: { pageTheme: old.pageTheme || "green" },
      overtimeRequirements: old.overtimeRequirements,
      oaUrl: old.oaUrl,
      scheduleRanges: old.scheduleRanges,
      days: old.days,
      imports: old.imports.map((log) => ({
        ...log,
        records: WorkLegacyV2.acceptedRecords(log).map((record) => ({
          ...record,
        })),
      })),
      timeTemplates: old.timeTemplates,
    };
    return WorkTimeApp.domain.validation.validateBackup(candidate);
  }
  return { convert };
})();
