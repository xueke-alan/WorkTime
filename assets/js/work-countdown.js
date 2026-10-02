(function (g) {
  "use strict";
  let state = null;
  function calculate(s, now = new Date()) {
    const C = typeof WorkTime !== "undefined" ? WorkTime : g.WorkTime,
      date = C
        ? C.businessDate(now)
        : new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10),
      day = s?.days?.[date] || {};
    if (!s || !C)
      return { date, status: "unavailable", message: "请先完成计算设置" };
    const record = C.effectiveRecord(day, true),
      work =
        C.calendarInfo(date, day).work ||
        !!day.plannedOvertime ||
        !!(record && C.complete(record));
    if (!work) return { date, status: "rest", message: "今日不上班" };
    if (day.leaveMinutes > 0 && day.leaveMinutes >= s.settings.standardMinutes)
      return { date, status: "leave", message: "今天全天请假，无需倒计时" };
    const template = s.timeTemplates.find((t) => t.name.trim() === "常规下班"),
      end = template?.end || s.settings.workEnd,
      minutes = C.timeMin(end);
    if (minutes === null)
      return { date, status: "unavailable", message: "请设置常规下班时间" };
    const target =
        Date.parse(date + "T" + end + ":00+08:00") +
        (template?.nextDay ? 86400000 : 0),
      seconds = Math.max(0, Math.ceil((target - now.getTime()) / 1000));
    return {
      date,
      status: seconds ? "counting" : "done",
      message: seconds ? "距离下班" : "已到下班时间",
      end,
      nextDay: !!template?.nextDay,
      source: template ? "常规下班模板" : "标准下班时间",
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
  g.WorkCountdown = api;
  g.DateInfo?.register({
    id: "countdown",
    label: "下班倒计时",
    icon: "clock",
    getContent() {
      const c = calculate(state);
      return { title: "下班倒计时", date: c.date, countdown: c };
    },
  });
})(typeof window === "undefined" ? globalThis : window);
