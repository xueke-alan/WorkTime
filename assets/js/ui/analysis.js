"use strict";
/** A shared date axis links two independent clock-time scales. */
WorkTimeApp.ui.createAnalysis = function ({
  element: $,
  escape: esc,
  getState,
  getView,
  window,
}) {
  const t = (key, values) => WorkTimeApp.i18n.t("analysis." + key, values),
    events = WorkTimeApp.ui.createEventScope(),
    plot = $("analysisPlot");
  let currentData = null,
    lastSize = "",
    selectedDate = null,
    pinnedDate = null,
    linkedDate = null,
    sidebarSignature = "";
  const number = (value) => WorkTimeApp.i18n.number(value);
  const date = (value) =>
    WorkTimeApp.i18n.date(value, {
      year: undefined,
      month: "numeric",
      day: "numeric",
    });
  const { clock, chart, timelineLegend } =
    WorkTimeApp.ui.createAnalysisGraphics({
      escape: esc,
      window,
      t,
      number,
      date,
    });
  let wasVisible = false,
    lastLanguage = "",
    lastSignature = "";
  const renderer = WorkTimeApp.ui.createAnalysisRenderer({
    element: $,
    window,
    onFrame: positionTooltip,
  });
  const {
    feedback,
    stopFeedback,
    stopMotion,
    runMotion,
    syncMarkup,
    canAnimate,
    preference: motionPreference,
  } = renderer;
  function metric(label, value, context, dates = []) {
    const nextDay = t("nextDay") + " ",
      extended = value.startsWith(nextDay);
    const ratio = value.split(" / "),
      empty = value === "—";
    const valueMarkup =
      label === "overtimeDays"
        ? '<span class="analysis-metric-ratio" data-key="ratio" role="img" aria-label="' +
          esc(value) +
          '">' +
          '<span class="analysis-metric-value" data-key="numerator" aria-hidden="true">' +
          esc(ratio[0]) +
          "</span>" +
          '<svg class="analysis-ratio-divider" viewBox="0 0 12 24" aria-hidden="true" focusable="false"' +
          (empty ? " hidden" : "") +
          '><path d="M9 4 3 20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>' +
          '<span class="analysis-metric-value" data-key="denominator" aria-hidden="true"' +
          (empty ? " hidden" : "") +
          ">" +
          esc(ratio[1] || "—") +
          "</span></span>"
        : '<span class="analysis-metric-value" data-key="value">' +
          esc(extended ? value.slice(nextDay.length) : value) +
          "</span>";
    return (
      '<div class="analysis-metric" data-key="' +
      label +
      '"><span title="' +
      esc(t(label)) +
      '">' +
      esc(t("compact." + label)) +
      '</span><strong><span class="analysis-metric-next">' +
      (extended ? esc(t("nextDay")) : "") +
      "</span>" +
      valueMarkup +
      '</strong><div class="analysis-metric-footer"><small>' +
      esc(context) +
      "</small>" +
      (dates.length > 1
        ? '<details><summary aria-label="' +
          esc(t("allDates", { count: dates.length })) +
          '">+' +
          esc(number(dates.length)) +
          "</summary><p>" +
          dates.map((item) => esc(date(item))).join(" · ") +
          "</p></details>"
        : "") +
      "</div></div>"
    );
  }
  function positionTooltip() {
    const tooltip = $("analysisHover"),
      point = plot.querySelector(
        '.analysis-range.is-selected [data-lane="start"]',
      );
    if (tooltip.hidden || !point) return;
    const chartBox = $("analysisChart").getBoundingClientRect(),
      pointBox = point.getBoundingClientRect(),
      tooltipBox = tooltip.getBoundingClientRect(),
      pageBox = $("analysisPage").getBoundingClientRect(),
      center = pointBox.left + pointBox.width / 2 - chartBox.left,
      left = Math.max(
        8,
        Math.min(
          center - tooltipBox.width / 2,
          chartBox.width - tooltipBox.width - 8,
        ),
      );
    tooltip.style.left = left + "px";
    tooltip.style.top =
      Math.max(
        pageBox.top - chartBox.top + 8,
        pointBox.top - chartBox.top - tooltipBox.height - 12,
      ) + "px";
  }
  function selectDate(value) {
    const day = currentData?.chartDays.find(
      (item) => item.date === (value || linkedDate),
    );
    const next = day?.date || null;
    if (next === selectedDate && $("analysisHover").childElementCount) return;
    const appearing = Boolean(day && $("analysisHover").hidden);
    selectedDate = next;
    renderSidebar(next);
    for (const group of plot.querySelectorAll(".analysis-range"))
      group.classList.toggle("is-selected", group.dataset.date === next);
    $("analysisHover").hidden = !day;
    $("analysisHover").innerHTML = day
      ? '<div class="analysis-tooltip"><strong>' +
        esc(
          date(day.date) +
            " · " +
            WorkTimeApp.i18n.weekday(day.date) +
            (!day.work ? " · " + t("restOvertime") : "") +
            (day.manual ? " · " + t("manualRecord") : ""),
        ) +
        "</strong>" +
        [
          ["start", clock(day.start)],
          ["end", clock(day.end)],
          ["overtime", WorkTimeApp.i18n.duration(day.overtime)],
        ]
          .map(
            ([key, value]) =>
              "<span>" + esc(t(key)) + "<b>" + esc(value) + "</b></span>",
          )
          .join("") +
        "</div>"
      : "";
    positionTooltip();
    if (appearing || !day) feedback($("analysisHover"), appearing);
  }
  function suggestedDays() {
    if (!currentData) return [];
    const days = currentData.days;
    const latest = days.reduce(
      (best, day) => (!best || day.end > best.end ? day : best),
      null,
    );
    const earliest = days.reduce(
      (best, day) => (!best || day.end < best.end ? day : best),
      null,
    );
    const rest = days.find((day) => !day.work);
    return [
      ...new Map(
        [latest, earliest, rest, ...days.toReversed()]
          .filter(Boolean)
          .map((day) => [day.date, day]),
      ).values(),
    ].slice(0, 3);
  }
  function pinDate(value) {
    if (!currentData?.chartDays.some((day) => day.date === value)) return;
    pinnedDate = value;
    renderSidebar(value);
  }
  const minuteLabel = (value) =>
    t("sidebarMinutes", { value: number(Math.round(value)) });
  function renderSidebar(previewDate = null) {
    if (!currentData) return;
    const metrics = currentData.workdayMetrics,
      days = currentData.days,
      focus = currentData.chartDays.find(
        (day) => day.date === (previewDate || pinnedDate),
      ),
      signature = JSON.stringify([
        lastSignature,
        WorkTimeApp.i18n.language,
        focus?.date,
        pinnedDate,
      ]);
    if (signature === sidebarSignature) return;
    sidebarSignature = signature;
    $("analysisFocusDetail").setAttribute(
      "aria-live",
      previewDate && previewDate !== pinnedDate ? "off" : "polite",
    );
    const row = (label, value) =>
      '<div class="analysis-sidebar-row"><span>' +
      esc(t(label)) +
      "</span><strong>" +
      esc(value) +
      "</strong></div>";
    $("analysisSidebarMonth").textContent = WorkTimeApp.i18n.date(
      currentData.first,
      { year: "numeric", month: "long", day: undefined },
    );
    const span = (value) =>
      value < 60 ? minuteLabel(value) : WorkTimeApp.i18n.duration(value);
    $("analysisObservation").textContent =
      metrics.count > 1
        ? t("sidebarSpread", {
            start: span(metrics.latestStart.minutes - metrics.earliest.minutes),
            end: span(metrics.latest.minutes - metrics.earliestEnd.minutes),
          })
        : t(metrics.count ? "sidebarOneRecord" : "sidebarNoWorkdays");
    const late = metrics.days.filter((day) => day.end > 1200);
    const buckets = [0, 0, 0];
    for (const day of late)
      buckets[Math.min(2, Math.floor((Number(day.date.slice(8)) - 1) / 10))]++;
    const concentrated =
      late.length >= 2 && Math.max(...buckets) / late.length >= 0.6;
    $("analysisObservationContext").textContent = metrics.count
      ? concentrated
        ? t("sidebarLateCluster", {
            period: t("sidebarPeriod" + buckets.indexOf(Math.max(...buckets))),
          })
        : t("sidebarLateCount", { count: number(late.length) })
      : t("sidebarRecordsHint");
    const choices = suggestedDays()
      .map(
        (day) =>
          '<button class="ui-button" type="button" data-analysis-focus="' +
          esc(day.date) +
          '" aria-pressed="' +
          String(day.date === pinnedDate) +
          '">' +
          esc(date(day.date)) +
          "</button>",
      )
      .join("");
    if ($("analysisFocusDates").dataset.markup !== choices) {
      const focused = window.document.activeElement?.dataset?.analysisFocus;
      $("analysisFocusDates").innerHTML = choices;
      $("analysisFocusDates").dataset.markup = choices;
      if (focused)
        $("analysisFocusDates")
          .querySelector('[data-analysis-focus="' + focused + '"]')
          ?.focus({ preventScroll: true });
    }
    if (focus) {
      const future = focus.date > currentData.asOf;
      const difference =
        metrics.averageEnd === null || future
          ? null
          : Math.round(focus.end - metrics.averageEnd);
      const delta =
        difference === null
          ? "—"
          : difference === 0
            ? t("unchanged")
            : t(difference > 0 ? "later" : "earlier", {
                value: number(Math.abs(difference)),
              });
      const source = t(
        future ? "sidebarPlanned" : focus.manual ? "manualRecord" : "observed",
      );
      const focusTime = (minutes) =>
        minutes >= 1440
          ? "<small>" +
            esc(t("nextDay")) +
            "</small>" +
            esc(clock(minutes % 1440))
          : esc(clock(minutes));
      const markup =
        '<div class="analysis-focus-heading"><strong>' +
        esc(date(focus.date) + " · " + WorkTimeApp.i18n.weekday(focus.date)) +
        "</strong><span>" +
        esc(t(focus.work ? "sidebarWorkday" : "restOvertime")) +
        "</span></div>" +
        '<div class="analysis-focus-times"><strong>' +
        focusTime(focus.start) +
        '</strong><span aria-hidden="true">→</span><strong>' +
        focusTime(focus.end) +
        "</strong></div>" +
        row("sidebarEffective", WorkTimeApp.i18n.duration(focus.minutes)) +
        row("sidebarDepartureDelta", delta) +
        '<p class="analysis-sidebar-muted analysis-focus-source">' +
        esc(
          source +
            " · " +
            t(future ? "sidebarExcluded" : "sidebarBreaksDeducted"),
        ) +
        "</p>";
      if ($("analysisFocusDetail").dataset.markup !== markup) {
        $("analysisFocusDetail").innerHTML = markup;
        $("analysisFocusDetail").dataset.markup = markup;
      }
    } else {
      $("analysisFocusDetail").textContent = t("sidebarNoFocus");
      delete $("analysisFocusDetail").dataset.markup;
    }
    $("analysisSidebarScope").innerHTML =
      row("sidebarValidDays", t("days", { count: number(days.length) })) +
      '<div class="analysis-sidebar-row"><span>' +
      esc(t("sidebarWorkday") + " / " + t("sidebarRestDays")) +
      "</span><strong>" +
      esc(
        number(metrics.count) +
          " / " +
          number(days.filter((day) => !day.work).length),
      ) +
      "</strong></div>" +
      row(
        "manualRecord",
        t(currentData.includeManual ? "sidebarIncluded" : "sidebarNotIncluded"),
      ) +
      '<p class="analysis-sidebar-muted">' +
      esc(
        t("sidebarComparisonRange", {
          current:
            date(currentData.comparison.currentStart) +
            "–" +
            date(currentData.comparison.currentEnd),
          previous:
            date(currentData.comparison.previousStart) +
            "–" +
            date(currentData.comparison.previousEnd),
        }),
      ) +
      "</p>";
  }
  events.listen($("analysisFocusDates"), "click", (event) => {
    const button = event.target.closest("[data-analysis-focus]");
    if (button) {
      linkedDate = button.dataset.analysisFocus;
      pinDate(linkedDate);
      selectDate(linkedDate);
    }
  });
  events.listen($("analysisFocusDates"), "keydown", (event) => {
    if (event.key === "Escape") {
      linkedDate = null;
      selectDate(null);
    }
  });
  // Event delegation survives resizing and language changes without new listeners.
  const groupFrom = (target) => {
    const group = target?.closest?.(".analysis-range, .analysis-day");
    return group?.hasAttribute("data-exiting") ? null : group;
  };
  events.listen(
    $("analysisMetrics"),
    "toggle",
    (event) => {
      if (event.target.matches("details")) {
        const popup = event.target.querySelector("p");
        if (popup) feedback(popup, event.target.open);
      }
    },
    true,
  );
  events.listen(plot, "scroll", positionTooltip);
  events.listen(plot, "pointerover", (event) => {
    const group = groupFrom(event.target);
    selectDate(
      group?.dataset.date ||
        groupFrom(window.document.activeElement)?.dataset.date,
    );
  });
  events.listen(plot, "pointerleave", () =>
    selectDate(groupFrom(window.document.activeElement)?.dataset.date),
  );
  events.listen(plot, "focusin", (event) =>
    selectDate(groupFrom(event.target)?.dataset.date),
  );
  events.listen(plot, "focusout", (event) => {
    if (!plot.contains(event.relatedTarget)) selectDate(null);
  });
  events.listen(plot, "pointerdown", (event) => {
    const group = groupFrom(event.target);
    if (!group) return;
    // Pointer clicks must not create a focus selection that survives hover.
    event.preventDefault();
    linkedDate = null;
    groupFrom(window.document.activeElement)?.blur();
    pinDate(group.dataset.date);
    selectDate(event.pointerType === "touch" ? null : group.dataset.date);
  });
  events.listen(plot, "keydown", (event) => {
    const group = groupFrom(event.target);
    if (!group) return;
    const groups = [
        ...plot.querySelectorAll(
          group.matches(".analysis-day")
            ? ".analysis-day:not([data-exiting])"
            : ".analysis-range:not([data-exiting])",
        ),
      ],
      index = groups.indexOf(group);
    const next = {
      ArrowLeft: Math.max(0, index - 1),
      ArrowRight: Math.min(groups.length - 1, index + 1),
      Home: 0,
      End: groups.length - 1,
    }[event.key];
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pinDate(group.dataset.date);
    }
    if (next !== undefined) {
      event.preventDefault();
      groups[next].focus();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      linkedDate = null;
      selectDate(null);
      $("analysisChart").focus({ preventScroll: true });
    }
  });

  function drawChart() {
    if (!currentData || !getView().analysisMode) return;
    const desktop = window.matchMedia("(min-width: 1151px)").matches,
      bounds = plot.getBoundingClientRect(),
      width = desktop ? Math.round(bounds.width) : 760,
      height = desktop ? Math.round(bounds.height) : 420,
      size = width + ":" + height;
    if (width < 1 || height < 1 || size === lastSize) return;
    const focusedGroup = groupFrom(window.document.activeElement),
      focused = focusedGroup?.dataset.date,
      focusKind = focusedGroup?.matches(".analysis-day")
        ? ".analysis-day"
        : ".analysis-range";
    lastSize = size;
    syncMarkup(plot, chart(currentData, width, height));
    const previous = selectedDate;
    selectedDate = null;
    selectDate(previous);
    if (focused) {
      const nextFocus = plot.querySelector(
        focusKind + '[data-date="' + focused + '"]:not([data-exiting])',
      );
      (nextFocus || $("analysisChart")).focus({ preventScroll: true });
    }
  }
  const resize = new window.ResizeObserver(() => {
    const bounds = plot.getBoundingClientRect();
    const size = window.matchMedia("(min-width: 1151px)").matches
      ? Math.round(bounds.width) + ":" + Math.round(bounds.height)
      : "760:420";
    if (size === lastSize) return;
    stopMotion();
    renderer.animated = false;
    drawChart();
  });
  resize.observe(plot);

  function render() {
    const view = getView(),
      state = getState(),
      schedule = WorkTimeApp.domain.schedule.scheduleForDate(
        state,
        view.selected,
      ),
      data = {
        ...WorkTimeApp.domain.statistics.monthlyAnalysis(
          state,
          view.month,
          view.today,
          view.analysisIncludeManual,
        ),
        referenceStart: WorkTimeApp.domain.time.timeMin(schedule.workStart),
        referenceEnd: WorkTimeApp.domain.time.timeMin(schedule.workEnd),
        workdayMetrics: WorkTimeApp.domain.statistics.monthlyAnalysis(
          state,
          view.month,
          view.today,
          view.analysisIncludeManual,
          { workdaysOnly: true },
        ),
        comparison: WorkTimeApp.domain.statistics.monthlyAnalysisComparison(
          state,
          view.month,
          view.today,
          view.analysisIncludeManual,
        ),
      };
    const language = WorkTimeApp.i18n.language,
      signature = JSON.stringify(data),
      changed = signature !== lastSignature,
      sameMonth = currentData?.first === data.first,
      focused = window.document.activeElement?.closest?.(
        ".analysis-range, .analysis-day",
      )?.dataset.date,
      focusKind = window.document.activeElement?.closest?.(".analysis-range")
        ? ".analysis-range"
        : ".analysis-day",
      previousSelection = selectedDate;
    if (
      !changed &&
      lastLanguage === language &&
      wasVisible &&
      view.analysisMode
    )
      return;
    stopMotion(false);
    renderer.animated = Boolean(
      wasVisible &&
      lastLanguage === language &&
      changed &&
      canAnimate() &&
      !WorkTimeApp.i18n.changing,
    );
    wasVisible = view.analysisMode;
    lastLanguage = language;
    lastSignature = signature;
    $("analysisManual").checked = view.analysisIncludeManual;
    const metrics = data.workdayMetrics,
      earliest = metrics.earliest,
      latest = metrics.latest,
      range = metrics.longest.count
        ? date(metrics.longest.start) + " – " + date(metrics.longest.end)
        : "—";
    const extremeMetric = (label, extreme) =>
      metric(
        label,
        extreme ? clock(extreme.minutes) : "—",
        extreme ? date(extreme.dates[0]) : "—",
        extreme?.dates,
      );
    const duration = (minutes) => WorkTimeApp.i18n.duration(minutes);
    const percent = (count) =>
      metrics.count
        ? WorkTimeApp.i18n.number(count / metrics.count, {
            style: "percent",
            maximumFractionDigits: 0,
          })
        : "—";
    const group = (key, contents, description = "") =>
      '<section class="analysis-metric-group analysis-metric-group-' +
      key +
      '" data-key="group-' +
      key +
      '"' +
      (description
        ? ' title="' +
          esc(description) +
          '" aria-description="' +
          esc(description) +
          '"'
        : "") +
      "><h3>" +
      esc(t("group" + key)) +
      "</h3>" +
      contents +
      "</section>";
    const change = (value, unit, positive, negative) => {
      if (value === null) return "—";
      const rounded =
        unit === "minutes" ? Math.round(value) : Math.round(value * 100) / 100;
      if (!rounded) return t("unchanged");
      return t(rounded > 0 ? positive : negative, {
        value:
          unit === "hours"
            ? duration(Math.abs(rounded))
            : WorkTimeApp.i18n.number(Math.abs(rounded), {
                maximumFractionDigits: 2,
              }),
      });
    };
    const comparison = data.comparison;
    const period = (start, end, count) =>
      t("comparisonPeriod", {
        start: WorkTimeApp.i18n.date(start, {
          year: "numeric",
          month: "numeric",
          day: "numeric",
        }),
        end: WorkTimeApp.i18n.date(end, {
          year: "numeric",
          month: "numeric",
          day: "numeric",
        }),
        count: number(count),
      });
    const restDays = data.days.filter((day) => !day.work);
    const maximum = metrics.maximumOvertime;
    const metricsMarkup =
      group(
        "Arrival",
        extremeMetric("earliest", earliest) +
          extremeMetric("latestStart", metrics.latestStart) +
          metric("averageStart", clock(metrics.averageStart), ""),
      ) +
      group(
        "Departure",
        extremeMetric("earliestEnd", metrics.earliestEnd) +
          extremeMetric("latest", latest) +
          metric("averageEnd", clock(metrics.averageEnd), ""),
      ) +
      group(
        "Late",
        metrics.lateCounts
          .map(({ threshold, count }) =>
            metric(
              "late" + threshold,
              metrics.count ? number(count) : "—",
              percent(count),
            ),
          )
          .join(""),
      ) +
      group(
        "Overtime",
        metric(
          "overtimeDays",
          metrics.count
            ? number(metrics.overtimeDays) + " / " + number(metrics.count)
            : "—",
          percent(metrics.overtimeDays),
        ) +
          metric(
            "longest",
            metrics.count ? number(metrics.longest.count) : "—",
            range,
          ) +
          metric(
            "totalOvertime",
            duration(metrics.count ? metrics.overtimeMinutes : null),
            "",
          ) +
          metric("averageOvertime", duration(metrics.averageOvertime), "") +
          metric(
            "maximumOvertime",
            duration(maximum?.minutes),
            maximum?.minutes > 0 ? date(maximum.dates[0]) : "",
            maximum?.minutes > 0 ? maximum.dates : [],
          ) +
          metric(
            "restOvertimeTotal",
            duration(
              restDays.length
                ? restDays.reduce((sum, day) => sum + day.overtime, 0)
                : null,
            ),
            "",
          ),
      ) +
      group(
        "Comparison",
        metric(
          "endChange",
          change(comparison.averageEndChange, "minutes", "later", "earlier"),
          "",
        ) +
          metric(
            "ratioChange",
            change(
              comparison.overtimeRatioChange,
              "points",
              "morePoints",
              "fewerPoints",
            ),
            "",
          ) +
          metric(
            "totalChange",
            change(
              comparison.overtimeMinutesChange,
              "hours",
              "moreHours",
              "fewerHours",
            ),
            "",
          ),
        period(
          comparison.currentStart,
          comparison.currentEnd,
          comparison.currentCount,
        ) +
          "\n" +
          period(
            comparison.previousStart,
            comparison.previousEnd,
            comparison.previousCount,
          ),
      );
    syncMarkup($("analysisMetrics"), metricsMarkup, 0);
    $("analysisDetails").hidden = false;
    currentData = data;
    if (!sameMonth || !data.chartDays.some((day) => day.date === linkedDate))
      linkedDate = null;
    if (!sameMonth || !data.chartDays.some((day) => day.date === pinnedDate))
      pinnedDate = suggestedDays()[0]?.date || null;
    sidebarSignature = "";
    renderSidebar();
    lastSize = "";
    selectedDate = null;
    $("analysisHover").replaceChildren();
    $("analysisHover").hidden = true;
    syncMarkup($("analysisTimelineLegend"), timelineLegend(data), 220);
    drawChart();
    if (sameMonth) {
      selectedDate = null;
      selectDate(previousSelection);
    }
    if (focused) {
      const retained = $("analysisPage").querySelector(
        focusKind + '[data-date="' + focused + '"]:not([data-exiting])',
      );
      (retained || $("analysisChart")).focus({ preventScroll: true });
    }
    runMotion();
  }
  const unlistenMotion = WorkTimeApp.ui.animationCompat.listen(
    motionPreference,
    () => {
      if (motionPreference.matches) {
        stopMotion();
        stopFeedback();
      }
    },
  );
  events.listen(window.document, "visibilitychange", () => {
    if (window.document.hidden) {
      stopMotion();
      stopFeedback();
    }
  });
  const visibility = new window.MutationObserver(() => {
    if ($("analysisPage").hidden) {
      stopMotion();
      stopFeedback();
      wasVisible = false;
    }
  });
  visibility.observe($("analysisPage"), {
    attributes: true,
    attributeFilter: ["hidden"],
  });
  return {
    render,
    dispose() {
      stopMotion();
      stopFeedback();
      visibility.disconnect();
      unlistenMotion();
      resize.disconnect();
      events.dispose();
      currentData = null;
    },
  };
};
