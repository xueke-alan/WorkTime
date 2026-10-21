"use strict";
/** navigation controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createNavigationController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const { core: C, model, actions, element: $, clock, application } = options;
  const animationCompat = WorkTimeApp.ui.animationCompat;
  const reducedMotion = animationCompat.preference();
  let todayAttention = null,
    unlistenMotion,
    resettingBatch = false;

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
    if (resettingBatch) return;
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
        throw Error(WorkTimeApp.i18n.t("copy.99d09d1bd5"));
      if (!model.batchDays.size)
        throw Error(WorkTimeApp.i18n.t("copy.23568bd4b2"));
      const schedules = [...model.batchDays].map((date) =>
        C.scheduleForDate(model.state, date),
      );
      const schedule = schedules[0];
      if (
        schedules.some(
          (item) => C.scheduleSignature(item) !== C.scheduleSignature(schedule),
        )
      )
        throw Error(WorkTimeApp.i18n.t("copy.33d9bb36a9"));
      const start = $("batchCalcStart").value,
        startMinutes = C.timeMin(start),
        value = $("batchCalcOvertime").value,
        overtimeHours = Number(value);
      if (startMinutes === null)
        throw Error(WorkTimeApp.i18n.t("copy.abc132bd4b"));
      if (value === "" || !Number.isFinite(overtimeHours) || overtimeHours < 0)
        throw Error(WorkTimeApp.i18n.t("copy.b5694f41a7"));
      const targetMinutes =
        schedule.standardMinutes + Math.round(overtimeHours * 60);
      if (targetMinutes >= 1440)
        throw Error(WorkTimeApp.i18n.t("copy.0e1112168e"));
      const match = C.endForDuration(start, targetMinutes, schedule);
      if (!match) throw Error(WorkTimeApp.i18n.t("copy.c63cf259af"));
      $("batchStart").value = start;
      $("batchEnd").value = match.end;
      $("batchNext").checked = match.nextDay;
      updateBatchNextToggle();
      actions.renderBatchTimeTemplates();
      $("batchError").textContent = "";
      result.textContent =
        WorkTimeApp.i18n.t("copy.72393b4192") +
        start +
        " – " +
        match.end +
        (match.nextDay ? WorkTimeApp.i18n.t("copy.c751037c58") : "");
    } catch (error) {
      result.textContent = WorkTimeApp.i18n.message(error.message);
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
      if (resettingBatch) return;
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
      if (resettingBatch) return;
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
      if (resettingBatch) return;
      stopTodayAttention();
      if ($("settingsDialog").open) actions.closeSettings();
      model.batchMode = !model.batchMode;
      model.batchDays.clear();
      model.batchAnchor = null;
      if (model.batchMode) prepareBatchEditor();
      actions.renderCalendar();
    });
    events.handler($("batchCancel"), "onclick", () => {
      if (resettingBatch) return;
      stopTodayAttention();
      model.batchMode = false;
      model.batchDays.clear();
      model.batchAnchor = null;
      actions.renderCalendar();
      $("batchToggle").focus();
    });
    events.handler($("batchReset"), "onclick", async () => {
      if (resettingBatch || !model.batchMode) return;
      const resetAll = !model.batchDays.size;
      const dates = [...model.batchDays].filter((date) =>
        C.canBatchEditDate(model.state, date),
      );
      if (!resetAll && !dates.length) {
        $("batchError").textContent = WorkTimeApp.i18n.t("copy.f7ca66229c");
        return;
      }
      resettingBatch = true;
      $("batchForm").setAttribute("aria-busy", "true");
      $("batchReset").disabled = true;
      $("batchSave").disabled = true;
      $("batchError").textContent = "";
      try {
        const saved = (await application.resetBatch(resetAll ? null : dates))
          .persisted;
        if (!saved) {
          $("batchError").textContent = WorkTimeApp.i18n.t("copy.b81002effa");
          actions.toast(WorkTimeApp.i18n.t("copy.77b0044d4f"), "error");
          return;
        }
        model.batchMode = false;
        model.batchDays.clear();
        model.batchAnchor = null;
        actions.saveFeedback(
          true,
          resetAll
            ? WorkTimeApp.i18n.t("copy.dc56ca16ae")
            : WorkTimeApp.i18n.t("copy.1a76ac076e") +
                dates.length +
                WorkTimeApp.i18n.t("copy.971430f3c6"),
        );
        $("batchToggle").focus();
      } catch (error) {
        $("batchError").textContent = WorkTimeApp.i18n.t("copy.b81002effa");
        actions.toast(WorkTimeApp.i18n.t("copy.77b0044d4f"), "error");
      } finally {
        resettingBatch = false;
        $("batchForm").removeAttribute("aria-busy");
        actions.render();
      }
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
    events.handler($("batchForm"), "onsubmit", async (e) => {
      e.preventDefault();
      if (resettingBatch) return;
      for (const date of model.batchDays)
        if (!C.canBatchEditDate(model.state, date))
          model.batchDays.delete(date);
      if (!model.batchDays.size) {
        $("batchError").textContent = WorkTimeApp.i18n.t("copy.03ee2fc8fc");
        return;
      }
      const record = {
        start: $("batchStart").value,
        end: $("batchEnd").value,
        nextDay: $("batchNext").checked,
        effectiveMinutes: null,
      };
      if (!C.complete(record)) {
        $("batchError").textContent = WorkTimeApp.i18n.t("copy.f950d3ddc0");
        return;
      }
      const count = model.batchDays.size;
      const saved = (await application.saveBatch(model.batchDays, record))
        .persisted;
      model.batchMode = false;
      model.batchDays.clear();
      model.batchAnchor = null;
      actions.render();
      actions.saveFeedback(
        saved,
        WorkTimeApp.i18n.t("copy.f54a93c893") +
          count +
          WorkTimeApp.i18n.t("copy.a68e14c5a6"),
      );
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
