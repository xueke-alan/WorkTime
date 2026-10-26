"use strict";
/** Personal agenda rules. Independent of attendance and working schedules. */
WorkTimeApp.domain.agenda = (() => {
  const validTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  /** @param {*} item @returns {WorkAgendaItem} */
  function validate(item) {
    const fail = () => {
      throw Object.assign(Error("Invalid agenda item"), {
        code: "AGENDA_INVALID",
      });
    };
    if (!item || typeof item !== "object" || Array.isArray(item)) fail();
    const status =
      item.status === undefined && typeof item.completed === "boolean"
        ? item.completed
          ? "completed"
          : "pending"
        : item.status;
    if (!["pending", "completed", "in-progress", "cancelled"].includes(status))
      fail();
    const endDate = item.endDate ?? item.date;
    if (
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 128 ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      item.title.length > 120 ||
      !WorkTimeApp.domain.time.validDate(item.date) ||
      !WorkTimeApp.domain.time.validDate(endDate) ||
      endDate < item.date ||
      typeof item.allDay !== "boolean" ||
      typeof item.note !== "string" ||
      item.note.length > 5000 ||
      typeof item.start !== "string" ||
      typeof item.end !== "string" ||
      (item.allDay
        ? item.start !== "" || item.end !== ""
        : !validTime(item.start) ||
          (endDate > item.date && !validTime(item.end)) ||
          (item.end !== "" &&
            (!validTime(item.end) ||
              (endDate === item.date && item.end <= item.start)))) ||
      ![item.createdAt, item.updatedAt].every(
        (v) =>
          typeof v === "string" &&
          /^\d{4}-\d\d-\d\dT/.test(v) &&
          Number.isFinite(Date.parse(v)),
      )
    )
      fail();
    return {
      ...item,
      endDate,
      status,
      completed: status === "completed",
      title: item.title.trim(),
    };
  }
  /** @param {*} items @returns {WorkAgendaItem[]} */
  function validateItems(items) {
    if (items === undefined) return [];
    if (!Array.isArray(items)) throw Error("Invalid agenda collection");
    const seen = new Set();
    return items.map((item) => {
      const clean = validate(item);
      if (seen.has(clean.id)) throw Error("Duplicate agenda identity");
      seen.add(clean.id);
      return clean;
    });
  }
  /** @param {WorkAgendaItem[]} items @param {string} date */
  function forDate(items, date) {
    return items
      .filter((item) => overlaps(item, date, date))
      .sort(compareDayItems);
  }
  function compareDayItems(a, b) {
    return (
      Number(b.allDay) - Number(a.allDay) ||
      a.start.localeCompare(b.start) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
    );
  }
  /** Query only requested dates, without expanding potentially years-long spans.
   * @param {WorkAgendaItem[]} items @param {string[]} dates
   * @returns {Map<string, WorkAgendaItem[]>}
   */
  function forDates(items, dates) {
    const keys = [...new Set(dates)].sort();
    const result = new Map(keys.map((date) => [date, []]));
    if (!keys.length) return result;
    const visible = items
      .filter((item) => overlaps(item, keys[0], keys[keys.length - 1]))
      .sort(compareDayItems);
    for (const item of visible) {
      const end = lastDate(item);
      let left = 0,
        right = keys.length;
      while (left < right) {
        const middle = (left + right) >>> 1;
        if (keys[middle] < item.date) left = middle + 1;
        else right = middle;
      }
      for (let index = left; index < keys.length && keys[index] <= end; index++)
        result.get(keys[index]).push(item);
    }
    return result;
  }
  function lastDate(item) {
    const end = item.endDate ?? item.date;
    if (!item.allDay && end > item.date && item.end === "00:00") {
      const date = WorkTimeApp.domain.time.localDate(end);
      date.setDate(date.getDate() - 1);
      return WorkTimeApp.domain.time.dateKey(date);
    }
    return end;
  }
  function overlaps(item, first, last) {
    return item.date <= last && lastDate(item) >= first;
  }
  function segments(items, dates) {
    const lanes = [];
    return items
      .filter((item) => overlaps(item, dates[0], dates[dates.length - 1]))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          lastDate(b).localeCompare(lastDate(a)) ||
          a.start.localeCompare(b.start) ||
          a.id.localeCompare(b.id),
      )
      .map((item) => {
        const start = Math.max(
          0,
          dates.findIndex((date) => date >= item.date),
        );
        let end = dates.findLastIndex((date) => date <= lastDate(item));
        end = Math.max(start, end);
        let lane = lanes.findIndex((occupied) =>
          occupied.every(([left, right]) => end < left || start > right),
        );
        if (lane < 0) {
          lane = lanes.length;
          lanes.push([]);
        }
        lanes[lane].push([start, end]);
        return {
          item,
          start,
          end,
          lane,
          continuesBefore: item.date < dates[0],
          continuesAfter: lastDate(item) > dates[dates.length - 1],
        };
      });
  }
  function move(item, days) {
    if (!Number.isInteger(days)) throw Error("Invalid calendar-day offset");
    const shift = (value) => {
      const date = WorkTimeApp.domain.time.localDate(value);
      date.setDate(date.getDate() + days);
      return WorkTimeApp.domain.time.dateKey(date);
    };
    return validate({
      ...item,
      date: shift(item.date),
      endDate: shift(item.endDate ?? item.date),
    });
  }
  function resizeEnd(item, visibleEndDate) {
    if (
      !WorkTimeApp.domain.time.validDate(visibleEndDate) ||
      visibleEndDate < item.date ||
      (!item.allDay && !validTime(item.end))
    )
      throw Error("Invalid agenda end date");
    let endDate = visibleEndDate;
    if (!item.allDay && item.end === "00:00") {
      const next = WorkTimeApp.domain.time.localDate(visibleEndDate);
      next.setDate(next.getDate() + 1);
      endDate = WorkTimeApp.domain.time.dateKey(next);
    }
    return validate({ ...item, endDate });
  }
  return {
    validate,
    validateItems,
    forDate,
    forDates,
    lastDate,
    overlaps,
    segments,
    move,
    resizeEnd,
  };
})();
