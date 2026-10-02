"use strict";
/** Revision-scoped derived values. The public domain API remains uncached and pure. */
const WorkDerived = (() => {
  function create({ core, getState, getRevision, now = () => new Date() }) {
    let state = null,
      revision = null,
      days = null,
      settings = null,
      months = null;
    const values = new Map(),
      limit = 128;
    function clear() {
      values.clear();
      months = null;
      state = days = settings = revision = null;
    }
    function synchronize() {
      const current = getState(),
        nextRevision = getRevision();
      if (
        current !== state ||
        nextRevision !== revision ||
        current.days !== days ||
        current.settings !== settings
      ) {
        clear();
        state = current;
        revision = nextRevision;
        days = current.days;
        settings = current.settings;
      }
      return current;
    }
    function cached(key, calculate) {
      if (values.has(key)) {
        const value = values.get(key);
        values.delete(key);
        values.set(key, value);
        return value;
      }
      const value = calculate();
      values.set(key, value);
      if (values.size > limit) values.delete(values.keys().next().value);
      return value;
    }
    function rangeState(start, end) {
      if (!core.validDate(start) || !core.validDate(end) || start > end)
        return state;
      if (!months) {
        months = new Map();
        let order = 0;
        for (const [date, day] of Object.entries(days)) {
          const month = date.slice(0, 7);
          if (!months.has(month)) months.set(month, []);
          months.get(month).push([date, day, order++]);
        }
      }
      return cached(JSON.stringify(["range", start, end]), () => {
        const entries = [];
        for (const [month, records] of months) {
          if (month < start.slice(0, 7) || month > end.slice(0, 7)) continue;
          for (const entry of records)
            if (entry[0] >= start && entry[0] <= end) entries.push(entry);
        }
        // Keep the reference iteration order, including floating point attendance sums.
        entries.sort((a, b) => a[2] - b[2]);
        return { ...state, days: Object.fromEntries(entries) };
      });
    }
    function summary(input, start, end, includeEstimate = true) {
      if (input !== synchronize())
        return core.summary(input, start, end, includeEstimate);
      return cached(
        JSON.stringify(["summary", start, end, includeEstimate]),
        () => core.summary(rangeState(start, end), start, end, includeEstimate),
      );
    }
    function rangeValue(name, input, start, end, ...args) {
      if (input !== synchronize())
        return core[name](input, start, end, ...args);
      return cached(JSON.stringify([name, start, end, ...args]), () =>
        core[name](rangeState(start, end), start, end, ...args),
      );
    }
    const api = {
      ...core,
      summary,
      countRestOvertimeDays: (...args) =>
        rangeValue("countRestOvertimeDays", ...args),
      selectOvertimeRequirement: (...args) =>
        rangeValue("selectOvertimeRequirement", ...args),
      targetPace(input, start, end, asOf, targetMinutes) {
        if (input !== synchronize())
          return core.targetPace(input, start, end, asOf, targetMinutes);
        return cached(
          JSON.stringify(["pace", start, end, asOf, targetMinutes]),
          () =>
            core.targetPace(
              rangeState(start, end),
              start,
              end,
              asOf,
              targetMinutes,
              summary(input, start, end),
            ),
        );
      },
      pendingWorkdays(
        input,
        start,
        end,
        asOf = core.businessDate(now()),
        at = now(),
      ) {
        const date = core.businessDate(at),
          beforeStart =
            core.businessMinutes(at) <
            core.timeMin(input.settings.workStart || core.DEFAULT_START);
        if (input !== synchronize())
          return core.pendingWorkdays(input, start, end, asOf, at);
        return cached(
          JSON.stringify(["pending", start, end, asOf, date, beforeStart]),
          () =>
            core.pendingWorkdays(rangeState(start, end), start, end, asOf, at),
        );
      },
      oaStaleness(input, asOf = core.businessDate(now())) {
        if (input !== synchronize()) return core.oaStaleness(input, asOf);
        return cached(JSON.stringify(["stale", asOf]), () =>
          core.oaStaleness(input, asOf),
        );
      },
      attendanceHoursThrough(input, start, end, endDay) {
        if (
          !endDay ||
          input !== synchronize() ||
          !core.validDate(start) ||
          !core.validDate(end) ||
          start > end
        ) {
          if (!endDay)
            return rangeValue("attendanceHoursThrough", input, start, end);
          return core.attendanceHoursThrough(input, start, end, endDay);
        }
        const cursor = core.localDate(end);
        cursor.setDate(cursor.getDate() - 1);
        const previous = core.dateKey(cursor),
          base =
            previous >= start
              ? rangeValue("attendanceHoursThrough", input, start, previous)
              : { expectedMinutes: 0, workedMinutes: 0 },
          last = core.attendanceHoursThrough(input, end, end, endDay);
        return {
          expectedMinutes: base.expectedMinutes + last.expectedMinutes,
          workedMinutes: base.workedMinutes + last.workedMinutes,
        };
      },
      cumulativeAverageOvertime(input, start, end, endDay) {
        if (
          !endDay ||
          input !== synchronize() ||
          !core.validDate(start) ||
          !core.validDate(end) ||
          start > end
        ) {
          if (!endDay)
            return rangeValue("cumulativeAverageOvertime", input, start, end);
          return core.cumulativeAverageOvertime(input, start, end, endDay);
        }
        const cursor = core.localDate(end);
        cursor.setDate(cursor.getDate() - 1);
        const previous = core.dateKey(cursor),
          base =
            previous >= start
              ? rangeValue("cumulativeAverageOvertime", input, start, previous)
              : {},
          prior = base[previous],
          last = core.cumulativeAverageOvertime(input, end, end, endDay)[end],
          scheduledMinutes =
            (prior?.scheduledMinutes || 0) + last.scheduledMinutes,
          workOvertimeMinutes =
            (prior?.workOvertimeMinutes || 0) + last.workOvertimeMinutes;
        return {
          ...base,
          [end]: {
            scheduledMinutes,
            workOvertimeMinutes,
            averageMinutes: scheduledMinutes
              ? (workOvertimeMinutes * input.settings.standardMinutes) /
                scheduledMinutes
              : null,
          },
        };
      },
      calculate(date, day, inputSettings, includeEstimate = true) {
        synchronize();
        if (day !== days[date] || inputSettings !== settings)
          return core.calculate(date, day, inputSettings, includeEstimate);
        return cached(JSON.stringify(["day", date, includeEstimate]), () =>
          core.calculate(date, day, inputSettings, includeEstimate),
        );
      },
    };
    return { core: api, dispose: clear };
  }
  return { create };
})();
