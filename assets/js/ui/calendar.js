"use strict";

/** Create an isolated calendar view; state/view getters remain live after restore and navigation. */
WorkUI.createCalendar = function (options) {
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
    window,
  } = options;
  let renderedMonth = null,
    renderedMode = null,
    renderedSelection = null,
    renderedYearMode = null,
    renderedViewYear = null;
  let calendarMarkup = "";
  const calendarNodes = new Map();
  const markup = new WeakMap();
  function updateHTML(element, html) {
    if (markup.get(element) === html) return;
    element.innerHTML = html;
    markup.set(element, html);
  }
  function updateText(element, text) {
    if (element.textContent !== text) element.textContent = text;
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
        source = candidate.outerHTML;
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
          if (previous.content !== candidate.innerHTML)
            element.innerHTML = candidate.innerHTML;
        }
      }
      next.set(key, {
        element,
        source,
        content: candidate.innerHTML,
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
  function adjacentDayCard(k) {
    const state = getState();
    const info = C.calendarInfo(k, state.days[k] || {}),
      date = C.localDate(k),
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
      ' aria-label="' +
      k +
      " " +
      esc(kind) +
      '"><div class="daytop"><span class="daynum">' +
      date.getDate() +
      "<small>" +
      Number(k.slice(5, 7)) +
      '月</small></span><span class="daykind">' +
      esc(kind) +
      "</span></div></div>"
    );
  }
  function renderCalendar(keepLeavePanel = false) {
    const state = getState();
    const { today, month, selected, batchMode, batchDays, yearMode, viewYear } =
      getView();
    if (!keepLeavePanel) closeLeavePanel();
    const viewChanged =
      renderedYearMode !== null && renderedYearMode !== yearMode;
    renderedYearMode = yearMode;
    $("calendar").classList.toggle("year-calendar", yearMode);
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
        window.WorkMotion?.play($("calendar"), "motion-calendar-view");
        [...$("calendar").children].forEach((element, i) =>
          window.WorkMotion?.play(element, "motion-year-month", i * 12),
        );
      } else if (yearChanged) {
        $("calendar").style.setProperty("--motion-direction", direction);
        window.WorkMotion?.play($("calendar"), "motion-calendar-year");
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
    updateHTML(
      $("monthTitle"),
      '<span class="month-title-year">' +
        Number(monthViewYear) +
        '</span><svg class="month-title-divider" viewBox="0 0 12 24" aria-hidden="true" focusable="false"><path d="M9 4 3 20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg><span class="month-title-month">' +
        Number(month.slice(5)) +
        "</span>",
    );
    updateText(
      yearNotice.querySelector(".notification-body"),
      monthViewYear + "年未内置节假日，按周一至周五统计。",
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
    const payday = window.Payday.calculate(first),
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
        (!payday.calendarKnown ? "；该年份未内置节假日，按周一至周五推算" : "");
    for (let i = offset; i > 0; i--) {
      const preview = C.localDate(first);
      preview.setDate(preview.getDate() - i);
      html += adjacentDayCard(C.dateKey(preview));
    }
    for (let i = 1; i <= total; i++) {
      const k = month + "-" + C.pad(i),
        day = state.days[k] || {},
        info = C.calendarInfo(k, day),
        r = C.effectiveRecord(day, true),
        calc = C.calculate(k, day, state.settings, true),
        label = stateLabel(day, r, k),
        kindLabel =
          info.label.replace(" · 手动", "") +
          (info.work ? " " + ++workdayNumber : "");
      if (r && C.complete(r)) {
        counts[r.type === "estimate" ? "estimate" : "actual"]++;
      } else if (day.oa && day.oa.status === "pending") counts.pending++;
      const classes = [
        "day",
        !info.work ? "restday" : "",
        info.weekend ? "weekend" : "",
        isFullLeave(day)
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
          info.work &&
          !day.leaveMinutes &&
          (k <= today || (r && r.manual && C.complete(r))),
        averageText =
          !showAverage ||
          average === null ||
          (calc.minutes === null && !dailyAverages[k].workOvertimeMinutes)
            ? ""
            : (average / 60).toFixed(2) + " h";
      const previous = C.localDate(k);
      previous.setDate(previous.getDate() - 1);
      const previousAverage =
        C.dateKey(previous) >= first
          ? dailyAverages[C.dateKey(previous)]?.averageMinutes
          : null;
      const trend =
          !averageText || previousAverage === null
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
          r && C.complete(r)
            ? r.manual
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
        (info.holiday ? ' data-holiday="' + esc(info.holiday) + '"' : "") +
        ' aria-pressed="' +
        (batchMode ? batchDays.has(k) : selected === k) +
        '" aria-label="' +
        k +
        " " +
        esc(kindLabel) +
        " " +
        visibleStatus(label, info) +
        (averageText
          ? " 日均加班 " + averageText + (trendLabel ? "，" + trendLabel : "")
          : "") +
        (isFullLeave(day)
          ? " 全天请假"
          : day.leaveMinutes
            ? " 请假 " + C.hours(day.leaveMinutes) + "h"
            : "") +
        (k === state.settings.employmentDate
          ? " 入职日"
          : k === payday.date
            ? " 发薪日"
            : "") +
        '"><div class="daytop"><span class="day-date"><span class="daynum"><span class="daynum-text">' +
        i +
        "</span></span>" +
        (k === state.settings.employmentDate
          ? '<span class="payday-icon employment-icon" role="img" aria-label="入职日" title="入职日：' +
            esc(k) +
            '"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 20v-2a7 7 0 0 1 14 0v2M9 14l3 3 3-3M12 17v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
          : k === payday.date
            ? '<span class="payday-icon" role="img" aria-label="发薪日" title="' +
              esc(paydayHint) +
              '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 4 6 7 6-7M12 11v9M6 11h12M6 15h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
            : "") +
        '</span><span class="daykind">' +
        esc(kindLabel) +
        '</span></div><div class="daytime">' +
        esc(time) +
        sourceDot +
        '</div><div class="dayhours">' +
        (calc.minutes !== null ? C.formatMinutes(calc.minutes) : "") +
        '</div><div class="day-average" title="' +
        esc(
          "本月1日至当日：工作日加班 ÷ 应上班工时 × 标准日工时；包含调休补班与请假时段" +
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
                  ? "gray"
                  : r && r.manual
                    ? "blue"
                    : label === "无出勤记录"
                      ? ""
                      : "green",
            )) +
        (!info.work && day.plannedOvertime
          ? "<div>" + tag("计划加班", "amber") + "</div>"
          : "") +
        (day.leaveMinutes
          ? isFullLeave(day)
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
    updateText(
      $("batchToggle").querySelector("span"),
      batchMode ? "取消填写" : "批量填写",
    );
    $("batchToggle").setAttribute(
      "aria-label",
      batchMode ? "取消批量填写" : "批量填写",
    );
    $("batchSave").disabled = !batchDays.size;
    $("batchToggle").classList.toggle("primary", batchMode);
    if (monthChanged) {
      $("calendar").style.setProperty("--motion-direction", direction);
      [...$("calendar").children].forEach((day, i) =>
        window.WorkMotion?.play(day, "motion-day", Math.floor(i / 7) * 22),
      );
    } else if (selectionChanged && !batchMode)
      window.WorkMotion?.play(
        $("calendar").querySelector(".selected"),
        "motion-selection",
      );
    if (modeChanged)
      window.WorkMotion?.play($(batchMode ? "batchBar" : "dayEditor"));
    if (viewChanged)
      window.WorkMotion?.play($("calendar"), "motion-calendar-view");
    renderedMonth = month;
    renderedMode = batchMode;
    renderedSelection = selected;
  }
  function renderYear() {
    const state = getState();
    const { today, selected, viewYear } = getView();

    updateHTML(
      $("monthTitle"),
      '<span class="month-title-year">' + viewYear + "</span>",
    );
    const notice = $("yearNotice");
    updateText(
      notice.querySelector(".notification-body"),
      viewYear + "年未内置节假日，按周一至周五统计。",
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
            '月"><h3>' +
            m.month +
            '月</h3><div class="year-days">' +
            '<span aria-hidden="true"></span>'.repeat(m.offset) +
            m.days
              .map(
                (d) =>
                  '<button type="button" class="year-day" style="background:' +
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
    $("batchToggle").querySelector("span").textContent = "批量填写";
    renderedMonth = null;
    renderedMode = false;
    renderedSelection = selected;
    updateNotificationEmptyState();
  }
  return { monthWorkdayNumber, adjacentDayCard, renderCalendar, renderYear };
};
