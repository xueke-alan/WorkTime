(function (g) {
  "use strict";
  const { businessDate, timeMin } = WorkTimeApp.domain.time;
  const { scheduleForDate } = WorkTimeApp.domain.schedule;
  const { effectiveRecord, complete } = WorkTimeApp.domain.records;
  const { calendarInfo } = WorkTimeApp.domain.calendar;
  let state = null;
  function calculate(s, now = new Date()) {
    const date = businessDate(now),
      day = s?.days?.[date] || {};
    if (!s)
      return {
        date,
        status: "unavailable",
        message: WorkTimeApp.i18n.t("copy.4561283ba2"),
      };
    const schedule = scheduleForDate(s, date);
    const record = effectiveRecord(day, true),
      work =
        calendarInfo(date, day).work ||
        !!day.plannedOvertime ||
        !!(record && complete(record));
    if (!work)
      return {
        date,
        status: "rest",
        message: WorkTimeApp.i18n.t("copy.c1b80631c8"),
      };
    if (day.leaveMinutes > 0 && day.leaveMinutes >= schedule.standardMinutes)
      return {
        date,
        status: "leave",
        message: WorkTimeApp.i18n.t("copy.c22427e005"),
      };
    const start = schedule.workStart,
      end = schedule.workEnd;
    if (timeMin(start) === null || timeMin(end) === null || end <= start)
      return {
        date,
        status: "unavailable",
        message: WorkTimeApp.i18n.t("copy.a46e2b9933"),
      };
    const beforeStart =
        now.getTime() < Date.parse(date + "T" + start + ":00+08:00"),
      targetTime = beforeStart ? start : end,
      target = Date.parse(date + "T" + targetTime + ":00+08:00"),
      seconds = Math.max(0, Math.ceil((target - now.getTime()) / 1000));
    return {
      date,
      status: beforeStart ? "before-start" : seconds ? "counting" : "done",
      message: beforeStart
        ? WorkTimeApp.i18n.t("copy.d303bfd3b3")
        : seconds
          ? WorkTimeApp.i18n.t("copy.091c989a01")
          : WorkTimeApp.i18n.t("copy.70b97a5ce9"),
      detail: seconds
        ? targetTime +
          (beforeStart
            ? WorkTimeApp.i18n.t("copy.be1d14e51f")
            : WorkTimeApp.i18n.t("copy.e0af82c8c2"))
        : WorkTimeApp.i18n.t("copy.2233059cf7"),
      start,
      end,
      targetTime,
      nextDay: false,
      source: beforeStart
        ? WorkTimeApp.i18n.t("copy.1bd8b32cc0")
        : WorkTimeApp.i18n.t("copy.945ee05122"),
      seconds,
      time: seconds
        ? [
            Math.floor(seconds / 3600),
            Math.floor((seconds % 3600) / 60),
            seconds % 60,
          ]
            .map((n) => String(n).padStart(2, "0"))
            .join(":")
        : null,
    };
  }
  const api = {
    calculate,
    setState(s) {
      state = s;
    },
  };
  WorkTimeApp.services.countdown = api;
  WorkTimeApp.services.dateInfo?.register({
    id: "countdown",
    label: WorkTimeApp.i18n.t("copy.b78b63b0b9"),
    icon: "clock",
    getContent() {
      const c = calculate(state);
      return {
        title: WorkTimeApp.i18n.t("copy.b78b63b0b9"),
        date: c.date,
        countdown: c,
      };
    },
  });
})(typeof window === "undefined" ? globalThis : window);
