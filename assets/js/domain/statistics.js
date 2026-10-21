"use strict";
/** statistics domain. No DOM or storage access. Loaded as an ordered classic script for file://. */
WorkTimeApp.domain.statistics = (() => {
  const {
    dateKey,
    localDate,
    validDate,
    timeMin,
    businessDate,
    businessMinutes,
  } = WorkTimeApp.domain.time;
  const { DEFAULT_START } = WorkTimeApp.domain.state;
  const { calendarInfo } = WorkTimeApp.domain.calendar;
  const { effectiveRecord, complete, duration, calculate } =
    WorkTimeApp.domain.records;
  function oaStaleness(state, today) {
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
  const { scheduleForDate } = WorkTimeApp.domain.schedule;
  /** Monthly clock-time analysis. No storage access; asOf is a business date. */
  function monthlyAnalysis(state, month, asOf, includeManual = false) {
    const [first, last] = WorkTimeApp.domain.time.monthBounds(month);
    const days = [],
      calendarDays = [];
    let run = [],
      longest = [];
    for (let n = 1; n <= Number(last.slice(8)); n++) {
      const date = month + "-" + String(n).padStart(2, "0"),
        day = state.days[date] || {},
        schedule = scheduleForDate(state, date),
        work = calendarInfo(date, day).work;
      calendarDays.push({
        date,
        work,
        workStart: timeMin(schedule.workStart),
        workEnd: timeMin(schedule.workEnd),
      });
      const record = effectiveRecord(day, includeManual);
      if (
        date > asOf ||
        !complete(record) ||
        (!includeManual &&
          (record.manual || record.filledStart || record.filledEnd))
      ) {
        run = [];
        continue;
      }
      const start = timeMin(record.start),
        clockEnd = timeMin(record.end),
        end = clockEnd === null ? null : clockEnd + (record.nextDay ? 1440 : 0),
        result = calculate(date, day, schedule, includeManual);
      if (
        start === null ||
        end === null ||
        end <= start ||
        !(result.minutes > 0)
      ) {
        run = [];
        continue;
      }
      const item = {
        date,
        start,
        end,
        minutes: result.minutes,
        overtime: result.overtime,
        work,
        manual: !!(record.manual || record.filledStart || record.filledEnd),
      };
      days.push(item);
      if (result.overtime > 0) {
        run.push(date);
        if (run.length > longest.length) longest = [...run];
      } else run = [];
    }
    const extreme = (key, pick) => {
      if (!days.length) return null;
      const minutes = pick(...days.map((day) => day[key]));
      return {
        minutes,
        dates: days
          .filter((day) => day[key] === minutes)
          .map((day) => day.date),
      };
    };
    const median = (key) => {
      if (!days.length) return null;
      const values = days.map((day) => day[key]).sort((a, b) => a - b),
        middle = Math.floor(values.length / 2);
      return values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2;
    };
    return {
      first,
      last,
      asOf,
      includeManual,
      calendarDays,
      days,
      count: days.length,
      manualDays: days.filter((day) => day.manual).length,
      earliest: extreme("start", Math.min),
      latest: extreme("end", Math.max),
      latestStart: extreme("start", Math.max),
      earliestEnd: extreme("end", Math.min),
      averageStart: days.length
        ? days.reduce((sum, day) => sum + day.start, 0) / days.length
        : null,
      averageEnd: days.length
        ? days.reduce((sum, day) => sum + day.end, 0) / days.length
        : null,
      overtimeDays: days.filter((day) => day.overtime > 0).length,
      medianStart: median("start"),
      medianEnd: median("end"),
      lateDays: days.filter((day) => day.end > 1260).length,
      longest: {
        count: longest.length,
        dates: longest,
        start: longest[0] || null,
        end: longest.at(-1) || null,
      },
    };
  }
  function attendanceHoursThrough(state, start, end, endDay) {
    if (!validDate(start) || !validDate(end) || start > end) return null;
    let expectedMinutes = 0,
      workedMinutes = 0,
      expectedDays = 0,
      workedDays = 0;
    const cursor = localDate(start);
    while (dateKey(cursor) <= end) {
      const k = dateKey(cursor),
        day = k === end && endDay ? endDay : state.days[k] || {},
        schedule = scheduleForDate(state, k);
      if (calendarInfo(k, day).work) {
        const minutes = Math.max(
          0,
          schedule.standardMinutes - (day.leaveMinutes || 0),
        );
        expectedMinutes += minutes;
        expectedDays += minutes / schedule.standardMinutes;
      }
      const actual = calculate(k, day, schedule, true);
      if (actual.minutes !== null) {
        workedMinutes += actual.minutes;
        workedDays += actual.minutes / schedule.standardMinutes;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return { expectedMinutes, workedMinutes, expectedDays, workedDays };
  }
  function cumulativeAverageOvertime(state, start, end, endDay) {
    const values = {};
    if (!validDate(start) || !validDate(end) || start > end) return values;
    // Denominator includes scheduled attendance only for complete workday records.
    let scheduledMinutes = 0,
      workOvertimeMinutes = 0,
      attendance = 0;
    const cursor = localDate(start);
    while (dateKey(cursor) <= end) {
      const k = dateKey(cursor),
        day = k === end && endDay ? endDay : state.days[k] || {},
        schedule = scheduleForDate(state, k),
        info = calendarInfo(k, day),
        result = calculate(k, day, schedule, true),
        pending =
          info.work &&
          (day.leaveMinutes || 0) < schedule.standardMinutes &&
          result.minutes === null;
      if (state.settings.configured && info.work) {
        if (result.minutes !== null) {
          scheduledMinutes += Math.max(
            0,
            schedule.standardMinutes - (day.leaveMinutes || 0),
          );
          workOvertimeMinutes += result.overtime;
          attendance += result.attendance;
        }
      }
      values[k] = {
        scheduledMinutes,
        attendance,
        workOvertimeMinutes,
        pending,
        averageMinutes:
          attendance && !pending ? workOvertimeMinutes / attendance : null,
      };
      cursor.setDate(cursor.getDate() + 1);
    }
    return values;
  }
  function pendingWorkdays(state, start, end, asOf, now) {
    if (!validDate(start) || !validDate(end) || !validDate(asOf)) return 0;
    const last = end < asOf ? end : asOf;
    if (start > last) return 0;
    const currentDate = businessDate(now),
      beforeWorkStart =
        asOf === currentDate &&
        businessMinutes(now) <
          timeMin(
            scheduleForDate(state, currentDate).workStart || DEFAULT_START,
          );
    let count = 0;
    const cursor = localDate(start);
    while (dateKey(cursor) <= last) {
      const k = dateKey(cursor),
        day = state.days[k] || {};
      if (
        !(k === asOf && beforeWorkStart) &&
        calendarInfo(k, day).work &&
        (day.leaveMinutes || 0) < scheduleForDate(state, k).standardMinutes &&
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
      const c = calculate(k, day, scheduleForDate(state, k), includeEstimate);
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
        worked =
          complete(record) &&
          duration(record, scheduleForDate(state, date)) > 0;
      if (worked) actualDays++;
      else if (day.plannedOvertime) plannedDays++;
    }
    return { actualDays, plannedDays, totalDays: actualDays + plannedDays };
  }
  function selectOvertimeRequirement(state, start, end) {
    const counts = countRestOvertimeDays(state, start, end),
      tier = Math.min(4, counts.totalDays),
      requirements = state.overtimeRequirements;
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
    const earned = (derivedSummary || summary(state, start, end)).workOvertime;
    const today = state.days[asOf] || {},
      startsTomorrow =
        start <= asOf && asOf <= end && complete(effectiveRecord(today, true));
    let plannedDays = 0,
      remainingDays = 0;
    const cursor = localDate(start);
    while (dateKey(cursor) <= end) {
      const k = dateKey(cursor),
        day = state.days[k] || {};
      if (calendarInfo(k, day).work) {
        const standard = scheduleForDate(state, k).standardMinutes;
        const portion =
          Math.max(
            0,
            standard - Math.min(standard, Math.max(0, day.leaveMinutes || 0)),
          ) / standard;
        plannedDays += portion;
        if (
          (k > asOf || (k === asOf && !startsTomorrow)) &&
          !complete(effectiveRecord(day, true))
        )
          remainingDays += portion;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    const difference = targetMinutes * plannedDays - earned,
      shortfall = Math.max(0, difference),
      rawRequiredPerDay = remainingDays ? difference / remainingDays : null;
    return {
      startsTomorrow,
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
    monthlyAnalysis,
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
