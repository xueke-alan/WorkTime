"use strict";

/** Create an isolated calendar view; state/view getters remain live after restore and navigation. */
WorkTimeApp.ui.createCalendar = function (options) {
  const {
    core: C,
    element: $,
    escape: esc,
    getState,
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
  let calendarMarkup = "";
  const calendarNodes = new Map();
  const markup = new WeakMap();
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
        label = years ? "入职 " + years + " 周年纪念日" : "入职日";
      markers.push({
        label,
        hint: label + "；入职日期：" + start,
        className: " employment-icon",
        icon: '<g transform="translate(11 11) scale(3.25)" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M5 21v-2.5c0-3.6 3.1-6 7-6s7 2.4 7 6V21Z"/></g>',
      });
    }
    if (date === payday.date)
      markers.push({
        label: "发薪日",
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
  function updateHTML(element, html) {
    if (markup.get(element) === html) return;
    element.innerHTML = html;
    markup.set(element, html);
  }
  function updateText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }
  function updateMonthTitle(year, month, yearMode) {
    const title = $("monthTitle");
    if (!title.querySelector(".month-title-divider")) {
      title.innerHTML =
        '<span id="monthTitleYear" class="month-title-year" data-number-motion></span><svg class="month-title-divider" viewBox="0 0 12 24" aria-hidden="true" focusable="false"><path d="M9 4 3 20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg><span id="monthTitleMonth" class="month-title-month" data-number-motion></span>';
    }
    for (const [selector, value] of [
      [".month-title-year", String(year)],
      [".month-title-month", String(month)],
    ]) {
      const number = title.querySelector(selector);
      numbers.set(number, Number(value));
    }
    title.classList.toggle("is-year-title", yearMode);
    title
      .querySelector(".month-title-month")
      .setAttribute("aria-hidden", String(yearMode));
  }
  function updateYearMonth(element, candidate) {
    const buttons = new Map(
      [...element.querySelectorAll("[data-year-date]")].map((button) => [
        button.dataset.yearDate,
        button,
      ]),
    );
    const nextButtons = [...candidate.querySelectorAll("[data-year-date]")];
    if (
      buttons.size !== nextButtons.length ||
      nextButtons.some((button) => !buttons.has(button.dataset.yearDate))
    )
      return false;
    // The same year/month has fixed day order and blank offsets. Keep every day
    // button and its aligned text layer, including keyboard focus and animation.
    updateHTML(
      element.querySelector(".year-month-stats"),
      candidate.querySelector(".year-month-stats").innerHTML,
    );
    for (const next of nextButtons) {
      const button = buttons.get(next.dataset.yearDate);
      for (const attribute of [...button.attributes])
        if (!next.hasAttribute(attribute.name))
          button.removeAttribute(attribute.name);
      for (const attribute of next.attributes)
        if (button.getAttribute(attribute.name) !== attribute.value)
          button.setAttribute(attribute.name, attribute.value);
      updateText(button.querySelector("span"), next.textContent);
    }
    return true;
  }
  function updateCalendar(html) {
    if (html === calendarMarkup) return;
    const container = $("calendar"),
      template = document.createElement("template"),
      next = new Map();
    template.innerHTML = html;
    const candidates = [...template.content.children],
      nodeKey = (candidate, index) =>
        candidate.tagName +
        ":" +
        (candidate.dataset.date ||
          candidate.dataset.previewDate ||
          candidate.getAttribute("aria-label") ||
          index);
    if (
      !candidates.some((candidate, index) => {
        const previous = calendarNodes.get(nodeKey(candidate, index));
        return previous?.element.parentElement === container;
      })
    ) {
      // A different month/year structure must switch in one operation; intermediate
      // layouts otherwise change the browser's scroll anchor on narrow screens.
      container.replaceChildren(...candidates);
      calendarNodes.clear();
    }
    candidates.forEach((candidate, index) => {
      const key = nodeKey(candidate, index),
        previous = calendarNodes.get(key),
        source = candidate.outerHTML,
        candidateContent = candidate.innerHTML;
      let element = candidate;
      if (previous && previous.element.parentElement === container) {
        element = previous.element;
        if (previous.source !== source) {
          // Preserve the day button itself, including its keyboard focus.
          for (const attribute of previous.attributes)
            if (!candidate.hasAttribute(attribute))
              element.removeAttribute(attribute);
          for (const attribute of candidate.attributes)
            if (element.getAttribute(attribute.name) !== attribute.value)
              element.setAttribute(attribute.name, attribute.value);
          if (
            previous.content !== candidateContent &&
            !(
              element.matches(".year-month") &&
              updateYearMonth(element, candidate)
            )
          ) {
            const markers = element.querySelector(".date-markers"),
              nextMarkers = candidate.querySelector(".date-markers");
            if (
              markers &&
              nextMarkers &&
              markers.outerHTML === nextMarkers.outerHTML
            )
              nextMarkers.replaceWith(markers);
            // Weather owns these persistent layers. Keep them attached so editing
            // attendance neither reloads the SVG nor replays the weather fade.
            for (const child of [...element.childNodes])
              if (
                !(child instanceof Element) ||
                !child.matches(
                  ".calendar-weather-icon, .calendar-weather-outgoing",
                )
              )
                child.remove();
            const content = document.createDocumentFragment();
            content.append(...candidate.childNodes);
            element.insertBefore(content, element.firstChild);
          }
          if (element.querySelector(".calendar-weather-icon"))
            element.classList.add("has-weather");
        }
      }
      next.set(key, {
        element,
        source,
        content: candidateContent,
        attributes: [...candidate.attributes].map(
          (attribute) => attribute.name,
        ),
      });
      if (container.children[index] !== element)
        container.insertBefore(element, container.children[index] || null);
    });
    for (const [key, previous] of calendarNodes)
      if (!next.has(key)) previous.element.remove();
    calendarNodes.clear();
    for (const [key, value] of next) calendarNodes.set(key, value);
    calendarMarkup = html;
    weatherLayer.refresh();
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
      '<div class="schedule-change-tag" title="作息较前一天发生变化">' +
      tag("工时变更", "blue") +
      "</div>"
    );
  }
  function adjacentDayCard(k) {
    const state = getState();
    const info = C.calendarInfo(k, state.days[k] || {}),
      date = C.localDate(k),
      scheduleChanged = hasScheduleChange(state, k),
      kind =
        info.label.replace(" · 手动", "") +
        (info.work ? " " + monthWorkdayNumber(k) : "");
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
      (scheduleChanged ? " 工时变更" : "") +
      '"><div class="daytop"><span class="daynum">' +
      date.getDate() +
      "<small>" +
      Number(k.slice(5, 7)) +
      '月</small></span><span class="daykind">' +
      esc(kind) +
      "</span></div>" +
      (scheduleChanged
        ? '<div class="daystatus">' + scheduleChangeTag() + "</div>"
        : "") +
      "</div>"
    );
  }
  function renderCalendar(keepLeavePanel = false) {
    const state = getState();
    const { today, month, selected, batchMode, batchDays, yearMode, viewYear } =
      getView();
    for (const date of batchDays)
      if (!C.canBatchEditDate(state, date)) batchDays.delete(date);
    if (!keepLeavePanel) closeLeavePanel();
    const viewChanged =
      renderedYearMode !== null && renderedYearMode !== yearMode;
    renderedYearMode = yearMode;
    $("calendar").classList.toggle("year-calendar", yearMode);
    $("calendar").classList.toggle("is-batch-editing", batchMode && !yearMode);
    document
      .querySelector(".panel>.weekdays")
      .classList.toggle("hidden", yearMode);
    document
      .querySelector(".calendar-footer>.legend:not(.year-legend)")
      .classList.toggle("hidden", yearMode);
    $("yearLegend").classList.toggle("hidden", !yearMode);
    $("batchToggle").disabled = yearMode;
    $("monthTitle").setAttribute("aria-pressed", String(yearMode));
    $("monthTitle").setAttribute(
      "aria-label",
      yearMode ? "返回月视图" : "切换到年视图",
    );
    $("prevMonth").setAttribute("aria-label", yearMode ? "上一年" : "上个月");
    $("nextMonth").setAttribute("aria-label", yearMode ? "下一年" : "下个月");
    if (yearMode) {
      const yearChanged =
          renderedViewYear !== null && renderedViewYear !== viewYear,
        direction = viewYear > renderedViewYear ? "12px" : "-12px";
      renderYear();
      if (viewChanged) {
        WorkTimeApp.ui.motion?.play($("calendar"), "motion-calendar-view");
        [...$("calendar").children].forEach((element, i) =>
          WorkTimeApp.ui.motion?.play(element, "motion-year-month", i * 12),
        );
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
      monthViewYear + "年放假安排未内置，暂按周末及节日当天休息统计。",
    );
    yearNotice.classList.toggle("hidden", C.calendarKnown(month + "-01"));
    const [first, last] = monthBounds(),
      d = C.localDate(first),
      offset = (d.getDay() + 6) % 7,
      total = Number(last.slice(8)),
      weeks = Math.ceil((offset + total) / 7);
    let html = "",
      workdayNumber = 0,
      counts = { actual: 0, estimate: 0, pending: 0 },
      dailyAverages = C.cumulativeAverageOvertime(state, first, last);
    const payday = C.payday(first),
      paydayHint =
        "发薪日：" +
        payday.date +
        (payday.shiftedDays
          ? "；原定 " +
            payday.scheduled +
            "，提前 " +
            payday.shiftedDays +
            " 天"
          : "；每月15日发薪") +
        (!payday.calendarKnown
          ? "；该年份放假安排未内置，暂按周末及节日当天休息推算"
          : "");
    for (let i = offset; i > 0; i--) {
      const preview = C.localDate(first);
      preview.setDate(preview.getDate() - i);
      html += adjacentDayCard(C.dateKey(preview));
    }
    for (let i = 1; i <= total; i++) {
      const k = month + "-" + C.pad(i),
        day = state.days[k] || {},
        batchEligible = C.canBatchEditDate(state, k),
        info = C.calendarInfo(k, day),
        r = C.effectiveRecord(day, true),
        sourceRecord = r || day.oa,
        punch = C.actualRecord(day) || day.draft || day.oa,
        hasPunch =
          !!punch &&
          (!!punch.start ||
            !!punch.end ||
            Number.isFinite(punch.effectiveMinutes)),
        schedule = C.scheduleForDate(state, k),
        scheduleChanged = hasScheduleChange(state, k, schedule),
        calc = C.calculate(k, day, schedule, true),
        label = stateLabel(day, r, k),
        markers = dateMarkers(k, payday, paydayHint),
        kindLabel =
          info.label.replace(" · 手动", "") +
          (info.work ? " " + ++workdayNumber : "");
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
          (info.work || (calc.minutes !== null && calc.minutes > 0)) &&
          (k <= today || (r && r.manual && C.complete(r))),
        averageText = !showAverage
          ? ""
          : average === null
            ? "—"
            : (average / 60).toFixed(2) + " h";
      const previous = C.localDate(k);
      previous.setDate(previous.getDate() - 1);
      const previousAverage =
        C.dateKey(previous) >= first
          ? dailyAverages[C.dateKey(previous)]?.averageMinutes
          : null;
      const trend =
          !averageText || average === null || previousAverage === null
            ? ""
            : Number((average / 60).toFixed(2)) >
                Number((previousAverage / 60).toFixed(2))
              ? "up"
              : Number((average / 60).toFixed(2)) <
                  Number((previousAverage / 60).toFixed(2))
                ? "down"
                : "flat",
        trendLabel =
          trend === "up"
            ? "较前一日上升"
            : trend === "down"
              ? "较前一日下降"
              : trend === "flat"
                ? "与前一日持平"
                : "";
      const time =
          r && C.complete(r)
            ? (r.start || "修正工时") +
              (r.end ? " – " + r.end + (r.nextDay ? "⁺¹" : "") : "")
            : day.draft
              ? (day.draft.start || "待填写") +
                " – " +
                (day.draft.end || "待填写")
              : day.oa && day.oa.start
                ? day.oa.start + " – 待更新"
                : "",
        sourceDot =
          sourceRecord &&
          (C.complete(sourceRecord) || sourceRecord.start || sourceRecord.end)
            ? sourceRecord.manual
              ? '<span class="record-source-dot manual" title="手动填写" aria-hidden="true"></span>' +
                (day.oa
                  ? '<span class="record-source-dot oa secondary" title="同时保留 OA 导入数据" aria-hidden="true"></span>'
                  : "")
              : '<span class="record-source-dot oa" title="OA 导入" aria-hidden="true"></span>'
            : "";
      html +=
        '<button class="' +
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
        (scheduleChanged ? " 工时变更" : "") +
        (averageText
          ? " 日均加班 " + averageText + (trendLabel ? "，" + trendLabel : "")
          : "") +
        (isFullLeave(day, k)
          ? " 全天请假"
          : day.leaveMinutes
            ? " 请假 " + C.hours(day.leaveMinutes) + "h"
            : "") +
        markers.label +
        '"><div class="daytop"><span class="day-date"><span class="daynum"><span class="daynum-text">' +
        i +
        "</span></span>" +
        markers.html +
        '</span><span class="daykind">' +
        esc(kindLabel) +
        '</span></div><div class="daytime">' +
        esc(time) +
        sourceDot +
        '</div><div class="dayhours">' +
        (calc.minutes !== null ? C.formatMinutes(calc.minutes) : "") +
        '</div><div class="day-average" title="' +
        esc(
          "本月截至当日：累计工作日加班 ÷ 已完成记录的折算出勤" +
            (dailyAverages[k].pending ? "；打卡未完成，暂不显示平均加班" : "") +
            (trendLabel ? "；" + trendLabel : ""),
        ) +
        '">' +
        (averageText
          ? "<span>" + averageText + "</span>" + (trend ? trendIcon(trend) : "")
          : "") +
        '</div><div class="daystatus">' +
        (["未填写", "手动填写", "OA导入"].includes(label)
          ? ""
          : statusTag(
              label,
              info,
              label === "异常"
                ? "red"
                : label === "待录入"
                  ? "amber"
                  : r && r.manual
                    ? "blue"
                    : label === "无出勤记录"
                      ? ""
                      : "green",
            )) +
        (!info.work && day.plannedOvertime
          ? "<div>" + tag(hasPunch ? "加班" : "计划加班", "amber") + "</div>"
          : "") +
        (scheduleChanged ? scheduleChangeTag() : "") +
        (day.leaveMinutes
          ? isFullLeave(day, k)
            ? "<div>" + tag("全天请假", "leave") + "</div>"
            : "<div>" +
              tag("请假 " + C.hours(day.leaveMinutes) + "h", "leave") +
              "</div>"
          : "") +
        "</div></button>";
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
      "本月 " +
        (counts.actual + counts.estimate) +
        " 天完整记录 · " +
        C.pendingWorkdays(state, first, last, today) +
        " 天待录入",
    );
    renderTimeAnomalyNotice();
    $("batchBar").classList.toggle("hidden", !batchMode);
    $("dayEditor").classList.toggle("hidden", batchMode);
    $("batchToggle").setAttribute("aria-pressed", String(batchMode));
    $("batchToggle").title = batchMode ? "取消批量填写" : "批量填写";
    $("batchToggle")
      .querySelector("use")
      .setAttribute("href", batchMode ? "#ms-close" : "#ms-stacks");
    $("batchToggle").setAttribute(
      "aria-label",
      batchMode ? "取消批量填写" : "批量填写",
    );
    $("batchSave").disabled = !batchDays.size;
    updateText(
      $("batchSelectionCount"),
      "当前已选择 " + batchDays.size + " 天",
    );
    $("batchToggle").classList.toggle("primary", batchMode);
    if (monthChanged) {
      $("calendar").style.setProperty("--motion-direction", direction);
      [...$("calendar").children].forEach((day, i) =>
        WorkTimeApp.ui.motion?.play(day, "motion-day", Math.floor(i / 7) * 22),
      );
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
      viewYear + "年放假安排未内置，暂按周末及节日当天休息统计。",
    );
    notice.classList.toggle("hidden", C.calendarKnown(viewYear + "-01-01"));
    const months = WorkYear.months(state, viewYear, today);
    $("calendar").removeAttribute("data-weeks");
    updateCalendar(
      months
        .map(
          (m) =>
            '<section class="year-month" aria-label="' +
            viewYear +
            "年" +
            m.month +
            '月"><h3><span class="year-month-number">' +
            m.month +
            '</span><span class="year-month-stats"><span title="总加班时长（工作日与休息日合计）" aria-label="总加班时长">' +
            Number(
              ((m.summary.workOvertime + m.summary.restOvertime) / 60).toFixed(
                2,
              ),
            ) +
            'h</span><span title="平均加班工时（工作日加班 ÷ 折算出勤）" aria-label="平均加班工时">' +
            (m.summary.average === null
              ? "—"
              : (m.summary.average / 60).toFixed(2)) +
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
        "年 · " +
        months.reduce(
          (sum, m) => sum + m.days.filter((d) => d.complete).length,
          0,
        ) +
        " 天完整记录",
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
    $("batchToggle").title = "批量填写";
    $("batchToggle").setAttribute("aria-label", "批量填写");
    $("batchToggle").querySelector("use").setAttribute("href", "#ms-stacks");
    renderedMonth = null;
    renderedMode = false;
    renderedSelection = selected;
    updateNotificationEmptyState();
  }
  return { monthWorkdayNumber, adjacentDayCard, renderCalendar, renderYear };
};
