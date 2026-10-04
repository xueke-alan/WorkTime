"use strict";
/** records domain. No DOM or storage access. Loaded as an ordered classic script for file://. */
WorkTimeApp.domain.records = (() => {
  const { pad, timeMin } = WorkTimeApp.domain.time;
  const { calendarInfo } = WorkTimeApp.domain.calendar;
  function actualRecord(day = {}) {
    if (day.actual) return { ...day.actual, type: "actual", manual: true };
    if (day.oa && day.oa.status === "complete")
      return { ...day.oa, type: "actual", manual: false };
    return null;
  }
  function effectiveRecord(day = {}, includeEstimate = false) {
    if (day.draft)
      return {
        ...day.draft,
        effectiveMinutes: null,
        type: "actual",
        manual: true,
      };
    const actual = actualRecord(day);
    if (actual && complete(actual)) return actual;
    if (includeEstimate && day.estimate)
      return {
        ...day.estimate,
        start: (day.oa && day.oa.start) || day.estimate.start,
        type: "estimate",
        manual: true,
      };
    return actual;
  }
  function complete(r) {
    if (!r) return false;
    if (r.effectiveMinutes !== null && r.effectiveMinutes !== undefined)
      return Number.isInteger(r.effectiveMinutes) && r.effectiveMinutes >= 0;
    const a = timeMin(r.start),
      b = timeMin(r.end);
    return a !== null && b !== null && b + (r.nextDay ? 1440 : 0) >= a;
  }
  /**
   * Build an editing candidate without mutating the existing day or OA source.
   * @param {WorkDay} old
   * @param {{start:string,end:string,nextDay:boolean,leaveMinutes:number}} input Validated form values; empty clocks are allowed.
   * @returns {WorkDay}
   */
  function editedDay(old, { start, end, nextDay, leaveMinutes }) {
    const day = { ...old, leaveMinutes },
      record = { start, end, nextDay, effectiveMinutes: null },
      oa = old.oa;
    const unchangedOA =
      oa &&
      !old.actual &&
      !old.estimate &&
      start === oa.start &&
      end === oa.end &&
      nextDay === oa.nextDay;
    if (unchangedOA) delete day.draft;
    else if (complete(record)) {
      delete day.draft;
      if (
        (oa && (oa.status === "complete" || start !== oa.start)) ||
        old.actual
      ) {
        day.actual = record;
        delete day.estimate;
      } else day.estimate = record;
    } else if (start || end || nextDay || oa)
      day.draft = { start, end, nextDay };
    else {
      delete day.draft;
      delete day.actual;
      delete day.estimate;
    }
    return day;
  }
  /**
   * @param {WorkManualRecord|WorkOAObservation|null} r
   * @param {{breaks:WorkBreak[]}} settings
   * @returns {number|null} Effective minutes; null means incomplete, not zero.
   */
  function duration(r, settings) {
    if (!complete(r)) return null;
    if (r.effectiveMinutes !== null && r.effectiveMinutes !== undefined)
      return r.effectiveMinutes;
    const start = timeMin(r.start),
      end = timeMin(r.end) + (r.nextDay ? 1440 : 0),
      intervals = [];
    for (let offset = 0; offset <= 1440; offset += 1440)
      for (const rest of settings.breaks) {
        const a = Math.max(start, rest.start + offset),
          b = Math.min(end, rest.end + offset);
        if (b > a) intervals.push([a, b]);
      }
    intervals.sort((a, b) => a[0] - b[0]);
    let deduction = 0,
      left = null,
      right = null;
    for (const [a, b] of intervals) {
      if (left === null) {
        left = a;
        right = b;
      } else if (a <= right) right = Math.max(right, b);
      else {
        deduction += right - left;
        left = a;
        right = b;
      }
    }
    if (left !== null) deduction += right - left;
    return Math.max(0, end - start - deduction);
  }
  /**
   * Earliest end reaching the target, within strictly less than 24 elapsed hours.
   * @param {string} start Valid HH:mm.
   * @param {number} targetMinutes Nonnegative effective minutes.
   * @param {{breaks:WorkBreak[]}} schedule
   * @returns {{end:string,nextDay:boolean}|null} Null means unreachable.
   */
  function endForDuration(start, targetMinutes, schedule) {
    const startMinutes = timeMin(start);
    for (let elapsed = 0; elapsed < 1440; elapsed++) {
      const absolute = startMinutes + elapsed,
        endMinute = absolute % 1440,
        end = pad(Math.floor(endMinute / 60)) + ":" + pad(endMinute % 60),
        nextDay = absolute >= 1440;
      if (
        duration({ start, end, nextDay, effectiveMinutes: null }, schedule) >=
        targetMinutes
      )
        return { end, nextDay };
    }
    return null;
  }
  function inferWorkEnd(start, targetMinutes, breaks) {
    const startMinutes = timeMin(start);
    if (startMinutes === null) return null;
    for (let elapsed = 1; elapsed <= 1440 - startMinutes; elapsed++) {
      const absolute = startMinutes + elapsed,
        end = pad(Math.floor(absolute / 60)) + ":" + pad(absolute % 60);
      if (
        duration(
          { start, end, nextDay: false, effectiveMinutes: null },
          { breaks },
        ) >= targetMinutes
      )
        return end;
    }
    return null;
  }
  /**
   * @param {string} k YYYY-MM-DD
   * @param {WorkDay} day
   * @param {WorkSettings} settings
   * @param {boolean} includeEstimate Include manual filling held as estimate.
   */
  function calculate(k, day, settings, includeEstimate = false) {
    const r = effectiveRecord(day, includeEstimate),
      info = calendarInfo(k, day),
      leave = Math.min(
        settings.standardMinutes,
        Math.max(0, day.leaveMinutes || 0),
      );
    if (!settings.configured || !complete(r))
      return {
        record: r,
        minutes: null,
        overtime: null,
        attendance: 0,
        work: info.work,
      };
    const minutes = duration(r, settings);
    return {
      record: r,
      minutes,
      overtime: info.work
        ? minutes - settings.standardMinutes + leave
        : minutes,
      attendance: info.work
        ? (settings.standardMinutes - leave) / settings.standardMinutes
        : 0,
      work: info.work,
    };
  }
  return {
    actualRecord,
    effectiveRecord,
    complete,
    editedDay,
    duration,
    endForDuration,
    inferWorkEnd,
    calculate,
  };
})();
