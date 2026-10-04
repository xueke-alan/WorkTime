"use strict";

/** Create an isolated editor view; state/view getters remain live after restore and navigation. */
WorkTimeApp.ui.createEditor = function (options) {
  const {
    core: C,
    element: $,
    escape: esc,
    getState,
    getView,
    renderTimeTemplates,
    timeAnomaly,
    isFullLeave,
    numbers,
  } = options;

  let previewMarkup = null;
  function updatePreview(html) {
    const next = document.createElement("template");
    next.innerHTML = html;
    const previous = document.createElement("template");
    previous.innerHTML = previewMarkup || "";
    function sync(current, before, after) {
      if (before?.isEqualNode(after)) return;
      if (
        !before ||
        before.nodeType !== after.nodeType ||
        before.nodeName !== after.nodeName
      ) {
        current.replaceWith(after.cloneNode(true));
        return;
      }
      if (after.nodeType === 3) {
        current.nodeValue = after.nodeValue;
        return;
      }
      if (after.hasAttribute?.("data-number-motion")) {
        return;
      }
      if (after.nodeType === Node.ELEMENT_NODE) {
        for (const attribute of before.attributes)
          if (!after.hasAttribute(attribute.name))
            current.removeAttribute(attribute.name);
        for (const attribute of after.attributes)
          if (before.getAttribute(attribute.name) !== attribute.value)
            current.setAttribute(attribute.name, attribute.value);
      }
      const oldChildren = [...before.childNodes],
        newChildren = [...after.childNodes];
      for (let index = 0; index < newChildren.length; index++) {
        if (current.childNodes[index])
          sync(
            current.childNodes[index],
            oldChildren[index],
            newChildren[index],
          );
        else current.append(newChildren[index].cloneNode(true));
      }
      while (current.childNodes.length > newChildren.length)
        current.lastChild.remove();
    }
    sync($("dayPreview"), previous.content, next.content);
  }
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
      .setAttribute("href", day.plannedOvertime ? "#ms-check" : "#ms-today");
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
    $("dayStart").placeholder = C.scheduleForDate(state, selected).workStart;
    $("dayEnd").placeholder = C.scheduleForDate(state, selected).workEnd;
    const clock = (minutes) =>
      String(Math.floor(minutes / 60)).padStart(2, "0") +
      ":" +
      String(minutes % 60).padStart(2, "0");
    const breaks = C.scheduleForDate(state, selected).breaks.map(
      (rest) => clock(rest.start) + "–" + clock(rest.end),
    );
    const schedule =
      '<span class="schedule-work" title="排班时间">' +
      esc(C.scheduleForDate(state, selected).workStart) +
      "–" +
      esc(C.scheduleForDate(state, selected).workEnd) +
      '</span><span class="schedule-break" title="休息时间">' +
      breaks.join("、") +
      "</span>";
    if ($("daySchedule").innerHTML !== schedule)
      $("daySchedule").innerHTML = schedule;
    $("dayStart").value = r.start || "";
    $("dayEnd").value = r.end || "";
    $("dayNext").checked = !!r.nextDay;
    $("dayLeave").value = C.hours(day.leaveMinutes || 0);
    $("dayLeave").max = C.hours(
      C.scheduleForDate(state, selected).standardMinutes,
    );
    updateResetDayButton(day);
    $("sourceOpen").disabled = !day.oa;
    updatePlannedOvertime(day, info);
    renderTimeTemplates();
    WorkTimeApp.ui.fieldErrors.clear($("dayError"));
    previewDay();
    WorkTimeApp.services.countdown.setState(state);
    WorkTimeApp.services.weather?.setCity(state.personal.workCity);
    WorkTimeApp.ui.dateInfo.setDate(selected);
  }
  /** @returns {WorkDay} A candidate day; does not mutate persisted state. */
  function formDay() {
    const state = getState();
    const { selected } = getView();

    const start = $("dayStart").value,
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
      Math.round(leaveHours * 60) >
        C.scheduleForDate(state, selected).standardMinutes
    )
      throw Error("请假时长必须在 0 与每日标准工时之间。");
    return C.editedDay(state.days[selected] || {}, {
      start,
      end,
      nextDay,
      leaveMinutes: Math.round(leaveHours * 60),
    });
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
        c = C.calculate(
          selected,
          day,
          C.scheduleForDate(state, selected),
          true,
        ),
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
      const hasDailyMetrics =
        !anomaly && state.settings.configured && c.minutes !== null;
      const daily = anomaly
        ? "时间异常：下班时间 " +
          esc(anomaly.end) +
          " 早于上班时间 " +
          esc(anomaly.start) +
          "，暂不计入工时。" +
          (c.work && !isFullLeave(day) ? " 打卡未完成，暂不计入平均加班" : "")
        : !c.work && c.minutes === null
          ? "休息日"
          : !state.settings.configured
            ? "请先设置休息时段与标准工时。"
            : c.minutes === null
              ? isFullLeave(day)
                ? "全天请假 <strong>" +
                  C.formatMinutes(day.leaveMinutes) +
                  "</strong> · 出勤 <strong>0 天</strong>"
                : "打卡未完成，暂不计入平均加班"
              : '<span title="有效工时">工时 <strong>' +
                C.formatMinutes(c.minutes) +
                "</strong></span><span>加班 <strong>" +
                C.formatMinutes(c.overtime) +
                '</strong></span><span title="折算出勤">出勤 <strong>' +
                Number(c.attendance.toFixed(4)) +
                " 天</strong></span>";
      let employment = "",
        employmentDays = null;
      const progress = C.employmentDay(state.personal.employmentDate, selected);
      if (progress) {
        employmentDays = progress.days;
        employment =
          '<span class="preview-employment">' +
          (progress.started
            ? '入职第 <strong id="employmentDays" data-number-motion></strong> 天'
            : '距离入职还有 <strong id="employmentDays" data-number-motion></strong> 天') +
          "</span>";
      }
      const html =
        '<div class="preview-day' +
        (hasDailyMetrics
          ? " has-daily-metrics"
          : c.minutes === null
            ? " is-empty"
            : "") +
        '" title="' +
        esc(daily.replace(/<[^>]*>/g, "")) +
        '">' +
        daily +
        '</div><div class="preview-period"><span>本月截至 ' +
        Number(selected.slice(5, 7)) +
        " 月 " +
        Number(selected.slice(8)) +
        " 日</span>" +
        employment +
        '</div><div class="preview-totals"><span>应出勤<span class="preview-values"><strong id="expectedHours" data-number-motion></strong></span></span><span>已出勤<span class="preview-values"><strong id="workedHours" data-number-motion></strong></span></span><span>平均加班<strong id="previewAverage" data-number-motion></strong></span></div>';
      if (previewMarkup !== html) {
        updatePreview(html);
        previewMarkup = html;
      }
      for (const [id, value, format] of [
        [
          "expectedHours",
          totals.expectedMinutes / 60,
          { decimals: 0, suffix: " h" },
        ],
        [
          "workedHours",
          totals.workedMinutes / 60,
          { decimals: 2, suffix: " h" },
        ],
        [
          "previewAverage",
          average === null ? 0 : average / 60,
          { decimals: 2, suffix: " h" },
        ],
      ])
        numbers.set($(id), value, { ...format, key: id });
      if (employment) {
        numbers.set($("employmentDays"), employmentDays, {
          key: "employmentDays",
        });
      }
    } catch (e) {
      previewMarkup = null;
      updateText("dayPreview", e.message);
    }
  }
  function setLeavePanel(open, focus = false) {
    const panel = $("dayLeavePanel"),
      toggle = $("dayLeaveToggle"),
      row = $("dayLeaveArea").closest(".day-action-row");
    panel.classList.toggle("hidden", !open);
    panel.inert = !open;
    row.classList.toggle("is-leave-editing", open);
    row.classList.toggle("is-leave-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.inert = open;
    for (const child of row.children)
      child.inert = open && child !== $("dayLeaveArea");
    if (!open && focus) toggle.focus({ preventScroll: true });
  }
  function openLeavePanel() {
    setLeavePanel(true);
  }
  function closeLeavePanel(focus = false) {
    if ($("dayLeaveToggle").getAttribute("aria-expanded") === "true") {
      setLeavePanel(false, focus);
      const { selected } = getView();
      $("dayLeave").value = C.hours(
        getState().days[selected]?.leaveMinutes || 0,
      );
      WorkTimeApp.ui.fieldErrors.clearRelated(
        $("dayError"),
        $("dayLeaveError"),
      );
      previewDay();
    }
    $("dayLeaveToggle").setAttribute("aria-expanded", "false");
  }
  function updateLeaveButton() {
    const state = getState();
    const { selected } = getView();
    const hours = Number($("dayLeave").value || 0),
      hasLeave = Number.isFinite(hours) && hours > 0,
      canLeave = C.calendarInfo(selected, state.days[selected] || {}).work;
    $("dayLeaveArea").classList.toggle("hidden", !canLeave);
    const fullDay =
      hasLeave &&
      Math.round(hours * 60) ===
        C.scheduleForDate(state, selected).standardMinutes;
    updateText(
      "dayLeaveLabel",
      hasLeave ? (fullDay ? "全天休假" : "请假" + hours + "h") : "计划请假",
    );
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
  }
  return {
    updateResetDayButton,
    updatePlannedOvertime,
    renderEditor,
    formDay,
    previewDay,
    openLeavePanel,
    closeLeavePanel,
    updateLeaveButton,
  };
};
