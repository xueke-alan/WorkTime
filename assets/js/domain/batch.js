"use strict";
/** Pure batch candidates shared by preview and atomic confirmation. */
const WorkTimeDomainBatch = (() => {
  const owned = new Set([
    "oa",
    "actual",
    "estimate",
    "draft",
    "kind",
    "note",
    "sourcePriority",
  ]);
  function resetBatchDay(old) {
    // Keep untouched OA/extension records shared with the authoritative state.
    if (
      Object.keys(old).length &&
      Object.keys(old).every(
        (key) => !owned.has(key) || (key === "oa" && old.oa),
      )
    )
      return old;
    const day = Object.fromEntries(
      Object.entries(old).filter(([key]) => !owned.has(key)),
    );
    if (old.oa) day.oa = old.oa;
    return Object.keys(day).length ? day : null;
  }
  function applyBatchChanges(
    state,
    { dates = [], reset = "none", record = null, month = null },
  ) {
    if (
      (month !== null || reset === "all") &&
      !WorkTimeApp.domain.time.validDate(month + "-01")
    )
      throw Error("Invalid batch month");
    const inMonth = (date) => month === null || date.slice(0, 7) === month;
    const selected = [...new Set(dates)].filter(
      (date) =>
        WorkTimeApp.domain.schedule.canBatchEditDate(state, date) &&
        inMonth(date),
    );
    if (!["none", "selected", "all"].includes(reset))
      throw Error("Invalid batch reset scope");
    if (record && !WorkTimeApp.domain.records.complete(record))
      throw Error("Invalid batch time");
    const resetDates =
      reset === "all"
        ? Object.keys(state.days).filter(inMonth)
        : reset === "selected"
          ? selected
          : [];
    const changed = new Set([...resetDates, ...(record ? selected : [])]);
    if (!changed.size) return state;
    let days = state.days;
    function replace(date, day) {
      if (day === days[date]) return;
      if (days === state.days) days = { ...state.days };
      if (day) days[date] = day;
      else delete days[date];
    }
    for (const date of resetDates) {
      if (!days[date]) continue;
      const day = resetBatchDay(days[date]);
      replace(date, day);
    }
    if (record)
      for (const date of selected) {
        const day = { ...days[date] };
        const field = day.oa || day.actual ? "actual" : "estimate";
        const extensions = Object.fromEntries(
          Object.entries(day[field] || {}).filter(
            ([key]) =>
              !["start", "end", "nextDay", "effectiveMinutes"].includes(key),
          ),
        );
        day[field] = { ...extensions, ...record };
        if (field === "actual") delete day.estimate;
        delete day.draft;
        replace(date, day);
      }
    return days === state.days ? state : { ...state, days };
  }
  return { resetBatchDay, applyBatchChanges };
})();

WorkTimeApp.domain.batch = WorkTimeDomainBatch;
