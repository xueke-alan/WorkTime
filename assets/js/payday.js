/* Monthly payroll uses the same built-in calendar as the work-time view. */
(function (g) {
  "use strict";
  function calculate(referenceDate) {
    const C = typeof WorkTime !== "undefined" ? WorkTime : g.WorkTime;
    if (!C || !C.validDate(referenceDate)) throw Error("日期无效");
    const scheduled = referenceDate.slice(0, 7) + "-15",
      candidate = C.localDate(scheduled);
    let date = scheduled,
      shiftedDays = 0;
    while (!C.calendarInfo(date).work) {
      if (shiftedDays >= 31) throw Error("未找到发薪日前的工作日");
      candidate.setDate(candidate.getDate() - 1);
      date = C.dateKey(candidate);
      shiftedDays++;
    }
    return {
      date,
      scheduled,
      shiftedDays,
      weekday: "周" + "日一二三四五六"[candidate.getDay()],
      calendarKnown: C.calendarKnown(referenceDate),
    };
  }
  g.Payday = { calculate };
})(typeof window === "undefined" ? globalThis : window);
