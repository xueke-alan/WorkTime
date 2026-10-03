"use strict";
/** statistics domain. No DOM or storage access. Loaded as an ordered classic script for file://. */
const WorkStatistics = (() => {
  const {
    dateKey,
    localDate,
    validDate,
    timeMin,
    businessDate,
    businessMinutes,
  } = WorkTimeValues;
  const { DEFAULT_START } = WorkState;
  const { calendarInfo } = WorkCalendar;
  const { effectiveRecord, complete, duration, calculate } = WorkRecords;
  function oaStaleness(state, today = businessDate()) {
    const latest = Object.keys(state.days)
      .filter((k) => validDate(k) && k <= today && state.days[k].oa)
      .sort()
      .pop();
    if (!latest) return null;
    const dayNumber = (k) => {
      const [y, m, d] = k.split("-").map(Number);
      return Date.UTC(y, m - 1, d) / 86400000;
    };
    const days = dayNumber(today) - dayNumber(latest);
    return { date: latest, days, stale: days >= 3 };
  }
  function attendanceHoursThrough(state, start, end, endDay) {
    if (!validDate(start) || !validDate(end) || start > end) return null;
    let expectedMinutes = 0,
      workedMinutes = 0;
    const cursor = localDate(start);
    while (dateKey(cursor) <= end) {
      const k = dateKey(cursor),
        day = k === end && endDay ? endDay : state.days[k] || {};
      if (calendarInfo(k, day).work)
        expectedMinutes += Math.max(
          0,
          state.settings.standardMinutes - (day.leaveMinutes || 0),
        );
      const actual = calculate(k, day, state.settings, true);
      if (actual.minutes !== null) workedMinutes += actual.minutes;
      cursor.setDate(cursor.getDate() + 1);
    }
    return { expectedMinutes, workedMinutes };
  }
  function cumulativeAverageOvertime(state, start, end, endDay) {
    const values = {};
    if (!validDate(start) || !validDate(end) || start > end) return values;
    // Denominator includes scheduled attendance only for complete workday records.
    let scheduledMinutes = 0,
      workOvertimeMinutes = 0;
    const cursor = localDate(start);
    while (dateKey(cursor) <= end) {
      const k = dateKey(cursor),
        day = k === end && endDay ? endDay : state.days[k] || {},
        info = calendarInfo(k, day),
        result = calculate(k, day, state.settings, true),
        pending =
          info.work &&
          (day.leaveMinutes || 0) < state.settings.standardMinutes &&
          result.minutes === null;
      if (state.settings.configured && info.work) {
        if (result.minutes !== null) {
          scheduledMinutes += Math.max(
            0,
            state.settings.standardMinutes - (day.leaveMinutes || 0),
          );
          workOvertimeMinutes += result.overtime;
        }
      }
      values[k] = {
        scheduledMinutes,
        workOvertimeMinutes,
        pending,
        averageMinutes:
          scheduledMinutes && !pending
            ? (workOvertimeMinutes * state.settings.standardMinutes) /
              scheduledMinutes
            : null,
      };
      cursor.setDate(cursor.getDate() + 1);
    }
    return values;
  }
  function pendingWorkdays(
    state,
    start,
    end,
    asOf = businessDate(),
    now = new Date(),
  ) {
    if (!validDate(start) || !validDate(end) || !validDate(asOf)) return 0;
    const last = end < asOf ? end : asOf;
    if (start > last) return 0;
    const currentDate = businessDate(now),
      beforeWorkStart =
        asOf === currentDate &&
        businessMinutes(now) <
          timeMin(state.settings.workStart || DEFAULT_START);
    let count = 0;
    const cursor = localDate(start);
    while (dateKey(cursor) <= last) {
      const k = dateKey(cursor),
        day = state.days[k] || {};
      if (
        !(k === asOf && beforeWorkStart) &&
        calendarInfo(k, day).work &&
        (day.leaveMinutes || 0) < state.settings.standardMinutes &&
        !complete(effectiveRecord(day, true))
      )
        count++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }
  function summary(state, start, end, includeEstimate = true) {
    const out = {
      total: 0,
      workOvertime: 0,
      restOvertime: 0,
      attendance: 0,
      completeDays: 0,
      pending: 0,
      estimatedDays: 0,
      average: null,
    };
    for (const [k, day] of Object.entries(state.days)) {
      if (k < start || k > end) continue;
      const c = calculate(k, day, state.settings, includeEstimate);
      if (
        day.oa &&
        day.oa.status === "pending" &&
        !complete(effectiveRecord(day, true))
      )
        out.pending++;
      if (c.minutes === null) continue;
      out.total += c.minutes;
      out.completeDays++;
      out.estimatedDays += c.record.type === "estimate" ? 1 : 0;
      if (c.work) {
        out.workOvertime += c.overtime;
        out.attendance += c.attendance;
      } else out.restOvertime += c.overtime;
    }
    if (out.attendance > 0) out.average = out.workOvertime / out.attendance;
    return out;
  }
  function countRestOvertimeDays(state, start, end) {
    let actualDays = 0,
      plannedDays = 0;
    for (const [date, day] of Object.entries(state.days)) {
      if (date < start || date > end || calendarInfo(date, day).work) continue;
      const record = effectiveRecord(day, true),
        worked = complete(record) && duration(record, state.settings) > 0;
      if (worked) actualDays++;
      else if (day.plannedOvertime) plannedDays++;
    }
    return { actualDays, plannedDays, totalDays: actualDays + plannedDays };
  }
  function selectOvertimeRequirement(state, start, end) {
    const counts = countRestOvertimeDays(state, start, end),
      tier = Math.min(4, counts.totalDays),
      requirements = state.overtimeRequirements || [
        state.targetAverageMinutes ?? 120,
        null,
        null,
        null,
        null,
      ];
    return { ...counts, tier, targetMinutes: requirements[tier] };
  }
  function targetPace(state, start, end, asOf, targetMinutes, derivedSummary) {
    if (
      !validDate(start) ||
      !validDate(end) ||
      !validDate(asOf) ||
      start > end ||
      !Number.isFinite(targetMinutes) ||
      targetMinutes < 0
    )
      return null;
    const standard = state.settings.standardMinutes,
      earned = (derivedSummary || summary(state, start, end)).workOvertime;
    let plannedDays = 0,
      remainingDays = 0;
    const cursor = localDate(start);
    while (dateKey(cursor) <= end) {
      const k = dateKey(cursor),
        day = state.days[k] || {};
      if (calendarInfo(k, day).work) {
        const portion =
          Math.max(
            0,
            standard - Math.min(standard, Math.max(0, day.leaveMinutes || 0)),
          ) / standard;
        plannedDays += portion;
        if (k >= asOf && !complete(effectiveRecord(day, true)))
          remainingDays += portion;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    const difference = targetMinutes * plannedDays - earned,
      shortfall = Math.max(0, difference),
      rawRequiredPerDay = remainingDays ? difference / remainingDays : null;
    return {
      plannedDays,
      remainingDays,
      earned,
      shortfall,
      difference,
      rawRequiredPerDay,
      requiredPerDay: rawRequiredPerDay,
    };
  }
  return {
    oaStaleness,
    attendanceHoursThrough,
    cumulativeAverageOvertime,
    pendingWorkdays,
    summary,
    countRestOvertimeDays,
    selectOvertimeRequirement,
    targetPace,
  };
})();
