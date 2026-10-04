"use strict";
/** Date schedules are pure interval replacements, never layered overrides. */
WorkTimeApp.domain.schedule = (() => {
  const { validDate, localDate, dateKey, timeMin } = WorkTimeApp.domain.time;
  function shiftDate(date, days) {
    const d = localDate(date);
    d.setDate(d.getDate() + days);
    const result = dateKey(d);
    if (!validDate(result)) throw Error("日期超出支持范围。");
    return result;
  }
  function scheduleForDate(state, date) {
    const range = (state.scheduleRanges || []).find(
      (r) => r.start <= date && (!r.end || date <= r.end),
    );
    return range ? { ...state.settings, ...range.schedule } : state.settings;
  }
  function scheduleError(path, message) {
    const error = Error(message + " [" + path + "]");
    error.name = "BackupValidationError";
    error.code = "INVALID_SCHEDULE";
    error.path = path;
    error.userMessage = message;
    throw error;
  }
  function validateSchedule(input, path = "schedule") {
    const fail = (key, message) => scheduleError(path + "." + key, message);
    if (!input || typeof input !== "object" || Array.isArray(input))
      scheduleError(path, "作息格式无效。");
    if (timeMin(input.workStart) === null)
      fail("workStart", "标准上班时间无效。");
    if (
      timeMin(input.workEnd) === null ||
      timeMin(input.workEnd) <= timeMin(input.workStart)
    )
      fail("workEnd", "标准下班时间必须晚于上班时间。");
    if (!Array.isArray(input.breaks)) fail("breaks", "休息时段格式无效。");
    const breaks = Array.from(input.breaks, (rest, i) => {
      if (!rest || typeof rest !== "object" || Array.isArray(rest))
        fail("breaks[" + i + "]", "休息时段格式无效。");
      if (
        !rest ||
        !Number.isInteger(rest.start) ||
        rest.start < 0 ||
        rest.start >= 1440
      )
        fail("breaks[" + i + "].start", "休息开始时间无效。");
      if (
        !Number.isInteger(rest.end) ||
        rest.end <= rest.start ||
        rest.end > 1440
      )
        fail("breaks[" + i + "].end", "休息结束时间无效。");
      return { start: rest.start, end: rest.end };
    });
    const standardMinutes = WorkTimeApp.domain.records.duration(
      {
        start: input.workStart,
        end: input.workEnd,
        nextDay: false,
        effectiveMinutes: null,
      },
      { breaks },
    );
    if (standardMinutes < 1)
      fail("standardMinutes", "扣除休息后标准工时必须大于0。");
    if (
      input.standardMinutes !== undefined &&
      input.standardMinutes !== standardMinutes
    )
      fail("standardMinutes", "标准工时与作息不一致。");
    return {
      workStart: input.workStart,
      workEnd: input.workEnd,
      breaks,
      standardMinutes,
    };
  }
  function scheduleSignature(schedule) {
    const rests = [...schedule.breaks].sort(
      (a, b) => a.start - b.start || a.end - b.end,
    );
    const merged = [];
    for (const rest of rests) {
      const last = merged.at(-1);
      if (last && rest.start <= last.end)
        last.end = Math.max(last.end, rest.end);
      else merged.push({ ...rest });
    }
    return JSON.stringify([
      schedule.workStart,
      schedule.workEnd,
      schedule.standardMinutes,
      merged,
    ]);
  }
  function validateScheduleRanges(ranges) {
    if (!Array.isArray(ranges))
      scheduleError("scheduleRanges", "作息区间格式无效。");
    let previous = null;
    return Array.from(ranges, (r, i) => {
      const path = "scheduleRanges[" + i + "]";
      if (!r || !validDate(r.start))
        scheduleError(path + ".start", "作息开始日期无效。");
      if (r.end !== null && (!validDate(r.end) || r.end < r.start))
        scheduleError(path + ".end", "作息结束日期无效。");
      if (previous && (!previous.end || r.start <= previous.end))
        scheduleError(path + ".start", "作息区间必须有序且不能重叠。");
      const result = {
        start: r.start,
        end: r.end,
        schedule: validateSchedule(r.schedule, path + ".schedule"),
      };
      previous = result;
      return result;
    });
  }
  function applyScheduleRange(state, schedule, start, end) {
    const clean = validateSchedule(schedule);
    if (
      start !== null &&
      (!validDate(start) || (end !== null && (!validDate(end) || end < start)))
    )
      throw Error("请选择有效的起止日期。");
    if (start === null && end !== null)
      throw Error("全部日期不应填写结束日期。");
    const candidate = {
      ...state,
      settings: { ...state.settings, configured: true },
      scheduleRanges: [],
    };
    if (start === null) Object.assign(candidate.settings, clean);
    else {
      for (const r of state.scheduleRanges || []) {
        if ((r.end && r.end < start) || (end && r.start > end))
          candidate.scheduleRanges.push(r);
        else {
          if (r.start < start)
            candidate.scheduleRanges.push({ ...r, end: shiftDate(start, -1) });
          if (end && end !== "9999-12-31" && (!r.end || r.end > end))
            candidate.scheduleRanges.push({ ...r, start: shiftDate(end, 1) });
        }
      }
      candidate.scheduleRanges.push({ start, end, schedule: clean });
      candidate.scheduleRanges.sort((a, b) => a.start.localeCompare(b.start));
      const merged = [];
      for (const r of candidate.scheduleRanges) {
        if (
          scheduleSignature(r.schedule) ===
          scheduleSignature(candidate.settings)
        )
          continue;
        const last = merged.at(-1);
        if (
          last &&
          last.end &&
          last.end !== "9999-12-31" &&
          shiftDate(last.end, 1) === r.start &&
          scheduleSignature(last.schedule) === scheduleSignature(r.schedule)
        )
          last.end = r.end;
        else merged.push({ ...r });
      }
      candidate.scheduleRanges = merged;
    }
    const conflicts = Object.entries(candidate.days)
      .filter(
        ([date, day]) =>
          (day.leaveMinutes || 0) >
          scheduleForDate(candidate, date).standardMinutes,
      )
      .map(([date]) => date)
      .sort();
    if (conflicts.length)
      throw Error(
        "以下日期请假时长超过新标准工时，请先修正：" + conflicts.join("、"),
      );
    return candidate;
  }
  function scheduleRangeForChoice(choice, today, start, end) {
    if (!validDate(today)) throw Error("当前日期无效。");
    if (choice === "all") return { start: null, end: null };
    if (choice === "future") return { start: today, end: null };
    if (choice === "week") return { start: today, end: shiftDate(today, 6) };
    if (choice === "month") {
      const d = localDate(today);
      d.setMonth(d.getMonth() + 1, 0);
      return { start: today, end: dateKey(d) };
    }
    if (
      choice !== "custom" ||
      !validDate(start) ||
      (end !== null && (!validDate(end) || end < start))
    )
      throw Error("请选择有效的起止日期。");
    return { start, end };
  }
  return {
    scheduleForDate,
    validateSchedule,
    validateScheduleRanges,
    scheduleSignature,
    applyScheduleRange,
    scheduleRangeForChoice,
  };
})();
