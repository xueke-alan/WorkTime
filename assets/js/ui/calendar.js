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
  let renderedMonth = null,
    renderedMode = null,
    renderedSelection = null,
    renderedYearMode = null,
    renderedViewYear = null;

  const { updateHTML, updateText, updateCalendar } =
    WorkTimeApp.ui.createCalendarRenderer({
      element: $,
      document,
      weatherLayer,
    });
  const monthSlotWidths = new Map();
  let monthMeasureContext;
  function timePart(value, manual) {
    return manual
      ? '<span class="manual-time">' + esc(value) + "</span>"
      : esc(value);
  }
  function sourceIndicator(day, record) {
    const manual = day.draft || day.actual || day.estimate,
      both = !!(day.oa && manual),
      priority = day.sourcePriority === "manual" || !day.oa ? "manual" : "oa";
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
        ? '<span class="date-markers" role="img" aria-label="' +
          esc(markers.map((marker) => marker.label).join("、")) +
          '" title="' +
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
        animateWhole: wordMonth && selector === ".month-title-month",
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
    const info = C.calendarInfo(k, state.days[k] || {}),
      date = C.localDate(k),
      scheduleChanged = hasScheduleChange(state, k),
      kind =
        calendarKind(info) + (info.work ? " " + monthWorkdayNumber(k) : "");
    const classes = [
      "day",
      "adjacent",
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
      batchMode,
      batchDays,
      batchDraft,
      batchSaving,
      yearMode,
      analysisMode,
      viewYear,
    } = getView();
    for (const id of ["prevMonth", "nextMonth", "todayButton"])
      $(id).disabled = batchMode;
    $("monthTitle").setAttribute("aria-disabled", String(batchMode));
    $("monthTitle").tabIndex = batchMode ? -1 : 0;
    const weekday = WorkTimeApp.i18n.weekday(today);
    const dateLabel = WorkTimeApp.i18n.date(today).replace(/\s*\/\s*/g, " / ");
    updateHTML($("calendarToday"), WorkTimeApp.ui.headerDateMarkup(today, esc));
    $("calendarToday").setAttribute(
      "aria-label",
      WorkTimeApp.i18n.t("copy.723d1e7f20") + dateLabel + " " + weekday,
    );
    $("calendarToday").dateTime = today;
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
    $("calendar").classList.toggle("is-batch-editing", batchMode && !yearMode);
    document
      .querySelector("#panelContent>.weekdays")
      .classList.toggle("hidden", yearMode);
    document
      .querySelector(".calendar-footer>.legend:not(.year-legend)")
      .classList.toggle("hidden", yearMode);
    $("yearLegend").classList.toggle("hidden", !yearMode);
    $("batchToggle").disabled = yearMode || analysisMode;
    $("analysisToggle").disabled = batchMode;
    $("analysisToggle").setAttribute("aria-pressed", String(!!analysisMode));
    $("analysisToggle").classList.toggle("is-active", !!analysisMode);
    $("analysisToggle")
      .querySelector("use")
      .setAttribute(
        "href",
        analysisMode ? "#ms-table-chart-view" : "#ms-calendar",
      );
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
    $("calendar").classList.toggle("hidden", !!analysisMode);
    $("analysisPage").hidden = !analysisMode;
    if (analysisMode) {
      document.querySelector("#panelContent>.weekdays").classList.add("hidden");
      document
        .querySelector(".calendar-footer>.legend:not(.year-legend)")
        .classList.add("hidden");
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
      const yearChanged =
          renderedViewYear !== null && renderedViewYear !== viewYear,
        direction = viewYear > renderedViewYear ? "12px" : "-12px";
      renderYear();
      if (viewChanged) {
        WorkTimeApp.ui.motion?.play($("calendar"), "motion-calendar-view");
      } else if (yearChanged) {
        $("calendar").style.setProperty("--motion-direction", direction);
        WorkTimeApp.ui.motion?.play($("calendar"), "motion-calendar-year");
      }
      renderedViewYear = viewYear;
      return;
    }
    const monthChanged = renderedMonth !== null && renderedMonth !== month,
      modeChanged = renderedMode !== null && renderedMode !== batchMode,
      selectionChanged =
        renderedSelection !== null && renderedSelection !== selected;
    const direction = month > renderedMonth ? "8px" : "-8px";
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
        isFullLeave(day, k)
          ? "full-leave"
          : day.leaveMinutes
            ? "partial-leave"
            : "",
        selected === k && !batchMode ? "selected" : "",
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
        (batchMode ? batchDays.has(k) : selected === k) +
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
        '</div><div class="day-footer"><div class="day-average" title="' +
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
    $("calendar").dataset.weeks = weeks;
    updateCalendar(html);
    updateText(
      $("calendarFoot"),
      WorkTimeApp.i18n.t("copy.222e6cef7c") +
        (counts.actual + counts.estimate) +
        WorkTimeApp.i18n.t("copy.8d46bff7bf") +
        C.pendingWorkdays(state, first, last, today) +
        WorkTimeApp.i18n.t("copy.85bd9f454a"),
    );
    renderTimeAnomalyNotice();
    $("batchBar").classList.toggle("hidden", !batchMode);
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
    $("batchSave").disabled = !batchDraft?.canConfirm || batchSaving;
    $("batchCancel").disabled = $("batchToggle").disabled = !!batchSaving;
    $("batchAutoSelect").disabled = !!batchSaving;
    const resetAll = !batchDays.size;
    $("batchReset").disabled =
      $("batchForm").getAttribute("aria-busy") === "true";
    updateText(
      $("batchReset").querySelector(".button-label"),
      resetAll
        ? WorkTimeApp.i18n.t("short.batchReset")
        : WorkTimeApp.i18n.t("short.batchResetSelected"),
    );
    $("batchReset").setAttribute(
      "aria-label",
      resetAll
        ? WorkTimeApp.i18n.t("copy.ee5bb614c4")
        : WorkTimeApp.i18n.t("copy.2455259fc5"),
    );
    $("batchReset").title =
      WorkTimeApp.i18n.t("copy.7b15e5e8e7") +
      (resetAll
        ? WorkTimeApp.i18n.t("copy.78e45ac995")
        : WorkTimeApp.i18n.t("copy.26139f522b")) +
      WorkTimeApp.i18n.t("copy.32ed29d7b7");
    updateText(
      $("batchSelectionCount"),
      WorkTimeApp.i18n.t("copy.d31313dabc") +
        batchDays.size +
        WorkTimeApp.i18n.t("copy.f8bb0516cc"),
    );
    $("batchToggle").classList.toggle("primary", batchMode);
    const previewStatus = $("batchPreviewStatus");
    const originalState = getOriginalState(),
      resetState =
        batchMode && batchDraft
          ? WorkTimeApp.domain.batch.applyBatchChanges(originalState, {
              ...batchDraft,
              month,
              record: null,
            })
          : originalState,
      resetCount = Object.keys(originalState.days).filter(
        (date) => originalState.days[date] !== resetState.days[date],
      ).length;
    updateText(
      previewStatus,
      batchMode
        ? WorkTimeApp.i18n.t("batch.preview") +
            "\n" +
            WorkTimeApp.i18n.t(
              batchDraft?.reset === "all"
                ? "batch.resetAllCount"
                : "batch.resetCount",
              { count: resetCount },
            ) +
            " · " +
            WorkTimeApp.i18n.t("batch.fillCount", {
              count: batchDraft?.record ? batchDraft.dates.length : 0,
            })
        : "",
    );
    $("cards").classList.toggle("is-batch-preview", batchMode);
    if (monthChanged && !viewChanged) {
      $("calendar").style.setProperty("--motion-direction", direction);
      WorkTimeApp.ui.motion?.play($("calendar"), "motion-calendar-year");
    } else if (selectionChanged && !batchMode)
      WorkTimeApp.ui.motion?.play(
        $("calendar").querySelector(".selected"),
        "motion-selection",
      );
    if (modeChanged) {
      WorkTimeApp.ui.motion?.play(
        $(batchMode ? "batchForm" : "dayForm"),
        batchMode ? "motion-sidebar-forward" : "motion-sidebar-back",
      );
    }
    if (viewChanged)
      WorkTimeApp.ui.motion?.play($("calendar"), "motion-calendar-view");
    renderedMonth = month;
    renderedMode = batchMode;
    renderedSelection = selected;
  }
  function renderYear() {
    const state = getState();
    const { today, selected, viewYear } = getView();

    updateMonthTitle(viewYear, Number(getView().month.slice(5)), true);
    const notice = $("yearNotice");
    updateText(
      notice.querySelector(".notification-body"),
      viewYear + WorkTimeApp.i18n.t("copy.29c9747e36"),
    );
    notice.classList.toggle("hidden", C.calendarKnown(viewYear + "-01-01"));
    const months = WorkYear.months(state, viewYear, today);
    $("calendar").removeAttribute("data-weeks");
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
            '"><h3><span class="year-month-number">' +
            WorkTimeApp.i18n.monthName(
              viewYear + "-" + String(m.month).padStart(2, "0") + "-01",
            ) +
            WorkTimeApp.i18n.t("copy.2b3cbb76bd").replace(/^月/, "") +
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
            'h/d</span></span></h3><div class="year-days">' +
            '<span aria-hidden="true"></span>'.repeat(m.offset) +
            m.days
              .map(
                (d) =>
                  '<button type="button" class="year-day' +
                  (d.date === selected ? " selected" : "") +
                  '" aria-pressed="' +
                  (d.date === selected) +
                  '" style="background:' +
                  d.color.background +
                  ";color:" +
                  d.color.text +
                  '" data-year-date="' +
                  d.date +
                  '" aria-label="' +
                  esc(d.description) +
                  '"' +
                  (d.today ? ' aria-current="date"' : "") +
                  "><span>" +
                  d.number +
                  "</span></button>",
              )
              .join("") +
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
    const stops =
      WorkYear.heatColor(minimum, maximum, minimum).background +
      " 0%," +
      WorkYear.heatColor(0, maximum, minimum).background +
      " " +
      zeroPosition +
      "%," +
      WorkYear.heatColor(maximum, maximum, minimum).background +
      " 100%";
    updateHTML(
      $("yearLegend"),
      '<span class="year-scale">' +
        (minimum < 0 ? "<span>" + C.hours(minimum) + " h</span>" : "") +
        '<span class="year-gradient" aria-hidden="true" style="background:linear-gradient(to right,' +
        stops +
        ')"></span>' +
        (maximum > 0 ? "<span>" + C.hours(maximum) + " h</span>" : "") +
        "</span>",
    );
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
    renderedMonth = null;
    renderedMode = false;
    renderedSelection = selected;
    updateNotificationEmptyState();
  }
  return { monthWorkdayNumber, adjacentDayCard, renderCalendar, renderYear };
};
