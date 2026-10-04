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
      return { date, status: "unavailable", message: "请先完成工作时间设置" };
    const schedule = scheduleForDate(s, date);
    const record = effectiveRecord(day, true),
      work =
        calendarInfo(date, day).work ||
        !!day.plannedOvertime ||
        !!(record && complete(record));
    if (!work) return { date, status: "rest", message: "今日不上班" };
    if (day.leaveMinutes > 0 && day.leaveMinutes >= schedule.standardMinutes)
      return { date, status: "leave", message: "今天全天请假，无需倒计时" };
    const end = schedule.workEnd,
      minutes = timeMin(end);
    if (minutes === null)
      return { date, status: "unavailable", message: "请设置常规下班时间" };
    const target = Date.parse(date + "T" + end + ":00+08:00") + 0,
      seconds = Math.max(0, Math.ceil((target - now.getTime()) / 1000));
    return {
      date,
      status: seconds ? "counting" : "done",
      message: seconds ? "距离下班" : "已到下班时间",
      end,
      nextDay: false,
      source: "当日标准下班时间",
      seconds,
      time: [
        Math.floor(seconds / 3600),
        Math.floor((seconds % 3600) / 60),
        seconds % 60,
      ]
        .map((n) => String(n).padStart(2, "0"))
        .join(":"),
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
    label: "下班倒计时",
    icon: "clock",
    getContent() {
      const c = calculate(state);
      return { title: "下班倒计时", date: c.date, countdown: c };
    },
  });
})(typeof window === "undefined" ? globalThis : window);
