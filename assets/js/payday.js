/* Monthly payroll uses the same built-in calendar as the work-time view. */
(function (g) {
  "use strict";
  const { validDate, localDate, dateKey } = WorkTimeApp.domain.time;
  const { calendarInfo, calendarKnown } = WorkTimeApp.domain.calendar;
  function calculate(referenceDate) {
    if (!validDate(referenceDate)) throw Error("日期无效");
    const scheduled = referenceDate.slice(0, 7) + "-15",
      candidate = localDate(scheduled);
    let date = scheduled,
      shiftedDays = 0;
    while (!calendarInfo(date).work) {
      if (shiftedDays >= 31) throw Error("未找到发薪日前的工作日");
      candidate.setDate(candidate.getDate() - 1);
      date = dateKey(candidate);
      shiftedDays++;
    }
    return {
      date,
      scheduled,
      shiftedDays,
      weekday: "周" + "日一二三四五六"[candidate.getDay()],
      calendarKnown: calendarKnown(referenceDate),
    };
  }
  WorkTimeApp.domain.payday = { calculate };
})(typeof window === "undefined" ? globalThis : window);
