"use strict";

/** Shared date stamp for the calendar and selected-day headers. */
WorkTimeApp.ui.headerDateMarkup = function (date, esc) {
  const divider =
    '<svg class="calendar-date-divider" viewBox="0 0 12 24" aria-hidden="true" focusable="false"><path d="M9 4 3 20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';
  const parts = WorkTimeApp.i18n.date(date).split(/\s*\/\s*/);
  return (
    '<span class="calendar-today-date">' +
    parts
      .map(
        (part) =>
          '<span class="calendar-today-number">' + esc(part) + "</span>",
      )
      .join(divider) +
    '</span><span class="calendar-today-separator" aria-hidden="true"></span><span class="calendar-today-weekday">' +
    esc(WorkTimeApp.i18n.weekday(date)) +
    "</span>"
  );
};

/** Create an isolated presentation view; state/view getters remain live after restore and navigation. */
WorkTimeApp.ui.createDayPresentation = function (options) {
  const { core: C, escape: esc, getState, getView } = options;

  function isFullLeave(day = {}, date = getView().selected) {
    const state = getState();
    return (
      day.leaveMinutes > 0 &&
      day.leaveMinutes >= C.scheduleForDate(state, date).standardMinutes
    );
  }
  function timeAnomaly(day = {}, r = C.effectiveRecord(day, true) || day.oa) {
    if (!r || r.effectiveMinutes != null || r.nextDay) return null;
    const start = C.timeMin(r.start),
      end = C.timeMin(r.end);
    return start !== null && end !== null && end < start
      ? { start: r.start, end: r.end }
      : null;
  }
  function stateLabel(day = {}, r = null, k = null) {
    const state = getState();
    const { today } = getView();
    if (timeAnomaly(day, r || day.oa)) return "anomaly";
    if (r && C.complete(r)) return r.manual ? "manual" : "oa";
    if (r && r.manual && (r.start || r.end)) return "pending";
    if (day.oa) return day.oa.status === "off" ? "absent" : "pending";
    if (
      k &&
      k <= today &&
      C.calendarInfo(k, day).work &&
      (day.leaveMinutes || 0) < C.scheduleForDate(state, k).standardMinutes
    )
      return "pending";
    return "empty";
  }
  function visibleStatus(label, info) {
    const { today, month } = getView();
    if (label === "pending" && month !== today.slice(0, 7)) return "";
    if ((info.holiday || !info.work) && label === "absent") return "";
    return WorkTimeApp.i18n.t(
      {
        anomaly: "copy.5caf279339",
        manual: "copy.85f1f8dfaf",
        oa: "copy.079b8cd375",
        pending: "copy.eb87bec8ca",
        absent: "copy.90e8eea725",
        empty: "copy.287a1d1034",
      }[label],
    );
  }
  function tag(label, cls = "", title = "") {
    return (
      '<span class="pill ' +
      cls +
      '"' +
      (title ? ' title="' + esc(title) + '"' : "") +
      '><span class="pill-text">' +
      esc(label) +
      "</span></span>"
    );
  }
  function statusTag(label, info, cls = "") {
    const text = visibleStatus(label, info);
    if (text && label === "pending" && WorkTimeApp.i18n.language !== "zh-CN")
      return tag(
        WorkTimeApp.i18n.t("status.pending.short"),
        cls + " pending-entry",
        text,
      );
    return text ? tag(text, cls) : "";
  }
  return {
    isFullLeave,
    timeAnomaly,
    stateLabel,
    visibleStatus,
    tag,
    statusTag,
  };
};
