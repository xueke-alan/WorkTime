"use strict";
const WorkUI = {};
/** Create an isolated presentation view; state/view getters remain live after restore and navigation. */
WorkUI.createDayPresentation = function (options) {
  const { core: C, escape: esc, getState, getView } = options;

  function isFullLeave(day = {}) {
    const state = getState();
    return (
      day.leaveMinutes > 0 && day.leaveMinutes >= state.settings.standardMinutes
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
    if (timeAnomaly(day, r || day.oa)) return "异常";
    if (r && C.complete(r)) return r.manual ? "手动填写" : "OA导入";
    if (r && r.manual && (r.start || r.end)) return "待录入";
    if (day.oa) return day.oa.status === "off" ? "无出勤记录" : "待录入";
    if (
      k &&
      k <= today &&
      C.calendarInfo(k, day).work &&
      (day.leaveMinutes || 0) < state.settings.standardMinutes
    )
      return "待录入";
    return "未填写";
  }
  function visibleStatus(label, info) {
    const { today, month } = getView();
    if (label === "待录入" && month !== today.slice(0, 7)) return "";
    return info.holiday && label === "无出勤记录" ? "" : label;
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
    return visibleStatus(label, info) ? tag(label, cls) : "";
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
