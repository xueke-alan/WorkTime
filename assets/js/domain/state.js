"use strict";
/** state domain. No DOM or storage access. Loaded as an ordered classic script for file://. */
const WorkState = (() => {
  const DEFAULT_START = "08:00",
    DEFAULT_END = "17:30",
    DEFAULT_BREAKS = [
      { start: 720, end: 810 },
      { start: 1050, end: 1080 },
    ];
  const SCHEMA = 1,
    KEY = "worktime-local-v1";
  /** @returns {WorkStateData} A new state with independent arrays and day map. */
  function defaultState() {
    return {
      schemaVersion: SCHEMA,
      scheduleDefaultsVersion: 1,
      targetAverageMinutes: 120,
      overtimeRequirements: [120, null, null, null, null],
      oaUrl: "",
      settings: {
        employmentDate: "",
        configured: true,
        workStart: DEFAULT_START,
        workEnd: DEFAULT_END,
        standardMinutes: 480,
        breaks: DEFAULT_BREAKS.map((b) => ({ ...b })),
      },
      timeTemplates: [],
      days: {},
      imports: [],
    };
  }
  return {
    DEFAULT_START,
    DEFAULT_END,
    DEFAULT_BREAKS,
    SCHEMA,
    KEY,
    defaultState,
  };
})();
