"use strict";
/** Pure minute geometry shared by the timetable painter and pointer controller. */
WorkTimeApp.ui.agendaTimelineMath = (() => {
  const minute = (value) =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const clock = (value) =>
    String(Math.floor(value / 60)).padStart(2, "0") +
    ":" +
    String(value % 60).padStart(2, "0");
  const day = (date) => Date.parse(date + "T00:00:00Z") / 86400000;
  const date = (number) =>
    new Date(number * 86400000).toISOString().slice(0, 10);
  function bounds(item) {
    return {
      start: day(item.date) * 1440 + minute(item.start),
      end: item.end
        ? day(item.endDate || item.date) * 1440 + minute(item.end)
        : null,
    };
  }
  function slice(items, dates) {
    return dates.flatMap((date) => {
      const base = day(date) * 1440;
      return items
        .filter((item) => !item.allDay)
        .flatMap((item) => {
          const { start, end } = bounds(item);
          if (
            start >= base + 1440 ||
            (end === null ? start < base : end <= base)
          )
            return [];
          return [
            {
              item,
              date,
              start: Math.max(0, start - base),
              end: end === null ? null : Math.min(1440, end - base),
              continuesBefore: start < base,
              continuesAfter: end !== null && end > base + 1440,
            },
          ];
        });
    });
  }
  function axis(schedules, segments, height) {
    let start = Math.min(...schedules.map((s) => minute(s.workStart)));
    let end = Math.max(...schedules.map((s) => minute(s.workEnd)));
    for (const segment of segments) {
      start = Math.min(start, Math.floor(segment.start / 30) * 30);
      end = Math.max(
        end,
        Math.min(1440, Math.ceil((segment.end ?? segment.start + 1) / 30) * 30),
      );
    }
    const boundaries = [
      ...new Set([
        start,
        end,
        ...schedules.flatMap((s) => [
          minute(s.workStart),
          minute(s.workEnd),
          ...s.breaks.flatMap((b) => [b.start, b.end]),
        ]),
      ]),
    ]
      .filter((m) => m >= start && m <= end)
      .sort((a, b) => a - b);
    const bands = [];
    for (let i = 1; i < boundaries.length; i++) {
      const a = boundaries[i - 1],
        b = boundaries[i];
      const resting =
        a > start &&
        b < end &&
        schedules.every(
          (s) =>
            b <= minute(s.workStart) ||
            a >= minute(s.workEnd) ||
            s.breaks.some((r) => a >= r.start && b <= r.end),
        );
      const occupied = segments.some(
        (s) => s.start < b && (s.end === null ? s.start >= a : s.end > a),
      );
      const compressed = resting && !occupied;
      const previous = bands[bands.length - 1];
      if (previous && previous.compressed === compressed) previous.end = b;
      else bands.push({ start: a, end: b, compressed, top: 0, height: 0 });
    }
    const restCount = bands.filter((b) => b.compressed).length;
    const restHeight = Math.min(22, height / Math.max(1, restCount * 4));
    const minutes = bands
      .filter((b) => !b.compressed)
      .reduce((n, b) => n + b.end - b.start, 0);
    let top = 0;
    for (const band of bands) {
      band.top = top;
      band.height = band.compressed
        ? restHeight
        : ((height - restCount * restHeight) * (band.end - band.start)) /
          minutes;
      top += band.height;
    }
    const y = (m) => {
      const band = bands.find((b) => m <= b.end) || bands[bands.length - 1];
      return (
        band.top + ((m - band.start) / (band.end - band.start)) * band.height
      );
    };
    const at = (pixel) => {
      const p = Math.max(0, Math.min(height, pixel));
      const band =
        bands.find((b) => p <= b.top + b.height) || bands[bands.length - 1];
      return (
        band.start + ((p - band.top) / band.height) * (band.end - band.start)
      );
    };
    return { start, end, bands, height, y, at };
  }
  function columns(segments) {
    const sorted = segments
      .map((s) => ({ ...s, column: 0, columns: 1 }))
      .sort(
        (a, b) =>
          a.start - b.start ||
          (b.end ?? b.start) - (a.end ?? a.start) ||
          a.item.id.localeCompare(b.item.id),
      );
    let group = [],
      groupEnd = -1,
      ends = [];
    const finish = () =>
      group.forEach((s) => {
        s.columns = ends.length;
      });
    for (const segment of sorted) {
      if (segment.start >= groupEnd) {
        finish();
        group = [];
        ends = [];
      }
      let column = ends.findIndex((end) => end <= segment.start);
      if (column < 0) column = ends.length;
      // A point marker occupies its instant, without inventing a stored duration.
      ends[column] = segment.end ?? segment.start + 1;
      groupEnd = group.length ? Math.max(groupEnd, ends[column]) : ends[column];
      segment.column = column;
      group.push(segment);
    }
    finish();
    return sorted;
  }
  function update(item, start, end) {
    const result = {
      ...item,
      date: date(Math.floor(start / 1440)),
      start: clock(start % 1440),
    };
    if (end === null) {
      result.endDate = result.date;
      result.end = "";
    } else {
      result.endDate = date(Math.floor(end / 1440));
      result.end = clock(end % 1440);
    }
    return WorkTimeApp.domain.agenda.validate(result);
  }
  return { minute, clock, day, date, bounds, slice, axis, columns, update };
})();
