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

  let previewMarkup = null,
    editorDateMarkup = null;
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
      !day.kind &&
      !day.sourcePriority;
  }
  function updatePlannedOvertime(day, info) {
    const planned = !info.work && !!day.plannedOvertime,
      label = planned
        ? WorkTimeApp.i18n.t("copy.cd4a0376cd")
        : WorkTimeApp.i18n.t("copy.3cf2307526"),
      button = $("plannedOvertimeToggle");
    $("plannedOvertimeArea").classList.toggle("hidden", info.work);
    $("clearManual").classList.toggle("is-planned-reset", planned);
    button.setAttribute("aria-pressed", String(planned));
    button.setAttribute("aria-label", label);
    button.querySelector(".button-label").textContent = label;
    button
      .querySelector("use")
      .setAttribute("href", planned ? "#ms-close" : "#ms-today");
  }
  function renderEditor() {
    const state = getState();
    const { selected } = getView();
    closeLeavePanel();
    const day = state.days[selected] || {},
      r = C.effectiveRecord(day, true) || day.oa || {},
      info = C.calendarInfo(selected, day);
    const editorDate = $("editorDate"),
      dateMarkup = WorkTimeApp.ui.headerDateMarkup(selected, esc);
    // Alignment adds classes/styles to the date spans; compare source markup
    // rather than the decorated DOM so ordinary edits retain their text nodes.
    if (editorDateMarkup !== dateMarkup) {
      editorDate.innerHTML = dateMarkup;
      editorDateMarkup = dateMarkup;
    }
    $("dayStart").placeholder = C.scheduleForDate(state, selected).workStart;
    $("dayEnd").placeholder = C.scheduleForDate(state, selected).workEnd;
    const clock = (minutes) =>
      String(Math.floor(minutes / 60)).padStart(2, "0") +
      ":" +
      String(minutes % 60).padStart(2, "0");
    const breaks = C.scheduleForDate(state, selected).breaks.map(
      (rest) => clock(rest.start) + "–" + clock(rest.end),
    );
    const schedule = esc(
      WorkTimeApp.i18n.t("schedule.description", {
        start: C.scheduleForDate(state, selected).workStart,
        end: C.scheduleForDate(state, selected).workEnd,
        breaks:
          breaks.join(WorkTimeApp.i18n.config.cjk ? "、" : ", ") ||
          WorkTimeApp.i18n.t("copy.1a8b4ad549"),
      }),
    );
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
      throw Error(WorkTimeApp.i18n.t("copy.f311d6abc7"));
    if (
      $("dayLeave").validity.badInput ||
      !Number.isFinite(leaveHours) ||
      leaveHours < 0 ||
      Math.round(leaveHours * 60) >
        C.scheduleForDate(state, selected).standardMinutes
    )
      throw Error(WorkTimeApp.i18n.t("copy.dfb8e4501a"));
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
        ? WorkTimeApp.i18n.t("editor.timeIssue", {
            end: esc(anomaly.end),
            start: esc(anomaly.start),
          }) +
          (c.work && !isFullLeave(day)
            ? WorkTimeApp.i18n.t("copy.bed1305fb6")
            : "")
        : !c.work && c.minutes === null
          ? WorkTimeApp.i18n.t("copy.743a4ad0dd")
          : !state.settings.configured
            ? WorkTimeApp.i18n.t("copy.dd61e8801a")
            : c.minutes === null
              ? isFullLeave(day)
                ? WorkTimeApp.i18n.t("copy.feb728221b") +
                  WorkTimeApp.i18n.duration(day.leaveMinutes) +
                  WorkTimeApp.i18n.t("copy.47fb6325b4")
                : WorkTimeApp.i18n.t("copy.f8d57c4f0d")
              : '<span class="preview-attendance" title="' +
                esc(WorkTimeApp.i18n.t("copy.7a26926ed7")) +
                '">' +
                esc(WorkTimeApp.i18n.t("copy.7a26926ed7")) +
                "<strong>" +
                WorkTimeApp.i18n.number(Number(c.attendance.toFixed(4))) +
                " d</strong></span>";
      let employment = "",
        employmentDays = null;
      const progress = C.employmentDay(state.personal.employmentDate, selected);
      if (progress) {
        employmentDays = progress.days;
        employment =
          '<span class="preview-employment" title="' +
          esc(
            WorkTimeApp.i18n.t(
              progress.started ? "editor.anniversary" : "editor.startsIn",
              { count: WorkTimeApp.i18n.number(employmentDays) },
            ),
          ) +
          '">' +
          WorkTimeApp.i18n.t(
            progress.started
              ? "short.preview.employment"
              : "short.preview.starts",
            {
              count: '<strong id="employmentDays" data-number-motion></strong>',
            },
          ) +
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
        '</div><div class="preview-period"><span title="' +
        esc(
          WorkTimeApp.i18n.t("editor.through", {
            date: WorkTimeApp.i18n.date(selected),
          }),
        ) +
        '">' +
        esc(
          WorkTimeApp.i18n.t("short.preview.through", {
            date: WorkTimeApp.i18n.date(selected, { year: undefined }),
          }),
        ) +
        "</span>" +
        employment +
        WorkTimeApp.i18n.t("copy.6b11e50b8e");
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
      updateText("dayPreview", WorkTimeApp.i18n.message(e.message));
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
      hasLeave
        ? fullDay
          ? WorkTimeApp.i18n.t("copy.8912376175")
          : WorkTimeApp.i18n.t("copy.326f400f75") + hours + "h"
        : WorkTimeApp.i18n.t("copy.7697b2ac1b"),
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
          ? WorkTimeApp.i18n.t("copy.326f400f75") +
            hours +
            WorkTimeApp.i18n.t("copy.8ba84f76ec")
          : WorkTimeApp.i18n.t("copy.c8dda684c7")
        : WorkTimeApp.i18n.t("copy.54d81347ae"),
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
