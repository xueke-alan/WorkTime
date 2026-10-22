// Compile-only contract checks, never loaded by the app or executed as tests.
// @ts-expect-error Business clocks require a Date, not a display string.
WorkTimeApp.domain.time.businessDate("2026-10-23");
// @ts-expect-error Domain statistics consume business state, not an arbitrary object.
WorkTimeApp.domain.statistics.summary({ days: {} }, "2026-10-01", "2026-10-31");
WorkTimeApp.domain.records.duration(
  // @ts-expect-error Manual effective minutes must be numeric.
  { start: "08:00", end: "17:30", nextDay: false, effectiveMinutes: "480" },
  { breaks: [] },
);
WorkTimeApp.services.application.createState({
  state: WorkTimeApp.domain.state.defaultState(),
  // @ts-expect-error A state owner must receive domain operations.
  core: {},
  // @ts-expect-error A state owner must receive a persistence contract.
  persistence: {},
});
WorkTimeApp.services.clock.create({
  dateKey: WorkTimeApp.domain.time.businessDate,
  // @ts-expect-error The injected clock must return Date objects.
  now: () => "2026-10-23",
});
/** @type {ReturnType<typeof WorkTimeApp.services.application.createState>} */
let compileOwner;
compileOwner.saveDay("2026-10-23", {
  // @ts-expect-error Persisted leave minutes must be numeric.
  leaveMinutes: "60",
});
