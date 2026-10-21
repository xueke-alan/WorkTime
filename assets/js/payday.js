/* Monthly payroll uses the same built-in calendar as the work-time view. */
(function (g) {
  "use strict";
  const { validDate, localDate, dateKey } = WorkTimeApp.domain.time;
  const { calendarInfo, calendarKnown } = WorkTimeApp.domain.calendar;
  function calculate(referenceDate) {
    if (!validDate(referenceDate))
      throw Error(WorkTimeApp.i18n.t("copy.52a119a93b"));
    const scheduled = referenceDate.slice(0, 7) + "-15",
      candidate = localDate(scheduled);
    let date = scheduled,
      shiftedDays = 0;
    while (!calendarInfo(date).work) {
      if (shiftedDays >= 31) throw Error(WorkTimeApp.i18n.t("copy.91620d214e"));
      candidate.setDate(candidate.getDate() - 1);
      date = dateKey(candidate);
      shiftedDays++;
    }
    return {
      date,
      scheduled,
      shiftedDays,
      weekday: WorkTimeApp.i18n.weekday(dateKey(candidate)),
      calendarKnown: calendarKnown(referenceDate),
    };
  }
  WorkTimeApp.domain.payday = { calculate };
})(typeof window === "undefined" ? globalThis : window);
