"use strict";
/** navigation controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createNavigationController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const { core: C, model, actions, element: $, clock, application } = options;
  const animationCompat = WorkTimeApp.ui.animationCompat;
  const reducedMotion = animationCompat.preference();
  let todayAttention = null,
    unlistenMotion;

  function stopTodayAttention() {
    todayAttention?.cancel();
    todayAttention = null;
  }
  function highlightToday() {
    stopTodayAttention();
    const card = $("calendar").querySelector(
      "button.day[data-date=" + JSON.stringify(model.today) + "]",
    );
    if (!card || document.hidden) return;
    // Read the final selected surface, rather than an in-flight hover/selection color.
    for (const animation of card.getAnimations?.() || []) {
      if (
        ["background-color", "box-shadow"].includes(
          animation.transitionProperty,
        )
      )
        animation.finish();
    }
    const style = getComputedStyle(card),
      background = style.backgroundColor,
      accent = style.getPropertyValue("--accent").trim() || "#439e7f",
      shadow = style.boxShadow === "none" ? "" : style.boxShadow + ", ",
      bright = `color-mix(in srgb, ${background} 88%, white)`,
      ring = (spread, blur, opacity) =>
        `${shadow}0 0 ${blur}px ${spread}px color-mix(in srgb, ${accent} ${opacity}%, transparent)`;
    const frames = reducedMotion.matches
      ? [
          { backgroundColor: bright, boxShadow: ring(3, 0, 22) },
          { backgroundColor: bright, boxShadow: ring(3, 0, 22) },
        ]
      : [
          { offset: 0, backgroundColor: background, boxShadow: ring(0, 0, 0) },
          { offset: 0.3, backgroundColor: bright, boxShadow: ring(3, 10, 32) },
          { offset: 1, backgroundColor: background, boxShadow: ring(8, 16, 0) },
        ];
    const attention = animationCompat.animate(card, frames, {
      duration: 800,
      easing: "ease-out",
    });
    todayAttention = attention;
    attention.finished.then(() => {
      if (todayAttention === attention) todayAttention = null;
    });
  }

  function navigateMonth(v) {
    stopTodayAttention();
    model.yearMode = false;
    if (!/^\d{4}-\d{2}$/.test(v) || !C.validDate(v + "-01")) return;
    model.month = v;
    model.selected =
      model.month === model.today.slice(0, 7)
        ? model.today
        : model.month + "-01";
    model.batchDays.clear();
    model.batchAnchor = null;
    actions.render();
    if ($("settingsDialog").open) actions.refreshSettings();
  }
  function prepareBatchEditor() {
    $("batchStart").value = C.scheduleForDate(
      model.state,
      model.selected,
    ).workStart;
    $("batchEnd").value = C.scheduleForDate(
      model.state,
      model.selected,
    ).workEnd;
    $("batchNext").checked = false;
    $("batchCalcStart").value = C.scheduleForDate(
      model.state,
      model.selected,
    ).workStart;
    $("batchCalcOvertime").value = "";
    $("batchError").textContent = "";
    $("batchCalcResult").textContent = "";
    updateBatchNextToggle();
    actions.renderBatchTimeTemplates();
  }
  function updateBatchNextToggle() {
    $("batchNextToggle").setAttribute(
      "aria-pressed",
      String($("batchNext").checked),
    );
  }
  function calculateBatchEndTime() {
    const result = $("batchCalcResult");
    result.textContent = "";
    try {
      if (!model.state.settings.configured)
        throw Error("请先完成工作时间设置。");
      if (!model.batchDays.size) throw Error("请先选择需要计算的日期。");
      const schedules = [...model.batchDays].map((date) =>
        C.scheduleForDate(model.state, date),
      );
      const schedule = schedules[0];
      if (
        schedules.some(
          (item) => C.scheduleSignature(item) !== C.scheduleSignature(schedule),
        )
      )
        throw Error("所选日期包含不同作息，请按作息分批选择后计算。");
      const start = $("batchCalcStart").value,
        startMinutes = C.timeMin(start),
        value = $("batchCalcOvertime").value,
        overtimeHours = Number(value);
      if (startMinutes === null) throw Error("请填写有效的上班时间。");
      if (value === "" || !Number.isFinite(overtimeHours) || overtimeHours < 0)
        throw Error("平均加班工时须为不小于 0 的数字。");
      const targetMinutes =
        schedule.standardMinutes + Math.round(overtimeHours * 60);
      if (targetMinutes >= 1440)
        throw Error("标准工时与平均加班合计须小于 24 小时。");
      const match = C.endForDuration(start, targetMinutes, schedule);
      if (!match) throw Error("当前休息时段下无法在 24 小时内达到目标工时。");
      $("batchStart").value = start;
      $("batchEnd").value = match.end;
      $("batchNext").checked = match.nextDay;
      updateBatchNextToggle();
      actions.renderBatchTimeTemplates();
      $("batchError").textContent = "";
      result.textContent =
        "已填入 " +
        start +
        " – " +
        match.end +
        (match.nextDay ? "（次日）" : "");
    } catch (error) {
      result.textContent = error.message;
    }
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    unlistenMotion = animationCompat.listen(reducedMotion, stopTodayAttention);
    events.listen(document, "visibilitychange", () => {
      if (document.hidden) stopTodayAttention();
    });
    events.listen($("calendar"), "click", stopTodayAttention, true);
    events.handler($("calendar"), "onclick", (e) => {
      const b = e.target.closest("button.day[data-date]");
      if (!b) return;
      const k = b.dataset.date;
      if (model.batchMode) {
        if (!C.canBatchEditDate(model.state, k)) return;
        if (e.shiftKey && model.batchAnchor) {
          const [first, last] = [model.batchAnchor, k].sort();
          for (const card of $("calendar").querySelectorAll(
            "button.day[data-date]",
          )) {
            const date = card.dataset.date;
            if (
              date >= first &&
              date <= last &&
              C.canBatchEditDate(model.state, date)
            )
              model.batchDays.add(date);
          }
        } else {
          model.batchDays.has(k)
            ? model.batchDays.delete(k)
            : model.batchDays.add(k);
          model.batchAnchor = k;
        }
        actions.renderCalendar();
      } else {
        model.selected = k;
        actions.renderCalendar();
        actions.renderEditor();
        if ($("settingsDialog").open) actions.refreshSettings();
      }
    });
    events.handler($("monthTitle"), "onkeydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        $("monthTitle").click();
      }
    });
    events.handler($("monthTitle"), "onclick", () => {
      stopTodayAttention();
      if (model.yearMode) {
        model.yearMode = false;
        model.month = model.returnMonth;
      } else {
        model.yearMode = true;
        model.viewYear = Number(model.month.slice(0, 4));
        model.returnMonth = model.month;
        model.batchMode = false;
        model.batchDays.clear();
        model.batchAnchor = null;
      }
      actions.render();
    });
    events.listen($("calendar"), "click", (e) => {
      const button = e.target.closest("[data-year-date]");
      if (!button) return;
      model.yearMode = false;
      model.month = button.dataset.yearDate.slice(0, 7);
      model.selected = button.dataset.yearDate;
      actions.render();
      if ($("settingsDialog").open) actions.refreshSettings();
      $("calendar")
        .querySelector("[data-date=" + JSON.stringify(model.selected) + "]")
        ?.focus();
    });
    events.handler($("prevMonth"), "onclick", () => {
      stopTodayAttention();
      if (model.yearMode) {
        if (model.viewYear > 1900) model.viewYear--;
        actions.renderCalendar();
        return;
      }
      const d = C.localDate(model.month + "-01");
      d.setMonth(d.getMonth() - 1);
      navigateMonth(C.dateKey(d).slice(0, 7));
    });
    events.handler($("nextMonth"), "onclick", () => {
      stopTodayAttention();
      if (model.yearMode) {
        if (model.viewYear < 9999) model.viewYear++;
        actions.renderCalendar();
        return;
      }
      const d = C.localDate(model.month + "-01");
      d.setMonth(d.getMonth() + 1);
      navigateMonth(C.dateKey(d).slice(0, 7));
    });
    events.handler($("todayButton"), "onclick", () => {
      model.today = clock.today();
      navigateMonth(model.today.slice(0, 7));
      highlightToday();
    });
    events.handler($("batchToggle"), "onclick", () => {
      stopTodayAttention();
      if ($("settingsDialog").open) actions.closeSettings();
      model.batchMode = !model.batchMode;
      model.batchDays.clear();
      model.batchAnchor = null;
      if (model.batchMode) prepareBatchEditor();
      actions.renderCalendar();
    });
    events.handler($("batchCancel"), "onclick", () => {
      stopTodayAttention();
      model.batchMode = false;
      model.batchDays.clear();
      model.batchAnchor = null;
      actions.renderCalendar();
      $("batchToggle").focus();
    });
    events.handler($("batchNextToggle"), "onclick", () => {
      $("batchNext").checked = !$("batchNext").checked;
      updateBatchNextToggle();
      actions.renderBatchTimeTemplates();
    });
    events.handler($("batchCalculateEnd"), "onclick", calculateBatchEndTime);
    events.listen($("batchCalcOvertime"), "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        calculateBatchEndTime();
      }
    });
    events.handler($("batchForm"), "onsubmit", (e) => {
      e.preventDefault();
      for (const date of model.batchDays)
        if (!C.canBatchEditDate(model.state, date))
          model.batchDays.delete(date);
      if (!model.batchDays.size) {
        $("batchError").textContent = "请先选择需要填写的日期。";
        return;
      }
      const record = {
        start: $("batchStart").value,
        end: $("batchEnd").value,
        nextDay: $("batchNext").checked,
        effectiveMinutes: null,
      };
      if (!C.complete(record)) {
        $("batchError").textContent =
          "请填写完整上下班时间；跨午夜请开启“次日下班”。";
        return;
      }
      const count = model.batchDays.size;
      const saved = application.saveBatch(model.batchDays, record).persisted;
      model.batchMode = false;
      model.batchDays.clear();
      model.batchAnchor = null;
      actions.render();
      actions.saveFeedback(saved, "已更新 " + count + " 天时间");
    });
  }
  function dispose() {
    stopTodayAttention();
    unlistenMotion?.();
    unlistenMotion = null;
    events.dispose();
    bound = false;
  }
  const hasDraft = () => model.batchMode;
  return { bind, dispose, updateBatchNextToggle, hasDraft };
};
