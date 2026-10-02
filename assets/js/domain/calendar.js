"use strict";
/** calendar domain. No DOM or storage access. Loaded as an ordered classic script for file://. */
const WorkCalendar = (() => {
  const { dateKey, localDate } = WorkTimeValues;
  const holidays = {},
    makeups = new Set();
  const calendarSchedules = WorkCalendarData.schedules;
  for (const [year, schedule] of Object.entries(calendarSchedules)) {
    for (const [start, end, name] of schedule.off) {
      const date = localDate(year + "-" + start);
      while (dateKey(date) <= year + "-" + end) {
        holidays[dateKey(date)] = name;
        date.setDate(date.getDate() + 1);
      }
    }
    schedule.work.forEach((date) => makeups.add(year + "-" + date));
  }
  const calendarKnown = (date) =>
    Object.hasOwn(calendarSchedules, Number(date.slice(0, 4)));
  function calendarInfo(k, day = {}) {
    const weekend = [0, 6].includes(localDate(k).getDay());
    let work = !weekend,
      label = weekend ? "周末" : "工作日";
    if (holidays[k]) {
      work = false;
      label = holidays[k];
    }
    if (makeups.has(k)) {
      work = true;
      label = "调休补班";
    }
    if (day.kind === "work") {
      work = true;
      label = "工作日 · 手动";
    }
    if (day.kind === "rest") {
      work = false;
      label = "休息日 · 手动";
    }
    return {
      work,
      label,
      holiday: work ? "" : holidays[k] || "",
      weekend: weekend && !work,
    };
  }
  return { holidays, makeups, calendarSchedules, calendarKnown, calendarInfo };
})();
