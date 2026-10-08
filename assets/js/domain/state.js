"use strict";
/** state domain. No DOM or storage access. Loaded as an ordered classic script for file://. */
WorkTimeApp.domain.state = (() => {
  const DEFAULT_START = "08:00",
    DEFAULT_END = "17:30",
    DEFAULT_BREAKS = [
      { start: 720, end: 810 },
      { start: 1050, end: 1080 },
    ];
  const SCHEMA = 3,
    KEY = "worktime-local-v1";
  /** Copy JSON-compatible state for a detached candidate or preview. */
  const cloneState = (state) => JSON.parse(JSON.stringify(state));
  /** @returns {WorkStateData} A new state with independent arrays and day map. */
  function defaultState() {
    return {
      schemaVersion: SCHEMA,
      overtimeRequirements: [60, 90, 90, 120, 120],
      oaUrl: "https://hr.huawei.com/apps/servicetimeflow/#/myServicetime",
      personal: { employmentDate: "", workCity: "" },
      preferences: { pageTheme: "green" },
      settings: {
        configured: true,
        workStart: DEFAULT_START,
        workEnd: DEFAULT_END,
        standardMinutes: 480,
        breaks: DEFAULT_BREAKS.map((b) => ({ ...b })),
      },
      scheduleRanges: [],
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
    cloneState,
    defaultState,
  };
})();
