"use strict";
/** calendar domain. No DOM or storage access. Loaded as an ordered classic script for file://. */
WorkTimeApp.domain.calendar = (() => {
  const { dateKey, localDate } = WorkTimeApp.domain.time;
  const holidays = {},
    makeups = new Set();
  const calendarSchedules = WorkTimeApp.data.calendars.schedules;
  const struggleDays = new Set(WorkTimeApp.data.struggleDays);
  const festivalData = WorkTimeApp.data.majorFestivals,
    movableFestivals = new Map();
  for (const [year, dates] of Object.entries(festivalData.years))
    dates.forEach((date, index) => {
      const key = year + "-" + date;
      const names = movableFestivals.get(key) || [];
      names.push(festivalData.movableNames[index]);
      movableFestivals.set(key, names);
    });
  function festivalName(date) {
    return [
      festivalData.fixed[date.slice(5)],
      ...(movableFestivals.get(date) || []),
    ]
      .filter(Boolean)
      .join("、");
  }
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
      label = festivalName(k) || (weekend ? "周末" : "工作日");
    if (holidays[k]) {
      work = false;
      label = holidays[k];
    }
    if (makeups.has(k)) {
      work = true;
      label = "调休补班";
    }
    if (struggleDays.has(k)) label = "奋斗日";
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
      festival: festivalName(k),
      makeup: makeups.has(k),
      label,
      holiday: work ? "" : holidays[k] || "",
      weekend: weekend && !work,
    };
  }
  return {
    holidays,
    makeups,
    calendarSchedules,
    calendarKnown,
    calendarInfo,
    festivalName,
  };
})();
