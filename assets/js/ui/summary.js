"use strict";

/** Create an isolated summary view; state/view getters remain live after restore and navigation. */
WorkTimeApp.ui.createSummary = function (options) {
  const {
    core: C,
    element: $,
    escape: esc,
    getState,
    getView,
    getRange: monthBounds,
    isStorageFailed,
    document,
    numbers,
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
        ready && valid && actual.average !== null ? actual.average / 60 : 0,
        "工作日加班 ÷ 折算出勤",
        { decimals: 3, unit: "h" },
      ],
      [
        "折算出勤",
        ready && valid ? Number(actual.attendance.toFixed(4)) : null,
        "",
        { unit: "d" },
      ],
      [
        "工作日加班",
        ready && valid ? actual.workOvertime / 60 : null,
        "",
        { decimals: 2, unit: " h" },
      ],
      [
        "休息日加班",
        ready && valid ? actual.restOvertime / 60 : null,
        "",
        { decimals: 2, unit: " h" },
      ],
      [
        "总工时",
        ready && valid ? actual.total / 60 : null,
        "",
        { decimals: 2, unit: " h" },
      ],
      [
        "待录入",
        valid ? C.pendingWorkdays(state, a, b, today) : null,
        "",
        { unit: "d" },
      ],
    ];
    const targetPanel = document.querySelector(".target-panel");
    if (!cards.length) {
      cards = data.map(([label, , description]) => {
        const card = document.createElement("article");
        card.className = "card" + (label === "平均加班" ? " average-card" : "");
        card.innerHTML =
          '<div class="card-label"></div><div class="metric"></div>' +
          (description ? '<div class="card-foot"></div>' : "");
        card.firstElementChild.textContent = label;
        return card;
      });
      $("cards").replaceChildren(...cards);
      cards[0].after(targetPanel);
    }
    data.forEach((item, index) => {
      numbers.set(cards[index].querySelector(".metric"), item[1], {
        ...item[3],
        alignInk: true,
        unit: item[1] === null ? "" : item[3].unit,
      });
      if (item[2])
        updateHTML(cards[index].querySelector(".card-foot"), item[2]);
    });
    $("setupNotice").classList.toggle("hidden", ready);
    $("storageNotice").classList.toggle("hidden", !storageFailed);
    renderTarget();
  }
  function renderTarget() {
    const state = getState();
    const { today } = getView();
    const display = {
      message: "",
      totalLabel: "剩余合计",
      dailyLabel: "平均每天",
      total: null,
      daily: 0,
      target: null,
      counts: "",
      remaining: null,
      remainingPrefix: "后续",
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
        : esc(display.remainingPrefix) +
          '<span class="fixed-remaining-count">' +
          display.remaining +
          "</span>天" +
          esc(display.totalLabel);
    if (display.remaining === null) {
      const element = $("targetTotalLabel");
      if (element.textContent !== display.totalLabel)
        element.textContent = display.totalLabel;
      markup.delete(element);
    } else updateHTML($("targetTotalLabel"), label);
    for (const [id, value, unit, decimals] of [
      ["targetMetric", display.total, "h", null],
      ["targetDailyMetric", display.daily, "h/d", 1],
      ["targetValue", display.target, "h", 1],
    ])
      numbers.set($(id), value, {
        unit,
        decimals,
        alignInk: true,
        placeholder: "-",
      });
  }
  function buildTarget(display, state, today) {
    if (!state.settings.configured) {
      display.message = "请先完成工作时间设置";
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
      condition.targetMinutes === null ? null : condition.targetMinutes / 60;
    if (condition.targetMinutes === null) {
      display.message = "请在工作时间设置中配置" + tierLabel;
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
    if (start <= today && today <= end)
      display.remainingPrefix = pace.startsTomorrow
        ? "明日起后续"
        : "含今日后续";
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
      display.totalLabel =
        pace.startsTomorrow && start <= today && today <= end
          ? "需要加班"
          : "需加班";
      display.dailyLabel = "平均仍需加班";
      display.total = formatHours(pace.difference);
      display.daily = formatHours(pace.requiredPerDay);
    }
    display.remaining = remaining;
  }
  return { renderStats, renderTarget };
};
