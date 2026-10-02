"use strict";
/** Stable public API. Domain modules load first; see index.html. */
const WorkTime = (() => {
  const {
    pad,
    dateKey,
    businessDate,
    businessMinutes,
    localDate,
    validDate,
    timeMin,
    breakMin,
    formatMinutes,
    hours,
  } = WorkTimeValues;
  const { DEFAULT_START, DEFAULT_END, SCHEMA, KEY, defaultState } = WorkState;
  const { applyScheduleDefaults } = WorkMigrations;
  const { calendarKnown, calendarInfo } = WorkCalendar;
  const { actualRecord, effectiveRecord, complete, duration, calculate } =
    WorkRecords;
  const {
    oaStaleness,
    attendanceHoursThrough,
    cumulativeAverageOvertime,
    pendingWorkdays,
    summary,
    countRestOvertimeDays,
    selectOvertimeRequirement,
    targetPace,
  } = WorkStatistics;
  const {
    parseText,
    mergeObservation,
    applyObservation,
    importRecords,
    deleteImport,
  } = WorkObservations;
  const { validateOvertimeRequirements, validateTimeTemplate, validateBackup } =
    WorkValidation;
  return {
    calendarKnown,
    oaStaleness,
    validateOvertimeRequirements,
    countRestOvertimeDays,
    selectOvertimeRequirement,
    attendanceHoursThrough,
    targetPace,
    cumulativeAverageOvertime,
    pendingWorkdays,
    importRecords,
    deleteImport,
    validateTimeTemplate,
    DEFAULT_START,
    DEFAULT_END,
    applyScheduleDefaults,
    SCHEMA,
    KEY,
    pad,
    dateKey,
    businessDate,
    businessMinutes,
    localDate,
    validDate,
    timeMin,
    breakMin,
    formatMinutes,
    hours,
    defaultState,
    calendarInfo,
    parseText,
    mergeObservation,
    actualRecord,
    effectiveRecord,
    complete,
    duration,
    calculate,
    summary,
    applyObservation,
    validateBackup,
  };
})();
