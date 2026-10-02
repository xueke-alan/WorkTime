"use strict";

/** Create an isolated editor view; state/view getters remain live after restore and navigation. */
WorkUI.createEditor = function (options) {
  const {
    core: C,
    element: $,
    escape: esc,
    getState,
    getView,
    renderTimeTemplates,
    timeAnomaly,
    isFullLeave,
    window,
  } = options;

  let previewMarkup = null;
  function updateText(id, text) {
    const element = $(id);
    if (element.textContent !== text) element.textContent = text;
  }
  function updateResetDayButton(day) {
    const button = $("clearManual");
    button.disabled =
      !day.actual &&
      !day.estimate &&
      !day.draft &&
      !day.note &&
      !day.leaveMinutes &&
      !day.kind &&
      !day.plannedOvertime;
  }
  function updatePlannedOvertime(day, info) {
    $("plannedOvertimeArea").classList.toggle("hidden", info.work);
    $("plannedOvertimeToggle").setAttribute(
      "aria-pressed",
      String(!!day.plannedOvertime),
    );
    $("plannedOvertimeToggle")
      .querySelector("use")
      .setAttribute(
        "href",
        day.plannedOvertime ? "#ui-plan-check" : "#ms-today",
      );
  }
  function renderEditor() {
    const state = getState();
    const { selected } = getView();
    closeLeavePanel();
    const day = state.days[selected] || {},
      r = C.effectiveRecord(day, true) || day.oa || {},
      info = C.calendarInfo(selected, day);
    $("editorDate").textContent =
      selected + " · 周" + "日一二三四五六"[C.localDate(selected).getDay()];
    $("dayStart").placeholder = state.settings.workStart;
    $("dayEnd").placeholder = state.settings.workEnd;
    $("dayStart").value = r.start || "";
    $("dayEnd").value = r.end || "";
    $("dayNext").checked = !!r.nextDay;
    $("dayLeave").value = C.hours(day.leaveMinutes || 0);
    $("dayLeave").max = C.hours(state.settings.standardMinutes);
    updateResetDayButton(day);
    $("sourceOpen").disabled = !day.oa;
    updatePlannedOvertime(day, info);
    renderTimeTemplates();
    $("dayError").textContent = "";
    previewDay();
    window.WorkCountdown?.setState(state);
    window.DateInfoUI?.setDate(selected);
  }
  /** @returns {WorkDay} A candidate day; does not mutate persisted state. */
  function formDay() {
    const state = getState();
    const { selected } = getView();

    const old = state.days[selected] || {},
      day = { ...old },
      start = $("dayStart").value,
      end = $("dayEnd").value,
      nextDay = $("dayNext").checked,
      leaveHours = Number($("dayLeave").value || 0);
    if (
      [start, end].some(
        (time) => time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time),
      )
    )
      throw Error("时间请填写为 HH:MM，例如 08:30。");
    if (
      $("dayLeave").validity.badInput ||
      !Number.isFinite(leaveHours) ||
      leaveHours < 0 ||
      Math.round(leaveHours * 60) > state.settings.standardMinutes
    )
      throw Error("请假时长必须在 0 与每日标准工时之间。");
    const r = { start, end, nextDay, effectiveMinutes: null },
      oa = day.oa;
    day.leaveMinutes = Math.round(leaveHours * 60);
    const unchangedOA =
      oa &&
      !old.actual &&
      !old.estimate &&
      start === oa.start &&
      end === oa.end &&
      nextDay === oa.nextDay;
    if (unchangedOA) {
      delete day.draft;
    } else if (C.complete(r)) {
      delete day.draft;
      if (
        (oa && (oa.status === "complete" || start !== oa.start)) ||
        old.actual
      ) {
        day.actual = r;
        delete day.estimate;
      } else day.estimate = r;
    } else {
      if (start || end || nextDay || oa) day.draft = { start, end, nextDay };
      else {
        delete day.draft;
        delete day.actual;
        delete day.estimate;
      }
    }
    return day;
  }
  function previewDay() {
    const state = getState();
    const { selected } = getView();
    updateLeaveButton();
    $("dayNextToggle").setAttribute(
      "aria-pressed",
      String($("dayNext").checked),
    );
    try {
      const day = formDay(),
        c = C.calculate(selected, day, state.settings, true),
        anomaly = timeAnomaly(day),
        totals = C.attendanceHoursThrough(
          state,
          selected.slice(0, 7) + "-01",
          selected,
          day,
        ),
        average = C.cumulativeAverageOvertime(
          state,
          selected.slice(0, 7) + "-01",
          selected,
          day,
        )[selected].averageMinutes;
      $("dayEnd").setAttribute("aria-invalid", String(!!anomaly));
      const daily = anomaly
        ? "时间异常：下班时间 " +
          esc(anomaly.end) +
          " 早于上班时间 " +
          esc(anomaly.start) +
          "，暂不计入工时。"
        : !c.work && c.minutes === null
          ? "休息日"
          : !state.settings.configured
            ? "请先设置休息时段与标准工时。"
            : c.minutes === null
              ? isFullLeave(day)
                ? "全天请假 <strong>" +
                  C.formatMinutes(day.leaveMinutes) +
                  "</strong><br>折算出勤 <strong>0 d</strong>"
                : "尚未填写完整时间，暂不计入工时。"
              : "有效工时 <strong>" +
                C.formatMinutes(c.minutes) +
                "</strong><br>加班 <strong>" +
                C.formatMinutes(c.overtime) +
                "</strong>　折算出勤 <strong>" +
                Number(c.attendance.toFixed(4)) +
                " 天</strong>";
      let html =
        '<div class="preview-day">' +
        daily +
        '</div><div class="preview-period">本月截至 ' +
        Number(selected.slice(5, 7)) +
        " 月 " +
        Number(selected.slice(8)) +
        ' 日</div><div class="preview-totals"><span>应出勤工时<strong id="expectedHours" data-number-motion>' +
        C.formatMinutes(totals.expectedMinutes) +
        '</strong><small id="expectedDays" data-number-motion>' +
        Number(
          (totals.expectedMinutes / state.settings.standardMinutes).toFixed(2),
        ) +
        'd</small></span><span>已出勤工时<strong id="workedHours" data-number-motion>' +
        C.formatMinutes(totals.workedMinutes) +
        '</strong><small id="workedDays" data-number-motion>' +
        Number(
          (totals.workedMinutes / state.settings.standardMinutes).toFixed(2),
        ) +
        'd</small></span><span>平均加班<strong id="previewAverage" data-number-motion>' +
        (average === null ? "- h" : C.formatMinutes(average)) +
        "</strong></span></div>";
      const employmentDate = state.settings.employmentDate;
      if (employmentDate && C.validDate(employmentDate)) {
        const utcDay = (date) =>
          Date.UTC(
            Number(date.slice(0, 4)),
            Number(date.slice(5, 7)) - 1,
            Number(date.slice(8, 10)),
          );
        const elapsed = Math.floor(
          (utcDay(selected) - utcDay(employmentDate)) / 86400000,
        );
        html +=
          '<div class="preview-employment">' +
          (elapsed >= 0
            ? '入职第 <strong id="employmentDays" data-number-motion>' +
              (elapsed + 1) +
              "</strong> 天"
            : '距离入职还有 <strong id="employmentDays" data-number-motion>' +
              -elapsed +
              "</strong> 天") +
          "</div>";
      }
      if (previewMarkup !== html) {
        $("dayPreview").innerHTML = html;
        previewMarkup = html;
        window.SummaryNumbers?.update($("dayPreview"));
      }
    } catch (e) {
      previewMarkup = null;
      updateText("dayPreview", e.message);
    }
  }
  function closeLeavePanel(focus = false) {
    if (!$("dayLeavePanel").classList.contains("hidden"))
      $("dayLeavePanel").classList.add("hidden");
    $("dayLeaveToggle").setAttribute("aria-expanded", "false");
    if (focus) $("dayLeaveToggle").focus();
  }
  function updateLeaveButton() {
    const state = getState();
    const { selected } = getView();
    const hours = Number($("dayLeave").value || 0),
      hasLeave = Number.isFinite(hours) && hours > 0,
      canLeave = C.calendarInfo(selected, state.days[selected] || {}).work;
    $("dayLeaveArea").classList.toggle("hidden", !canLeave);
    updateText("dayLeaveLabel", hasLeave ? "请假" + hours + "h" : "请假");
    $("dayLeaveToggle").disabled = !canLeave;
    $("dayLeave").disabled = !canLeave;
    $("dayLeaveFull").disabled = !canLeave;
    $("dayLeaveDone").disabled = !canLeave;
    if (!canLeave) closeLeavePanel();
    $("dayLeaveToggle").setAttribute(
      "aria-pressed",
      String(canLeave && hasLeave),
    );
    $("dayLeaveToggle").setAttribute(
      "aria-label",
      canLeave
        ? hasLeave
          ? "请假 " + hours + " 小时，点击修改"
          : "填写请假时长"
        : "休息日无需请假",
    );
    const leaveTip = canLeave
      ? hasLeave
        ? "请假 " + hours + " h · 点击修改"
        : "填写请假时长"
      : "休息日无需请假";
    updateText("dayLeaveTip", leaveTip);
  }
  return {
    updateResetDayButton,
    updatePlannedOvertime,
    renderEditor,
    formDay,
    previewDay,
    closeLeavePanel,
    updateLeaveButton,
  };
};
