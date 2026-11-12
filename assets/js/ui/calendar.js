"use strict";

/** Create an isolated calendar view; state/view getters remain live after restore and navigation. */
WorkTimeApp.ui.createCalendar = function (options) {
  const {
    core: C,
    element: $,
    escape: esc,
    getState,
    getOriginalState = getState,
    getView,
    getRange: monthBounds,
    closeLeavePanel,
    renderTimeAnomalyNotice,
    updateNotificationEmptyState,
    stateLabel,
    isFullLeave,
    visibleStatus,
    statusTag,
    tag,
    trendIcon,
    year: WorkYear,
    document,
    numbers,
    weatherLayer,
  } = options;
  let renderedMode = null,
    renderedSelection = null,
    renderedYearMode = null;
  let lunarLoading = null,
    lunarUnavailable = false;

  function updateSidebarYearMonth(yearMode, month) {
    const actions = document.querySelector(".sidebar-actions"),
      label = actions.querySelector(".sidebar-year-month"),
      text = $("sidebarYearMonthText"),
      nextText = month.slice(0, 4) + " / " + month.slice(5),
      changed = text.dataset.month !== month;
    if (changed) {
      text.dataset.month = month;
      text.setAttribute("aria-label", nextText);
      for (const [selector, value] of [
        [".sidebar-year-number", month.slice(0, 4)],
        [".sidebar-month-number", month.slice(5)],
      ])
        numbers.set(text.querySelector(selector), value, {
          animateInitial: false,
          motion: yearMode && renderedYearMode === true,
        });
    }
    actions.classList.toggle("is-year-mode", yearMode);
    label.setAttribute("aria-hidden", String(!yearMode));
    const importButton = $("importOpen"),
      secondaryActions = actions.querySelector(".import-secondary-actions");
    importButton.inert = yearMode;
    const secondaryHidden =
      yearMode ||
      document
        .querySelector(".summary-sidebar")
        .classList.contains("is-oa-open");
    secondaryActions.inert = secondaryHidden;
    importButton.setAttribute("aria-hidden", String(yearMode));
    secondaryActions.setAttribute("aria-hidden", String(secondaryHidden));
  }

  function ensureLunar() {
    if (window.Solar) return true;
    if (lunarUnavailable || lunarLoading) return false;
    const settle = () => {
      lunarLoading = null;
      const view = getView();
      // Populate the shared year cards while the heatmap is still showing, so a
      // later mode switch only animates the already-present text layers.
      if (view.yearMode) renderCalendar();
    };
    lunarLoading = WorkTimeApp.services.dateInfo
      .loadLunar()
      .then(settle, () => {
        lunarUnavailable = true;
        settle();
      });
    return false;
  }
  let noteTicker = null,
    noteTracks = [];
  const noteIndexes = new Map();
  function collectNoteTracks() {
    noteTracks = [...$("calendar").querySelectorAll(".year-day-note-track")]
      .map((track) => {
        const date = track.closest(".year-day")?.dataset.yearDate || "",
          count = track.children.length;
        return count > 1 ? { track, date, count } : null;
      })
      .filter(Boolean);
    for (const item of noteTracks) {
      const index = (noteIndexes.get(item.date) || 0) % item.count;
      item.track.style.setProperty("--year-note-index", String(index));
    }
  }
  function tickNotes() {
    for (const item of noteTracks) {
      const index = ((noteIndexes.get(item.date) || 0) + 1) % item.count;
      noteIndexes.set(item.date, index);
      item.track.style.setProperty("--year-note-index", String(index));
    }
    if (noteIndexes.size > 1000) noteIndexes.clear();
  }
  function syncNoteTicker(active) {
    if (
      active &&
      getView().yearViewMode === "calendar" &&
      !document.hidden &&
      !WorkTimeApp.ui.animationCompat.preference().matches
    ) {
      collectNoteTracks();
      if (!noteTicker) noteTicker = window.setInterval(tickNotes, 2600);
    } else {
      if (noteTicker) window.clearInterval(noteTicker);
      noteTicker = null;
      noteTracks = [];
    }
  }
  function refreshNoteTicker() {
    const view = getView();
    syncNoteTicker(view.yearMode && !view.analysisMode);
  }
  document.addEventListener("visibilitychange", refreshNoteTicker);
  document.addEventListener("worktime:yearviewchange", refreshNoteTicker);
  WorkTimeApp.ui.animationCompat
    .preference()
    .addEventListener("change", refreshNoteTicker);
  window.addEventListener("pagehide", () => syncNoteTicker(false));
  const yearFooter = document.querySelector(".calendar-footer");
  function updateYearFooterShift() {
    if (!yearFooter) return;
    const width = $("yearLegend").getBoundingClientRect().width,
      gap = parseFloat(getComputedStyle(yearFooter).columnGap) || 0;
    yearFooter.style.setProperty(
      "--year-footer-shift",
      width > 0 ? width + gap + "px" : "0px",
    );
  }
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(updateYearFooterShift);
    observer.observe($("yearLegend"));
  }
  function yearLegendParts() {
    const legend = $("yearLegend");
    if (!legend.querySelector(".year-scale > .year-gradient"))
      legend.innerHTML =
        '<span class="year-scale"><span class="year-min"></span><span class="year-gradient" aria-hidden="true"></span><span class="year-max"></span></span>';
    return {
      scale: legend.querySelector(".year-scale"),
      min: legend.querySelector(".year-min"),
      gradient: legend.querySelector(".year-gradient"),
      max: legend.querySelector(".year-max"),
    };
  }
  function setYearLegendLabel(label, text) {
    if (label._clearTimer) {
      window.clearTimeout(label._clearTimer);
      label._clearTimer = null;
    }
    if (text) {
      label.textContent = text;
      label.removeAttribute("aria-hidden");
      const justify = label.style.justifyContent;
      label.style.justifyContent = "flex-start";
      const width = label.scrollWidth;
      label.style.justifyContent = justify;
      label.style.width = width + 1 + "px";
      label.style.opacity = "1";
      return;
    }
    label.setAttribute("aria-hidden", "true");
    label.style.width = "0px";
    label.style.opacity = "0";
    label._clearTimer = window.setTimeout(() => {
      label._clearTimer = null;
      if (label.getAttribute("aria-hidden") === "true") label.textContent = "";
    }, 380);
  }

  const { updateText, updateCalendar } = WorkTimeApp.ui.createCalendarRenderer({
    element: $,
    document,
    weatherLayer,
    numbers,
  });
  const monthSlotWidths = new Map();
  let monthMeasureContext;
  function timePart(value, manual) {
    return (
      '<span class="day-time-value' +
      (manual ? " manual-time" : "") +
      '">' +
      esc(value) +
      "</span>"
    );
  }
  function sourceIndicator(day, record) {
    const manual = WorkTimeApp.domain.records.manualSource(day),
      both = !!(day.oa && manual),
      priority =
        !day.oa || (both && day.sourcePriority === "manual") ? "manual" : "oa";
    if (!both && !record) return "";
    let hint = WorkTimeApp.i18n.t("source." + priority);
    if (record?.filledStart)
      hint += " · " + WorkTimeApp.i18n.t("source.filledStart");
    if (record?.filledEnd)
      hint += " · " + WorkTimeApp.i18n.t("source.filledEnd");
    if (both)
      hint +=
        " · " +
        WorkTimeApp.i18n.t(
          priority === "oa" ? "source.switchManual" : "source.switchOA",
        );
    return both
      ? '<button type="button" class="record-source-pair source-toggle ' +
          priority +
          '" data-source-date="' +
          day.oa.date +
          '" title="' +
          esc(hint) +
          '" aria-label="' +
          esc(hint) +
          '" aria-pressed="' +
          (priority === "manual") +
          '"' +
          (getView().batchMode ? " disabled" : "") +
          '><span class="record-source-dot oa" aria-hidden="true"></span><span class="record-source-dot manual" aria-hidden="true"></span></button>'
      : '<span class="record-source-dot ' +
          priority +
          '" title="' +
          esc(hint) +
          '" aria-label="' +
          esc(hint) +
          '"></span>';
  }
  const dateDivider =
    '<svg class="month-title-divider" viewBox="0 0 12 24" aria-hidden="true" focusable="false"><path d="M9 4 3 20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';

  function dateMarkers(date, payday, paydayHint) {
    const start = getState().personal.employmentDate,
      markers = [];
    const monthDay = start.slice(5),
      anniversary =
        monthDay === "02-29" && !C.validDate(date.slice(0, 4) + "-02-29")
          ? "03-01"
          : monthDay;
    if (C.validDate(start) && date >= start && date.slice(5) === anniversary) {
      const years = Number(date.slice(0, 4)) - Number(start.slice(0, 4)),
        label = years
          ? WorkTimeApp.i18n.t("copy.c4c111ae99") +
            years +
            WorkTimeApp.i18n.t("copy.f863e74bcf")
          : WorkTimeApp.i18n.t("copy.847b185d92");
      markers.push({
        label,
        hint: label + WorkTimeApp.i18n.t("copy.3a2fd0b35a") + start,
        className: " employment-icon",
        icon: '<g transform="translate(11 11) scale(3.25)" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M5 21v-2.5c0-3.6 3.1-6 7-6s7 2.4 7 6V21Z"/></g>',
      });
    }
    if (date === payday.date)
      markers.push({
        label: WorkTimeApp.i18n.t("copy.85b0268523"),
        hint: paydayHint,
        className: "",
        icon: '<use href="#ms-currency-yen" x="11" y="11" width="78" height="78" fill="currentColor"/>',
      });
    return {
      label: markers.map((marker) => " " + marker.label).join(""),
      html: markers.length
        ? '<span class="date-markers" role="img" tabindex="0" aria-label="' +
          esc(markers.map((marker) => marker.label).join("、")) +
          '" data-date-marker-hint="' +
          esc(markers.map((marker) => marker.hint).join("\n")) +
          '">' +
          markers
            .map(
              (marker) =>
                '<svg class="payday-icon' +
                marker.className +
                '" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle cx="50" cy="50" r="50" fill="var(--date-marker-background)"/>' +
                marker.icon +
                "</svg>",
            )
            .join("") +
          "</span>"
        : "",
    };
  }

  function updateMonthTitle(year, month, yearMode) {
    const title = $("monthTitle");
    const wordMonth = !WorkTimeApp.i18n.config.cjk;
    if (!title.querySelector(".month-title-divider")) {
      title.innerHTML =
        '<span id="monthTitleYear" class="month-title-year" data-number-motion></span>' +
        dateDivider +
        '<span id="monthTitleMonth" class="month-title-month" data-number-motion></span>';
    }
    if (wordMonth) {
      const style = getComputedStyle(title.querySelector(".month-title-month"));
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const key = WorkTimeApp.i18n.locale + ":" + font;
      if (!monthSlotWidths.has(key)) {
        monthMeasureContext ||= document
          .createElement("canvas")
          .getContext("2d");
        if (monthMeasureContext) {
          monthMeasureContext.font = font;
          const width = Math.max(
            ...Array.from(
              { length: 12 },
              (_, index) =>
                monthMeasureContext.measureText(
                  WorkTimeApp.i18n.monthName(
                    year + "-" + String(index + 1).padStart(2, "0") + "-01",
                  ),
                ).width,
            ),
          );
          // Keep one stable slot for all months, with only a small ink allowance.
          monthSlotWidths.set(
            key,
            (width / parseFloat(style.fontSize) + 0.1).toFixed(3) + "em",
          );
        }
      }
      title.style.setProperty(
        "--month-label-width",
        monthSlotWidths.get(key) || "2.4em",
      );
    } else title.style.setProperty("--month-label-width", "2ch");
    for (const [selector, value] of [
      [".month-title-year", String(year)],
      [
        ".month-title-month",
        wordMonth
          ? WorkTimeApp.i18n.monthName(
              year + "-" + String(month).padStart(2, "0") + "-01",
            )
          : String(month),
      ],
    ]) {
      const number = title.querySelector(selector);
      numbers.set(number, value, {
        animateInitial: !(wordMonth && selector === ".month-title-month"),
        animateWhole: selector === ".month-title-month",
      });
    }
    title.classList.toggle("is-year-title", yearMode);
    title
      .querySelector(".month-title-month")
      .setAttribute("aria-hidden", String(yearMode));
  }

  function monthWorkdayNumber(k) {
    const state = getState();
    let count = 0;
    for (let day = 1; day <= Number(k.slice(8)); day++) {
      const date = k.slice(0, 7) + "-" + C.pad(day);
      if (C.calendarInfo(date, state.days[date] || {}).work) count++;
    }
    return count;
  }
  function hasScheduleChange(
    state,
    date,
    schedule = C.scheduleForDate(state, date),
  ) {
    const previous = C.localDate(date);
    previous.setDate(previous.getDate() - 1);
    const previousDate = C.dateKey(previous);
    return (
      C.validDate(previousDate) &&
      C.scheduleSignature(schedule) !==
        C.scheduleSignature(C.scheduleForDate(state, previousDate))
    );
  }
  function scheduleChangeTag() {
    return (
      WorkTimeApp.i18n.t("copy.b3d0a0f476") +
      tag(WorkTimeApp.i18n.t("copy.7b74743705"), "blue") +
      "</div>"
    );
  }
  function calendarKind(info) {
    const label = info.label.replace(" · 手动", "");
    const key = {
      工作日: "work",
      休息日: "off",
      调休日: "makeup",
      奋斗日: "extra",
      周末: "off",
    }[label];
    return key
      ? WorkTimeApp.i18n.t("calendar.kind." + key)
      : WorkTimeApp.i18n.message(label);
  }
  function adjacentDayCard(k) {
    const state = getState();
    const view = getView();
    const highlighted =
      view.calendarSelected === undefined
        ? view.selected
        : view.calendarSelected;
    const info = C.calendarInfo(k, state.days[k] || {}),
      date = C.localDate(k),
      scheduleChanged = hasScheduleChange(state, k),
      kind =
        calendarKind(info) + (info.work ? " " + monthWorkdayNumber(k) : "");
    const classes = [
      "day",
      "adjacent",
      !view.batchMode && highlighted === k ? "selected" : "",
      !info.work ? "restday" : "",
      info.weekend ? "weekend" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      '<div class="' +
      classes +
      '" data-preview-date="' +
      k +
      '"' +
      (info.holiday ? ' data-holiday="' + esc(info.holiday) + '"' : "") +
      (info.festival ? ' data-festival="' + esc(info.festival) + '"' : "") +
      ' aria-label="' +
      k +
      " " +
      esc(kind) +
      (scheduleChanged ? WorkTimeApp.i18n.t("copy.591a8a36f9") : "") +
      '"><div class="daytop"><span class="daynum">' +
      date.getDate() +
      "<small>" +
      esc(WorkTimeApp.i18n.monthName(k)) +
      '</small></span><span class="daykind">' +
      esc(kind) +
      "</span></div>" +
      (scheduleChanged
        ? '<div class="day-footer"><div class="daystatus">' +
          scheduleChangeTag() +
          "</div></div>"
        : "") +
      "</div>"
    );
  }
  function renderCalendar(keepLeavePanel = false) {
    const state = getState();
    const {
      today,
      month,
      selected,
      calendarSelected = selected,
      batchMode,
      batchDays,
      batchDraft,
      batchSaving,
      yearMode,
      analysisMode,
    } = getView();
    updateSidebarYearMonth(yearMode, month);
    const yearWatermark = $("yearWatermark");
    if (yearMode) yearWatermark.textContent = String(getView().viewYear);
    else {
      // Leaving the year page belongs to the page transition. Do not leave a
      // separately fading watermark over the destination calendar.
      yearWatermark.classList.remove("is-mode-transition", "is-visible");
    }
    yearWatermark.classList.toggle(
      "is-visible",
      yearMode && !analysisMode && getView().yearViewMode === "calendar",
    );
    for (const id of ["prevMonth", "nextMonth", "todayButton"])
      $(id).disabled = batchMode;
    $("monthTitle").setAttribute("aria-disabled", String(batchMode));
    $("monthTitle").tabIndex = batchMode ? -1 : 0;
    for (const date of batchDays)
      if (
        date.slice(0, 7) !== month ||
        !C.canBatchEditDate(getOriginalState(), date)
      )
        batchDays.delete(date);
    if (!keepLeavePanel) closeLeavePanel();
    const viewChanged =
      renderedYearMode !== null && renderedYearMode !== yearMode;
    renderedYearMode = yearMode;
    $("calendar").classList.toggle("year-calendar", yearMode);
    $("calendar").classList.toggle(
      "year-calendar-detail",
      yearMode && getView().yearViewMode === "calendar",
    );
    $("calendar").classList.toggle("is-batch-editing", batchMode && !yearMode);
    document
      .querySelector("#panelContent>.weekdays")
      .classList.toggle("hidden", yearMode);
    $("yearLegend").classList.toggle("hidden", !yearMode);
    if (!yearMode) {
      $("yearLegend").classList.remove("is-inactive");
      $("yearLegend").removeAttribute("aria-hidden");
    }
    if (!yearMode || analysisMode) syncNoteTicker(false);
    $("batchToggle").disabled = analysisMode;
    $("analysisToggle").disabled = batchMode;
    const agendaMode = $("agendaMode");
    if (agendaMode) agendaMode.disabled = batchMode;
    $("analysisToggle").setAttribute("aria-pressed", String(!!analysisMode));
    $("analysisToggle").classList.toggle("is-active", !!analysisMode);
    const analysisLabel = analysisMode
      ? "analysis.calendar"
      : "analysis.toggle";
    for (const attribute of ["title", "aria-label"])
      $("analysisToggle").setAttribute(
        attribute,
        WorkTimeApp.i18n.t(analysisLabel),
      );
    $("analysisToggle").setAttribute("data-i18n-title", analysisLabel);
    $("analysisToggle").setAttribute("data-i18n-aria-label", analysisLabel);
    $("analysisToggle").dataset.actionHint = analysisMode
      ? "agenda.monthView"
      : "";
    $("calendar").classList.toggle("hidden", !!analysisMode);
    $("analysisPage").hidden = !analysisMode;
    $("analysisSidebar").hidden = !analysisMode;
    $("yearAnalysisSidebar").hidden = !yearMode || !!analysisMode;
    document
      .querySelector(".workspace > .editor")
      .classList.toggle("is-analysis-mode", !!analysisMode);
    document
      .querySelector(".workspace > .editor")
      .classList.toggle("is-year-view", !!yearMode && !analysisMode);
    if (analysisMode) {
      document.querySelector("#panelContent>.weekdays").classList.add("hidden");
      $("yearLegend").classList.add("hidden");
      $("monthTitle").setAttribute("aria-disabled", "true");
      $("monthTitle").setAttribute("aria-pressed", "false");
      $("monthTitle").tabIndex = -1;
      updateMonthTitle(
        Number(month.slice(0, 4)),
        Number(month.slice(5)),
        false,
      );
      $("monthTitle").setAttribute(
        "aria-label",
        WorkTimeApp.i18n.t("analysis.title"),
      );
      for (const [id, key] of [
        ["prevMonth", "copy.69bb1687b5"],
        ["nextMonth", "copy.8c9b38e26d"],
      ])
        $(id).setAttribute("aria-label", WorkTimeApp.i18n.t(key));
      updateText($("calendarFoot"), WorkTimeApp.i18n.t("analysis.footer"));
      options.renderAnalysis();
      return;
    }
    $("monthTitle").setAttribute("aria-pressed", String(yearMode));
    $("monthTitle").dataset.actionHint = yearMode
      ? "agenda.monthView"
      : "calendarHint.yearView";
    $("monthTitle").setAttribute(
      "aria-label",
      yearMode
        ? WorkTimeApp.i18n.t("copy.ae8e82c4fe")
        : WorkTimeApp.i18n.t("copy.d298e51191"),
    );
    $("prevMonth").setAttribute(
      "aria-label",
      yearMode
        ? WorkTimeApp.i18n.t("copy.cbd823c1d8")
        : WorkTimeApp.i18n.t("copy.69bb1687b5"),
    );
    $("nextMonth").setAttribute(
      "aria-label",
      yearMode
        ? WorkTimeApp.i18n.t("copy.743fc07e03")
        : WorkTimeApp.i18n.t("copy.8c9b38e26d"),
    );
    if (yearMode) {
      renderYear();
      syncNoteTicker(true);
      if (viewChanged)
        WorkTimeApp.ui.motion?.play($("calendar"), "motion-calendar-view");
      return;
    }
    const modeChanged = renderedMode !== null && renderedMode !== batchMode,
      selectionChanged =
        renderedSelection !== null && renderedSelection !== calendarSelected;
    const monthViewYear = month.slice(0, 4),
      yearNotice = $("yearNotice");
    updateMonthTitle(Number(monthViewYear), Number(month.slice(5)), false);
    updateText(
      yearNotice.querySelector(".notification-body"),
      monthViewYear + WorkTimeApp.i18n.t("copy.29c9747e36"),
    );
    yearNotice.classList.toggle("hidden", C.calendarKnown(month + "-01"));
    const [first, last] = monthBounds(),
      d = C.localDate(first),
      offset = (d.getDay() + 6) % 7,
      total = Number(last.slice(8)),
      weeks = Math.ceil((offset + total) / 7),
      targetMinutes = C.selectOvertimeRequirement(
        state,
        first,
        last,
      ).targetMinutes;
    let html = "",
      workdayNumber = 0,
      counts = { actual: 0, estimate: 0, pending: 0 },
      dailyAverages = C.cumulativeAverageOvertime(state, first, last);
    const originalAverages = batchMode
      ? C.cumulativeAverageOvertime(getOriginalState(), first, last)
      : dailyAverages;
    const payday = C.payday(first),
      paydayHint =
        WorkTimeApp.i18n.t("copy.15c1a8dfb5") +
        payday.date +
        (payday.shiftedDays
          ? WorkTimeApp.i18n.t("copy.b1480c35fe") +
            payday.scheduled +
            WorkTimeApp.i18n.t("copy.842a40aa88") +
            payday.shiftedDays +
            WorkTimeApp.i18n.t("copy.f8bb0516cc")
          : WorkTimeApp.i18n.t("copy.f0fe1c4624")) +
        (!payday.calendarKnown ? WorkTimeApp.i18n.t("copy.2c2643b936") : "");
    for (let i = offset; i > 0; i--) {
      const preview = C.localDate(first);
      preview.setDate(preview.getDate() - i);
      html += adjacentDayCard(C.dateKey(preview));
    }
    for (let i = 1; i <= total; i++) {
      const k = month + "-" + C.pad(i),
        day = state.days[k] || {},
        batchEligible = C.canBatchEditDate(getOriginalState(), k),
        info = C.calendarInfo(k, day),
        r = C.effectiveRecord(day, true),
        schedule = C.scheduleForDate(state, k),
        scheduleChanged = hasScheduleChange(state, k, schedule),
        calc = C.calculate(k, day, schedule, true),
        restOvertime = !info.work && calc.minutes > 0,
        label = stateLabel(day, r, k),
        markers = dateMarkers(k, payday, paydayHint),
        kindLabel =
          calendarKind(info) + (info.work ? " " + ++workdayNumber : "");
      if (r && C.complete(r)) {
        counts[r.type === "estimate" ? "estimate" : "actual"]++;
      } else if (day.oa && day.oa.status === "pending") counts.pending++;
      const classes = [
        "day",
        batchMode && batchEligible ? "batch-eligible" : "",
        !info.work ? "restday" : "",
        info.weekend ? "weekend" : "",
        restOvertime || (!info.work && day.plannedOvertime)
          ? "rest-overtime"
          : "",
        !info.work && day.plannedOvertime && !restOvertime
          ? "planned-overtime-day"
          : "",
        isFullLeave(day, k)
          ? "full-leave"
          : day.leaveMinutes
            ? "partial-leave"
            : "",
        calendarSelected === k && !batchMode ? "selected" : "",
        batchDays.has(k) && batchMode ? "batchselected" : "",
        k === today ? "today" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const average = dailyAverages[k]?.averageMinutes,
        showAverage =
          calc.minutes !== null &&
          info.work &&
          (k <= today || (r && r.manual && C.complete(r))),
        averageAffected =
          batchMode && average !== originalAverages[k]?.averageMinutes,
        averageText = !showAverage
          ? ""
          : average === null
            ? "—"
            : WorkTimeApp.i18n.duration(average);
      const previous = C.localDate(k);
      previous.setDate(previous.getDate() - 1);
      const previousAverage =
        C.dateKey(previous) >= first
          ? dailyAverages[C.dateKey(previous)]?.averageMinutes
          : null;
      const trend =
          !averageText || average === null
            ? ""
            : previousAverage === null
              ? "flat"
              : Number((average / 60).toFixed(2)) >
                  Number((previousAverage / 60).toFixed(2))
                ? "up"
                : Number((average / 60).toFixed(2)) <
                    Number((previousAverage / 60).toFixed(2))
                  ? "down"
                  : "flat",
        trendLabel =
          trend === "up"
            ? WorkTimeApp.i18n.t("copy.d37c9f22e9")
            : trend === "down"
              ? WorkTimeApp.i18n.t("copy.7723588f37")
              : trend === "flat"
                ? previousAverage === null
                  ? WorkTimeApp.i18n.t("copy.c12b114307")
                  : WorkTimeApp.i18n.t("copy.c00f2c4258")
                : "";
      const time =
          r && C.complete(r)
            ? timePart(
                r.start || WorkTimeApp.i18n.t("copy.e7909cfbfe"),
                r.filledStart,
              ) +
              (r.end
                ? " – " + timePart(r.end + (r.nextDay ? "⁺¹" : ""), r.filledEnd)
                : "")
            : r
              ? timePart(
                  r.start || WorkTimeApp.i18n.t("copy.7c8d65e331"),
                  r.filledStart,
                ) +
                " – " +
                timePart(
                  r.end || WorkTimeApp.i18n.t("copy.7c8d65e331"),
                  r.filledEnd,
                )
              : "",
        sourceDot = sourceIndicator(day, r);
      html +=
        '<div class="' +
        classes +
        '" data-date="' +
        k +
        '"' +
        (batchMode && !batchEligible ? ' aria-disabled="true"' : "") +
        (info.holiday ? ' data-holiday="' + esc(info.holiday) + '"' : "") +
        (info.festival ? ' data-festival="' + esc(info.festival) + '"' : "") +
        ' aria-pressed="' +
        (batchMode ? batchDays.has(k) : calendarSelected === k) +
        '" aria-label="' +
        k +
        " " +
        esc(kindLabel) +
        " " +
        visibleStatus(label, info) +
        (scheduleChanged ? WorkTimeApp.i18n.t("copy.591a8a36f9") : "") +
        (calc.minutes !== null
          ? info.work
            ? WorkTimeApp.i18n.t("copy.5322471ae6") +
              WorkTimeApp.i18n.duration(calc.overtime)
            : WorkTimeApp.i18n.t("copy.6d645904e4") +
              WorkTimeApp.i18n.duration(calc.minutes)
          : "") +
        (averageText
          ? WorkTimeApp.i18n.t("copy.dc516fa88c") +
            averageText +
            (trendLabel ? "，" + trendLabel : "")
          : "") +
        (isFullLeave(day, k)
          ? WorkTimeApp.i18n.t("copy.732f79dc36")
          : day.leaveMinutes
            ? WorkTimeApp.i18n.t("copy.1ee7ecb783") +
              C.hours(day.leaveMinutes) +
              "h"
            : "") +
        markers.label +
        '"><div class="daytop"><span class="day-date"><span class="daynum"><span class="daynum-text">' +
        i +
        "</span></span>" +
        markers.html +
        '</span><span class="daykind">' +
        esc(kindLabel) +
        '</span></div><div class="daytime">' +
        time +
        sourceDot +
        '</div><div class="dayhours">' +
        (calc.minutes !== null
          ? '<span class="day-total-hours">' +
            WorkTimeApp.i18n.duration(calc.minutes) +
            "</span>" +
            (info.work
              ? '<span class="day-overtime' +
                (calc.overtime < 0 ? " negative" : "") +
                WorkTimeApp.i18n.t("copy.886690f618") +
                WorkTimeApp.i18n.duration(calc.overtime) +
                "</span>"
              : "")
          : "") +
        '</div><div class="day-footer"><div class="day-average' +
        (averageAffected && averageText ? " batch-average-affected" : "") +
        '" title="' +
        esc(
          WorkTimeApp.i18n.t("copy.1e6a453ebc") +
            (dailyAverages[k].pending
              ? WorkTimeApp.i18n.t("copy.809f2ba84f")
              : "") +
            (trendLabel ? "；" + trendLabel : ""),
        ) +
        '">' +
        (averageText
          ? '<span class="day-average-value' +
            (average !== null &&
            Number.isFinite(targetMinutes) &&
            average < targetMinutes
              ? " below-target"
              : "") +
            '">' +
            averageText +
            "</span>" +
            (trend ? trendIcon(trend) : "")
          : "") +
        '</div><div class="daystatus">' +
        (["empty", "manual", "oa"].includes(label)
          ? ""
          : statusTag(
              label,
              info,
              label === "anomaly"
                ? "red"
                : label === "pending"
                  ? "amber"
                  : r && r.manual
                    ? "blue"
                    : label === "absent"
                      ? ""
                      : "green",
            )) +
        (restOvertime
          ? "<div>" +
            tag(WorkTimeApp.i18n.t("short.preview.ot"), "green overtime") +
            "</div>"
          : !info.work && day.plannedOvertime
            ? "<div>" +
              tag(WorkTimeApp.i18n.t("copy.3cf2307526"), "overtime-plan") +
              "</div>"
            : "") +
        (scheduleChanged ? scheduleChangeTag() : "") +
        (day.leaveMinutes
          ? isFullLeave(day, k)
            ? "<div>" +
              tag(WorkTimeApp.i18n.t("copy.0c09c38655"), "leave") +
              "</div>"
            : "<div>" +
              tag(
                WorkTimeApp.i18n.t("copy.326f400f75") +
                  C.hours(day.leaveMinutes) +
                  "h",
                "leave",
              ) +
              "</div>"
          : "") +
        "</div></div></div>";
    }
    for (let i = 1; i <= weeks * 7 - offset - total; i++) {
      const preview = C.localDate(last);
      preview.setDate(preview.getDate() + i);
      html += adjacentDayCard(C.dateKey(preview));
    }
    // Multiweek views may extend beyond the month's final calendar row.
    // Generate those dates with the same adjacent-day component and keyed renderer.
    if (getView().agendaViewWeeks > 1) {
      const end = C.localDate(getView().agendaViewAnchor || selected);
      end.setDate(
        end.getDate() -
          ((end.getDay() + 6) % 7) +
          getView().agendaViewWeeks * 7 -
          1,
      );
      const next = C.localDate(last);
      next.setDate(next.getDate() + weeks * 7 - offset - total + 1);
      while (next <= end) {
        html += adjacentDayCard(C.dateKey(next));
        next.setDate(next.getDate() + 1);
      }
    }
    $("calendar").dataset.weeks = weeks;
    // Batch mode only changes controls and selection, not attendance content.
    updateCalendar(html, { animateContent: !modeChanged });
    updateText(
      $("calendarFoot"),
      WorkTimeApp.i18n.t("copy.222e6cef7c") +
        (counts.actual + counts.estimate) +
        WorkTimeApp.i18n.t("copy.8d46bff7bf") +
        C.pendingWorkdays(state, first, last, today) +
        WorkTimeApp.i18n.t("copy.85bd9f454a"),
    );
    renderTimeAnomalyNotice();
    const batchBar = $("batchBar");
    if (batchMode === batchBar.classList.contains("hidden")) {
      const toolbar = batchBar.querySelector(".batch-toolbar");
      const parent = batchBar.parentElement;
      parent.querySelector(".batch-toolbar-outgoing")?.remove();
      if (!batchMode && !WorkTimeApp.ui.animationCompat.preference().matches) {
        const { left, top, width, height } = toolbar.getBoundingClientRect();
        if (width && height) {
          const outgoing = toolbar.cloneNode(true);
          outgoing.classList.add("batch-toolbar-outgoing");
          outgoing.inert = true;
          outgoing.setAttribute("aria-hidden", "true");
          for (const child of outgoing.querySelectorAll("[id]"))
            child.removeAttribute("id");
          Object.assign(outgoing.style, {
            left: left + "px",
            top: top + "px",
            width: width + "px",
            height: height + "px",
          });
          outgoing.style.setProperty(
            "--row-spacing",
            getComputedStyle(toolbar).columnGap,
          );
          parent.append(outgoing);
          WorkTimeApp.ui.animationCompat
            .animate(
              outgoing,
              [
                { opacity: Number(getComputedStyle(toolbar).opacity) },
                { opacity: 0 },
              ],
              { duration: 160, easing: "ease-out", fill: "forwards" },
            )
            .finished.then(
              () => outgoing.remove(),
              () => outgoing.remove(),
            );
        }
      }
      batchBar.classList.toggle("hidden", !batchMode);
    }
    $("dayEditor").classList.toggle("hidden", batchMode);
    $("batchToggle").setAttribute("aria-pressed", String(batchMode));
    $("batchToggle").title = batchMode
      ? WorkTimeApp.i18n.t("copy.03b15bbfb8")
      : WorkTimeApp.i18n.t("copy.3f712eac83");
    $("batchToggle")
      .querySelector("use")
      .setAttribute("href", batchMode ? "#ms-close" : "#ms-stacks");
    $("batchToggle").setAttribute(
      "aria-label",
      batchMode
        ? WorkTimeApp.i18n.t("copy.03b15bbfb8")
        : WorkTimeApp.i18n.t("copy.3f712eac83"),
    );
    $("batchSave").disabled = !batchDraft?.canConfirm || !!batchSaving;
    $("batchCancel").disabled = $("batchToggle").disabled = !!batchSaving;
    $("batchAutoSelect").disabled = !!batchSaving;
    $("batchReset").disabled = !!batchSaving || !batchDays.size;
    $("batchClearSelection").disabled = !!batchSaving || !batchDays.size;
    updateText(
      $("batchSelectionCount"),
      WorkTimeApp.i18n.t("batch.selected", { count: batchDays.size }),
    );
    updateText(
      $("batchSave").querySelector(".button-label"),
      WorkTimeApp.i18n.t("batch.saveShort"),
    );
    $("batchToggle").classList.toggle("primary", batchMode);
    $("cards").classList.toggle("is-batch-preview", batchMode);
    // Dragging owns the visual feedback. Saving a move or resize is not a day click.
    if (
      selectionChanged &&
      !batchMode &&
      !document.body.classList.contains("agenda-is-dragging")
    )
      WorkTimeApp.ui.motion?.play(
        $("calendar").querySelector(".selected"),
        "motion-selection",
      );
    if (viewChanged)
      WorkTimeApp.ui.motion?.play($("calendar"), "motion-calendar-view");
    renderedMode = batchMode;
    renderedSelection = calendarSelected;
  }
  function renderYear() {
    const state = getState();
    const { today, month, selected, viewYear, yearViewMode } = getView();
    const detail = yearViewMode === "calendar";
    $("yearWatermark").textContent = String(viewYear);
    $("yearWatermark").classList.toggle("is-visible", detail);
    // Both display modes share one card structure. Lunar data is prepared while
    // the year view is open so switching modes only changes presentation.
    if (viewYear >= 1900 && viewYear <= 2100) ensureLunar();

    updateMonthTitle(viewYear, Number(getView().month.slice(5)), true);
    const notice = $("yearNotice");
    updateText(
      notice.querySelector(".notification-body"),
      viewYear + WorkTimeApp.i18n.t("copy.29c9747e36"),
    );
    notice.classList.toggle("hidden", C.calendarKnown(viewYear + "-01-01"));
    const lunarFor =
      window.Solar && viewYear >= 1900 && viewYear <= 2100
        ? (date) => WorkTimeApp.services.dateInfo.lunar(date)
        : null;
    const months = WorkYear.calendarMonths(state, viewYear, today, lunarFor);
    renderYearAnalysis(viewYear, months);
    $("calendar").removeAttribute("data-weeks");
    $("calendar").classList.toggle("year-calendar-detail", detail);
    $("yearLegend").classList.toggle("hidden", false);
    $("yearLegend").classList.toggle("is-inactive", detail);
    $("yearLegend").setAttribute("aria-hidden", String(detail));
    const statsMarkup = WorkTimeApp.i18n
      .t("copy.2b3cbb76bd")
      .replace(/^<\/span>/, "");
    const chineseMonths =
      "一月 二月 三月 四月 五月 六月 七月 八月 九月 十月 十一月 十二月".split(
        " ",
      );
    const isChinese = WorkTimeApp.i18n.language.startsWith("zh-");
    const heading = (m) => {
      const monthKey = viewYear + "-" + C.pad(m.month),
        active = monthKey === month;
      const label = isChinese
        ? chineseMonths[m.month - 1]
        : WorkTimeApp.i18n.monthName(monthKey + "-01");
      return (
        '<h3><button class="year-month-switch" type="button" data-year-month-switch="' +
        monthKey +
        '" aria-pressed="' +
        active +
        '"><span class="year-month-number">' +
        esc(label) +
        "</span></button>" +
        statsMarkup +
        WorkTimeApp.i18n.number(
          (m.summary.workOvertime + m.summary.restOvertime) / 60,
          { useGrouping: false, maximumFractionDigits: 2 },
        ) +
        WorkTimeApp.i18n.t("copy.42b92eadd3") +
        (m.summary.average === null
          ? "—"
          : WorkTimeApp.i18n.number(m.summary.average / 60, {
              useGrouping: false,
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })) +
        "h/d</span></span></h3>"
      );
    };
    const yearDay = (d) => {
      const badge = d.badge
          ? '<span class="year-day-badge is-' +
            d.badge +
            '" aria-hidden="true">' +
            esc(
              WorkTimeApp.i18n.t(
                d.badge === "rest"
                  ? "yearView.restBadge"
                  : "yearView.workBadge",
              ),
            ) +
            "</span>"
          : "",
        notes = [d.lunar, ...d.festivals].filter(Boolean),
        classes = [
          "year-day",
          d.today ? "is-today" : "",
          d.holiday ? "is-holiday" : "",
          d.makeup ? "is-makeup" : "",
          d.weekend ? "is-weekend" : "",
        ]
          .filter(Boolean)
          .join(" ");
      return (
        '<button type="button" class="' +
        classes +
        '" data-year-date="' +
        d.date +
        '" style="--year-heat-bg:' +
        d.color.background +
        ";--year-heat-text:" +
        d.color.text +
        '" aria-label="' +
        esc(d.description) +
        '"' +
        (d.today ? ' aria-current="date"' : "") +
        ">" +
        badge +
        '<span class="year-day-number"><span>' +
        d.number +
        '</span></span><span class="year-day-note" aria-hidden="true"><span class="year-day-note-track">' +
        notes.map((note) => "<span>" + esc(note) + "</span>").join("") +
        "</span></span></button>"
      );
    };
    updateCalendar(
      months
        .map(
          (m) =>
            '<section class="year-month" data-year-month="' +
            viewYear +
            "-" +
            C.pad(m.month) +
            '" aria-label="' +
            WorkTimeApp.i18n.month(
              viewYear + "-" + String(m.month).padStart(2, "0"),
            ) +
            '">' +
            heading(m) +
            '<div class="year-days">' +
            '<span aria-hidden="true"></span>'.repeat(m.offset) +
            m.days.map(yearDay).join("") +
            "</div></section>",
        )
        .join(""),
    );
    updateText(
      $("calendarFoot"),
      viewYear +
        WorkTimeApp.i18n.t("copy.6d332ee4da") +
        months.reduce(
          (sum, m) => sum + m.days.filter((d) => d.complete).length,
          0,
        ) +
        WorkTimeApp.i18n.t("copy.06ce537cae"),
    );
    const maximum = WorkYear.scaleMaximum(months),
      minimum = WorkYear.scaleMinimum(months);
    const zeroPosition =
      maximum > minimum ? (-minimum / (maximum - minimum)) * 100 : 0;
    const minColor = WorkYear.heatColor(minimum, maximum, minimum).background,
      zeroColor = WorkYear.heatColor(0, maximum, minimum).background,
      maxColor = WorkYear.heatColor(maximum, maximum, minimum).background;
    const legend = yearLegendParts(),
      minText = minimum < 0 ? C.hours(minimum) + " h" : "",
      maxText = maximum > 0 ? C.hours(maximum) + " h" : "";
    setYearLegendLabel(legend.min, minText);
    setYearLegendLabel(legend.max, maxText);
    legend.scale.classList.toggle("is-empty", !minText && !maxText);
    legend.gradient.style.removeProperty("background");
    legend.gradient.style.setProperty("--year-legend-min", minColor);
    legend.gradient.style.setProperty("--year-legend-zero", zeroColor);
    legend.gradient.style.setProperty("--year-legend-max", maxColor);
    legend.gradient.style.setProperty(
      "--year-legend-zero-position",
      zeroPosition + "%",
    );
    updateYearFooterShift();
    $("batchBar").classList.add("hidden");
    $("dayEditor").classList.remove("hidden");
    $("batchToggle").setAttribute("aria-pressed", "false");
    $("batchToggle").classList.remove("primary");
    $("batchToggle").title = WorkTimeApp.i18n.t("copy.3f712eac83");
    $("batchToggle").setAttribute(
      "aria-label",
      WorkTimeApp.i18n.t("copy.3f712eac83"),
    );
    $("batchToggle").querySelector("use").setAttribute("href", "#ms-stacks");
    renderedMode = false;
    renderedSelection = selected;
    updateNotificationEmptyState();
  }
  function renderYearAnalysis(viewYear, months) {
    const totals = months.reduce(
      (sum, month) => {
        for (const key of [
          "total",
          "workOvertime",
          "restOvertime",
          "attendance",
          "completeDays",
        ])
          sum[key] += month.summary[key] || 0;
        return sum;
      },
      {
        total: 0,
        workOvertime: 0,
        restOvertime: 0,
        attendance: 0,
        completeDays: 0,
      },
    );
    const average = totals.attendance
      ? totals.workOvertime / totals.attendance
      : null;
    const data = [
      [
        WorkTimeApp.i18n.t("copy.cc954e610b"),
        average === null ? null : average / 60,
        { decimals: 2, unit: " h" },
        true,
      ],
      [
        WorkTimeApp.i18n.t("yearView.totalOvertime"),
        (totals.workOvertime + totals.restOvertime) / 60,
        { decimals: 2, unit: " h" },
      ],
      [
        WorkTimeApp.i18n.t("copy.7a26926ed7"),
        totals.attendance,
        { decimals: 2, unit: " d" },
      ],
      [
        WorkTimeApp.i18n.t("short.workOT"),
        totals.workOvertime / 60,
        { decimals: 2, unit: " h" },
      ],
      [
        WorkTimeApp.i18n.t("short.restOT"),
        totals.restOvertime / 60,
        { decimals: 2, unit: " h" },
      ],
      [
        WorkTimeApp.i18n.t("copy.016315b388"),
        totals.total / 60,
        { decimals: 2, unit: " h" },
      ],
      [
        WorkTimeApp.i18n.t("yearView.completeDays"),
        totals.completeDays,
        { unit: " d" },
      ],
    ];
    let cards = [...$("yearAnalysisCards").children];
    if (cards.length !== data.length) {
      cards = data.map(([label, , , featured]) => {
        const card = document.createElement("article");
        card.className = "card" + (featured ? " average-card" : "");
        card.innerHTML =
          '<div class="card-label"></div><div class="metric"></div>';
        card.querySelector(".card-label").textContent = label;
        return card;
      });
      $("yearAnalysisCards").replaceChildren(...cards);
    }
    data.forEach(([label, value, format], index) => {
      cards[index].querySelector(".card-label").textContent = label;
      numbers.set(cards[index].querySelector(".metric"), value, {
        ...format,
        alignInk: true,
        unit: value === null ? "" : format.unit,
      });
    });
  }
  return { monthWorkdayNumber, adjacentDayCard, renderCalendar, renderYear };
};
