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
      actual = valid ? C.summary(state, a, b) : C.summary(state, "", ""),
      requirement =
        ready && valid
          ? C.selectOvertimeRequirement(state, a, b).targetMinutes
          : null,
      surplus =
        requirement === null
          ? null
          : actual.workOvertime - requirement * actual.attendance,
      surplusMinutes = surplus === null ? null : Math.round(Math.abs(surplus)),
      surplusNegative = surplus < 0 && surplusMinutes > 0;
    const data = [
      [
        WorkTimeApp.i18n.t("copy.cc954e610b"),
        ready && valid && actual.average !== null ? actual.average / 60 : 0,
        WorkTimeApp.i18n.t("short.averageFormula"),
        { decimals: 3, unit: "h" },
      ],
      [
        WorkTimeApp.i18n.t("copy.fa91c92797"),
        surplusMinutes,
        WorkTimeApp.i18n.t("short.balanceFormula"),
        { unit: "" },
      ],
      [
        WorkTimeApp.i18n.t("copy.7a26926ed7"),
        ready && valid ? Number(actual.attendance.toFixed(4)) : null,
        "",
        { unit: "d" },
      ],
      [
        WorkTimeApp.i18n.t("short.workOT"),
        ready && valid ? actual.workOvertime / 60 : null,
        "",
        { decimals: 2, unit: " h" },
      ],
      [
        WorkTimeApp.i18n.t("short.restOT"),
        ready && valid ? actual.restOvertime / 60 : null,
        "",
        { decimals: 2, unit: " h" },
      ],
      [
        WorkTimeApp.i18n.t("copy.016315b388"),
        ready && valid ? actual.total / 60 : null,
        "",
        { decimals: 2, unit: " h" },
      ],
      [
        WorkTimeApp.i18n.t("copy.eb87bec8ca"),
        valid ? C.pendingWorkdays(state, a, b, today) : null,
        "",
        { unit: "d" },
      ],
    ];
    const targetPanel = document.querySelector(".target-panel");
    if (!cards.length) {
      cards = data.map(([label, , description]) => {
        const card = document.createElement("article");
        card.className =
          "card" +
          (label === WorkTimeApp.i18n.t("copy.cc954e610b")
            ? " average-card"
            : "");
        if (label === WorkTimeApp.i18n.t("copy.fa91c92797"))
          card.classList.add("surplus-card");
        card.innerHTML =
          '<div class="card-label"></div><div class="metric"></div>' +
          (description ? '<div class="card-foot"></div>' : "");
        card.firstElementChild.textContent = label;
        return card;
      });
      $("cards").replaceChildren(...cards);
      cards[0].after(targetPanel);
      const divider = document.createElement("hr");
      divider.className = "summary-divider";
      divider.setAttribute("aria-hidden", "true");
      cards[1].after(divider);
    }
    data.forEach((item, index) => {
      cards[index].querySelector(".card-label").textContent = item[0];
      const fullLabel = [
        "copy.cc954e610b",
        "copy.fa91c92797",
        "copy.7a26926ed7",
        "copy.04fd5a186c",
        "copy.2db287963f",
        "copy.016315b388",
        "copy.eb87bec8ca",
      ][index];
      cards[index].querySelector(".card-label").title =
        WorkTimeApp.i18n.t(fullLabel);
      cards[index]
        .querySelector(".card-label")
        .setAttribute("aria-label", WorkTimeApp.i18n.t(fullLabel));
      if (index < 2)
        cards[index].querySelector(".card-foot").title = WorkTimeApp.i18n.t(
          index === 0 ? "copy.ae47f5dfb5" : "copy.2e0e43d0d6",
        );
      const metric = cards[index].querySelector(".metric");
      if (item[0] === WorkTimeApp.i18n.t("copy.fa91c92797")) {
        if (surplusMinutes === null) updateHTML(metric, "—");
        else {
          updateHTML(
            metric,
            '<span class="surplus-hours"></span><span class="surplus-minutes"></span>',
          );
          numbers.set(
            metric.querySelector(".surplus-hours"),
            (surplusNegative ? "-" : "") + Math.floor(surplusMinutes / 60),
            { unit: "h", alignInk: true },
          );
          numbers.set(
            metric.querySelector(".surplus-minutes"),
            surplusMinutes % 60,
            { unit: "m", alignInk: true },
          );
        }
      } else
        numbers.set(metric, item[1], {
          ...item[3],
          alignInk: true,
          unit: item[1] === null ? "" : item[3].unit,
        });
      if (item[2])
        updateHTML(cards[index].querySelector(".card-foot"), item[2]);
    });
    cards[1]
      .querySelector(".metric")
      .classList.toggle("is-negative", surplusNegative);
    $("setupNotice").classList.toggle("hidden", ready);
    $("storageNotice").classList.toggle("hidden", !storageFailed);
    renderTarget();
  }
  function renderTarget() {
    const state = getState();
    const { today } = getView();
    const display = {
      message: "",
      totalLabel: WorkTimeApp.i18n.t("copy.f84810dcd6"),
      dailyLabel: WorkTimeApp.i18n.t("copy.b0bcecf530"),
      total: null,
      daily: 0,
      target: null,
      counts: "",
      remaining: null,
      remainingPrefix: WorkTimeApp.i18n.t("copy.068c69578d"),
    };
    buildTarget(display, state, today);
    for (const [id, value] of [
      ["targetResult", display.message],
      ["targetCounts", display.counts],
      ["targetDailyLabel", display.dailyLabel],
    ])
      if ($(id).textContent !== value) $(id).textContent = value;
    let shortLabel = display.totalLabel;
    if (
      ["copy.df5cb65034", "copy.bc4e75d700"].some(
        (key) => WorkTimeApp.i18n.t(key) === display.totalLabel,
      )
    )
      shortLabel = WorkTimeApp.i18n.t("short.needed");
    if (WorkTimeApp.i18n.t("copy.d58b3b54dd") === display.totalLabel)
      shortLabel = WorkTimeApp.i18n.t("short.available");
    $("targetTotalLabel").title =
      display.remaining === null
        ? display.totalLabel
        : WorkTimeApp.i18n.t("summary.remaining", {
            label: display.totalLabel,
            days: WorkTimeApp.i18n.plural(
              display.remaining,
              "unit.day.one",
              "unit.day.other",
            ),
          });
    $("targetTotalLabel").setAttribute(
      "aria-label",
      $("targetTotalLabel").title,
    );
    const label =
      display.remaining === null
        ? esc(display.totalLabel)
        : WorkTimeApp.i18n.t("short.target.remaining", {
            label: esc(shortLabel),
            count:
              '<span class="fixed-remaining-count">' +
              esc(WorkTimeApp.i18n.number(display.remaining)) +
              "</span>",
          });
    if (display.remaining === null) {
      const element = $("targetTotalLabel");
      if (element.textContent !== display.totalLabel)
        element.textContent = display.totalLabel;
      markup.delete(element);
    } else updateHTML($("targetTotalLabel"), label);
    for (const [id, value, unit, decimals] of [
      ["targetMetric", display.total, "h", null],
      ["targetDailyMetric", display.daily, "h/d", 2],
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
      display.message = WorkTimeApp.i18n.t("copy.4561283ba2");
      return;
    }
    const [start, end] = monthBounds(),
      condition = C.selectOvertimeRequirement(state, start, end),
      tierLabel =
        condition.tier === 0
          ? WorkTimeApp.i18n.t("copy.e69fe8710f")
          : condition.tier === 4
            ? WorkTimeApp.i18n.t("copy.fea703e117")
            : condition.tier + WorkTimeApp.i18n.t("copy.77e1d94d23");
    display.counts = WorkTimeApp.i18n.t("short.planned", {
      count: condition.plannedDays,
    });
    display.target =
      condition.targetMinutes === null ? null : condition.targetMinutes / 60;
    if (condition.targetMinutes === null) {
      display.message = WorkTimeApp.i18n.t("copy.5300e06359") + tierLabel;
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
      display.message = WorkTimeApp.i18n.t("copy.04a4021608");
      return;
    }
    const remaining = Number(pace.remainingDays.toFixed(2)),
      formatHours = (minutes) => Number((Math.abs(minutes) / 60).toFixed(2));
    if (!pace.remainingDays) {
      const missing = C.pendingWorkdays(state, start, end, today);
      display.totalLabel =
        Math.abs(pace.difference) < 0.005
          ? WorkTimeApp.i18n.t("copy.573a35fdda")
          : pace.difference > 0
            ? missing
              ? WorkTimeApp.i18n.t("copy.a4216d720e")
              : WorkTimeApp.i18n.t("copy.ca615d13ae")
            : WorkTimeApp.i18n.t("copy.8d327bd444");
      display.total =
        Math.abs(pace.difference) < 0.005 ? 0 : formatHours(pace.difference);
      return;
    }
    if (start <= today && today <= end)
      display.remainingPrefix = pace.startsTomorrow
        ? WorkTimeApp.i18n.t("copy.6d6e5b6490")
        : WorkTimeApp.i18n.t("copy.4c8ca6cf6a");
    if (Math.abs(pace.difference) < 0.005) {
      display.totalLabel = WorkTimeApp.i18n.t("copy.67692532ab");
      display.dailyLabel = WorkTimeApp.i18n.t("copy.ff1b93c871");
      display.total = display.daily = 0;
    } else if (pace.difference < 0) {
      display.totalLabel = WorkTimeApp.i18n.t("copy.d58b3b54dd");
      display.dailyLabel = WorkTimeApp.i18n.t("copy.24ac6da480");
      display.total = formatHours(pace.difference);
      display.daily = formatHours(pace.requiredPerDay);
    } else {
      display.totalLabel =
        pace.startsTomorrow && start <= today && today <= end
          ? WorkTimeApp.i18n.t("copy.df5cb65034")
          : WorkTimeApp.i18n.t("copy.bc4e75d700");
      display.dailyLabel = WorkTimeApp.i18n.t("copy.2deb6d7455");
      display.total = formatHours(pace.difference);
      display.daily = formatHours(pace.requiredPerDay);
    }
    display.remaining = remaining;
  }
  return { renderStats, renderTarget };
};
