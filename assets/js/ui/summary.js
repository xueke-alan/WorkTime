"use strict";

/** Create an isolated summary view; state/view getters remain live after restore and navigation. */
WorkUI.createSummary = function (options) {
  const {
    core: C,
    element: $,
    escape: esc,
    getState,
    getView,
    getRange: monthBounds,
    isStorageFailed,
    document,
    window,
  } = options;
  const bounds = monthBounds;
  const markup = new WeakMap();
  let cards = [];
  function updateHTML(element, value) {
    if (markup.get(element) === value) return;
    element.innerHTML = value;
    markup.set(element, value);
  }
  function rangeValid() {
    const [a, b] = bounds();
    return C.validDate(a) && C.validDate(b) && a <= b;
  }
  function renderStats() {
    const state = getState();
    const { today } = getView();
    const storageFailed = isStorageFailed();

    const [a, b] = bounds(),
      valid = rangeValid(),
      ready = state.settings.configured,
      actual = valid ? C.summary(state, a, b) : C.summary(state, "", "");
    const data = [
      [
        "平均加班",
        ready && valid
          ? actual.average === null
            ? "—"
            : (actual.average / 60).toFixed(3) + "<small>h</small>"
          : "—",
        "工作日加班 ÷ 折算出勤",
      ],
      [
        "折算出勤",
        ready && valid
          ? Number(actual.attendance.toFixed(4)) + "<small>d</small>"
          : "—",
        "按请假时长折算",
      ],
      [
        "工作日加班",
        ready && valid ? C.formatMinutes(actual.workOvertime) : "—",
        "包含调休补班",
      ],
      [
        "休息日加班",
        ready && valid ? C.formatMinutes(actual.restOvertime) : "—",
        "不参与平均加班",
      ],
      [
        "总工时",
        ready && valid ? C.formatMinutes(actual.total) : "—",
        '<span class="fixed-record-count">' +
          actual.completeDays +
          "</span> d · 完整记录",
      ],
      [
        "待录入",
        valid
          ? C.pendingWorkdays(state, a, b, today) + "<small>d</small>"
          : "—",
        "未完整打卡的工作日",
      ],
    ];
    const targetPanel = document.querySelector(".target-panel");
    if (!cards.length) {
      cards = data.map(([label]) => {
        const card = document.createElement("article");
        card.className = "card" + (label === "平均加班" ? " average-card" : "");
        card.innerHTML =
          '<div class="card-label"></div><div class="metric"></div><div class="card-foot"></div>';
        card.firstElementChild.textContent = label;
        return card;
      });
      $("cards").replaceChildren(...cards);
      cards[0].after(targetPanel);
    }
    data.forEach((item, index) => {
      updateHTML(
        cards[index].querySelector(".metric"),
        item[1].replace(/ h$/, "<small> h</small>"),
      );
      updateHTML(cards[index].querySelector(".card-foot"), item[2]);
    });
    $("setupNotice").classList.toggle("hidden", ready);
    $("storageNotice").classList.toggle("hidden", !storageFailed);
    renderTarget();
    window.SummaryNumbers?.update(document.querySelector(".summary-sidebar"));
  }
  function renderTarget() {
    const state = getState();
    const { today } = getView();
    const display = {
      message: "",
      totalLabel: "剩余合计",
      dailyLabel: "平均每天",
      total: "-",
      daily: "-",
      target: "-",
      counts: "",
      remaining: null,
    };
    buildTarget(display, state, today);
    for (const [id, value] of [
      ["targetResult", display.message],
      ["targetCounts", display.counts],
      ["targetDailyLabel", display.dailyLabel],
    ])
      if ($(id).textContent !== value) $(id).textContent = value;
    const label =
      display.remaining === null
        ? esc(display.totalLabel)
        : '后续 <span class="fixed-remaining-count">' +
          display.remaining +
          "</span> 天" +
          esc(display.totalLabel);
    if (display.remaining === null) {
      const element = $("targetTotalLabel");
      if (element.textContent !== display.totalLabel)
        element.textContent = display.totalLabel;
      markup.delete(element);
    } else updateHTML($("targetTotalLabel"), label);
    for (const [id, value, unit] of [
      ["targetMetric", display.total, "h"],
      ["targetDailyMetric", display.daily, "h/d"],
      ["targetValue", display.target, "h"],
    ])
      updateHTML($(id), value + "<small>" + unit + "</small>");
  }
  function buildTarget(display, state, today) {
    if (!state.settings.configured) {
      display.message = "请先完成计算设置";
      return;
    }
    const [start, end] = monthBounds(),
      condition = C.selectOvertimeRequirement(state, start, end),
      tierLabel =
        condition.tier === 0
          ? "最低要求"
          : condition.tier === 4
            ? "4天及以上"
            : condition.tier + "天档";
    display.counts = "计划本月加班 " + condition.plannedDays + " 天";
    display.target =
      condition.targetMinutes === null
        ? "-"
        : (condition.targetMinutes / 60).toFixed(1);
    if (condition.targetMinutes === null) {
      display.message = "请在计算设置中配置" + tierLabel;
      return;
    }
    const pace = C.targetPace(
      state,
      start,
      end,
      today,
      condition.targetMinutes,
    );
    if (!pace || !pace.plannedDays) {
      display.message = "本月没有应上班日";
      return;
    }
    const remaining = Number(pace.remainingDays.toFixed(2)),
      formatHours = (minutes) => Number((Math.abs(minutes) / 60).toFixed(2));
    if (!pace.remainingDays) {
      const missing = C.pendingWorkdays(state, start, end, today);
      display.totalLabel =
        Math.abs(pace.difference) < 0.005
          ? "已达标"
          : pace.difference > 0
            ? missing
              ? "记录内差额"
              : "未达标差额"
            : "超出目标";
      display.total =
        Math.abs(pace.difference) < 0.005 ? 0 : formatHours(pace.difference);
      return;
    }
    if (Math.abs(pace.difference) < 0.005) {
      display.totalLabel = "合计差额";
      display.dailyLabel = "日均差额";
      display.total = display.daily = 0;
    } else if (pace.difference < 0) {
      display.totalLabel = "合计可少上";
      display.dailyLabel = "平均可少上";
      display.total = formatHours(pace.difference);
      display.daily = formatHours(pace.requiredPerDay);
    } else {
      display.totalLabel = "需加班";
      display.dailyLabel = "平均仍需加班";
      display.total = formatHours(pace.difference);
      display.daily = formatHours(pace.requiredPerDay);
    }
    display.remaining = remaining;
  }
  return { renderStats, renderTarget };
};
