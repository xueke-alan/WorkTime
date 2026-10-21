"use strict";
/** navigation controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createNavigationController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const { core: C, model, actions, element: $, clock, application } = options;
  const animationCompat = WorkTimeApp.ui.animationCompat;
  const reducedMotion = animationCompat.preference();
  let todayAttention = null,
    analysisTransition = null,
    monthAnimations = [],
    unlistenMotion,
    resettingBatch = false;

  function stopTodayAttention() {
    todayAttention?.cancel();
    todayAttention = null;
  }

  function commitAnalysisTransition(transition) {
    if (transition.committed) return;
    transition.committed = true;
    if (model.yearMode) {
      model.month = model.returnMonth;
      model.yearMode = false;
    }
    model.analysisMode = transition.target;
    actions.render();
  }

  function stopAnalysisTransition(settle = true) {
    stopMonthTransition();
    const transition = analysisTransition;
    if (!transition) return;
    analysisTransition = null;
    for (const animation of transition.animations) animation.cancel();
    try {
      if (settle) commitAnalysisTransition(transition);
    } finally {
      for (const [element, inert] of transition.elements) element.inert = inert;
    }
  }

  async function toggleAnalysis() {
    if (resettingBatch || model.batchMode || analysisTransition) return;
    stopMonthTransition();
    stopTodayAttention();
    const transition = {
      target: !model.analysisMode,
      committed: false,
      animations: [],
      elements: new Map(),
    };
    analysisTransition = transition;
    const play = (entering) => {
      const distance = transition.target ? -24 : 24,
        offset = entering ? -distance : distance,
        shifted = {
          opacity: 0,
          transform: `translateY(${offset}px)`,
        },
        resting = { opacity: 1, transform: "none" };
      const content = $("panelContent"),
        elements = [
          content,
          ...document.querySelectorAll(".calendar-footer > *"),
        ];
      transition.animations = elements.map((element) => {
        if (!transition.elements.has(element))
          transition.elements.set(element, element.inert);
        element.inert = true;
        WorkTimeApp.ui.motion?.stop(element);
        const frames =
          element === content
            ? [shifted, resting]
            : [{ opacity: 0 }, { opacity: 1 }];
        return animationCompat.animate(
          element,
          entering ? frames : frames.toReversed(),
          {
            duration: entering ? 220 : 140,
            easing: entering
              ? getComputedStyle(element)
                  .getPropertyValue("--motion-ease")
                  .trim() || "cubic-bezier(0.22, 1, 0.36, 1)"
              : "ease-in",
            fill: "both",
          },
        );
      });
      return Promise.all(
        transition.animations.map((animation) => animation.finished),
      );
    };
    try {
      if (reducedMotion.matches || document.hidden) {
        commitAnalysisTransition(transition);
        return;
      }
      await play(false);
      if (analysisTransition !== transition) return;
      commitAnalysisTransition(transition);
      await play(true);
    } finally {
      if (analysisTransition === transition) stopAnalysisTransition();
    }
  }
  function highlightToday() {
    stopTodayAttention();
    const card = $("calendar").querySelector(
      ".day[data-date=" + JSON.stringify(model.today) + "]",
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

  function stopMonthTransition() {
    for (const animation of monthAnimations) animation.cancel();
    monthAnimations = [];
  }

  function animateMonth(direction) {
    stopMonthTransition();
    if (model.analysisMode) return;
    if (!direction || reducedMotion.matches || document.hidden) return;
    const element = $(model.analysisMode ? "analysisPage" : "calendar"),
      offset = direction * 18;
    WorkTimeApp.ui.motion?.stop(element);
    // Update the month immediately; only its entrance moves, so rapid navigation
    // always shows the latest requested month without queuing stale renders.
    monthAnimations = [
      animationCompat.animate(
        element,
        [
          {
            opacity: 0.3,
            transform: `translateX(${offset}px)`,
            clipPath: offset > 0 ? "inset(0 18px 0 0)" : "inset(0 0 0 18px)",
          },
          { opacity: 1, transform: "none", clipPath: "inset(0)" },
        ],
        {
          duration: 260,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
        },
      ),
    ];
  }

  function navigateMonth(v) {
    stopAnalysisTransition();
    if (resettingBatch || model.batchMode) return;
    stopTodayAttention();
    model.yearMode = false;
    if (!/^\d{4}-\d{2}$/.test(v) || !C.validDate(v + "-01")) return;
    const direction = v === model.month ? 0 : v > model.month ? 1 : -1;
    model.month = v;
    model.selected =
      model.month === model.today.slice(0, 7)
        ? model.today
        : model.month + "-01";
    model.batchDays.clear();
    model.batchAnchor = null;
    actions.render();
    animateMonth(direction);
    if ($("settingsDialog").open) actions.refreshSettings();
  }
  function prepareBatchEditor() {
    const schedule = C.scheduleForDate(model.state, model.selected);
    model.batchDraft = { reset: "none" };
    model.batchPreview = null;
    $("batchStart").value = "";
    $("batchEnd").value = "";
    $("batchStart").placeholder = schedule.workStart;
    $("batchEnd").placeholder = schedule.workEnd;
    $("batchNext").checked = false;
    $("batchCalcStart").value = schedule.workStart;
    $("batchCalcOvertime").value = "";
    $("batchError").textContent = "";
    $("batchCalcResult").textContent = "";
    updateBatchNextToggle();
    actions.renderBatchTimeTemplates();
    refreshBatchPreview();
  }
  function refreshBatchPreview() {
    if (!model.batchMode || model.batchSaving) return;
    const record = {
      start: $("batchStart").value,
      end: $("batchEnd").value,
      nextDay: $("batchNext").checked,
      effectiveMinutes: null,
    };
    const reset = model.batchDraft?.reset || "none";
    const empty = !record.start && !record.end;
    const complete = C.complete(record);
    const valid = complete || (reset !== "none" && empty);
    const dates = [...model.batchDays].filter(
      (date) =>
        date.slice(0, 7) === model.month &&
        C.canBatchEditDate(model.state, date),
    );
    model.batchDraft = {
      reset,
      month: model.month,
      dates,
      record: complete ? record : null,
      valid,
      canConfirm: valid && (reset === "all" || dates.length > 0),
    };
    model.batchPreview = {
      base: model.state,
      state: WorkTimeApp.domain.batch.applyBatchChanges(
        model.state,
        model.batchDraft,
      ),
    };
    $("batchStart").required = $("batchEnd").required =
      reset === "none" || !empty;
    actions.renderStats();
    actions.renderCalendar();
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
      refreshBatchPreview();
    } catch (error) {
      result.textContent = WorkTimeApp.i18n.message(error.message);
    }
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    for (const type of ["click", "keydown"])
      events.listen(
        document,
        type,
        (event) => {
          if (!model.batchSaving) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        true,
      );
    for (const id of ["batchStart", "batchEnd"])
      for (const type of ["input", "change"])
        events.listen($(id), type, () => {
          $("batchError").textContent = "";
          refreshBatchPreview();
        });
    unlistenMotion = animationCompat.listen(reducedMotion, () => {
      stopTodayAttention();
      if (reducedMotion.matches) stopAnalysisTransition();
    });
    events.listen(document, "visibilitychange", () => {
      if (document.hidden) {
        stopTodayAttention();
        stopAnalysisTransition();
      }
    });
    events.listen($("calendar"), "click", stopTodayAttention, true);
    events.handler($("calendar"), "onclick", async (e) => {
      if (resettingBatch) return;
      const source = e.target.closest("[data-source-date]");
      if (source) {
        if (model.batchMode) return;
        const date = source.dataset.sourceDate;
        const operation = application.toggleSourcePriority(date);
        actions.renderStats();
        actions.renderCalendar(true);
        if (model.selected === date) actions.renderEditor();
        const saved = (await operation).persisted;
        if (!bound) return;
        // Saving may finish after navigation or typing. Refresh saved status
        // without replacing another date's editor or a newly entered draft.
        actions.renderStats();
        actions.renderCalendar(true);
        if (!saved)
          actions.toast(WorkTimeApp.i18n.t("copy.69bd4f5650"), "error");
        return;
      }
      const b = e.target.closest(".day[data-date]");
      if (!b) return;
      const k = b.dataset.date;
      if (model.batchMode) {
        if (
          k.slice(0, 7) !== model.month ||
          !C.canBatchEditDate(model.state, k)
        )
          return;
        if (e.shiftKey && model.batchAnchor) {
          const [first, last] = [model.batchAnchor, k].sort();
          for (const card of $("calendar").querySelectorAll(
            ".day[data-date]",
          )) {
            const date = card.dataset.date;
            if (
              date >= first &&
              date <= last &&
              date.slice(0, 7) === model.month &&
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
        refreshBatchPreview();
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
      stopAnalysisTransition();
      if (resettingBatch || model.batchMode || model.analysisMode) return;
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
      if (!button || model.batchMode) return;
      model.yearMode = false;
      model.month = button.dataset.yearDate.slice(0, 7);
      model.selected = button.dataset.yearDate;
      actions.render();
      if ($("settingsDialog").open) actions.refreshSettings();
      $("calendar")
        .querySelector(
          "[data-date=" + JSON.stringify(model.selected) + "] .day-select",
        )
        ?.focus();
    });
    events.handler($("prevMonth"), "onclick", () => {
      stopAnalysisTransition();
      if (model.batchMode) return;
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
      stopAnalysisTransition();
      if (model.batchMode) return;
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
      if (model.batchMode) return;
      model.today = clock.today();
      navigateMonth(model.today.slice(0, 7));
      if (!model.analysisMode) highlightToday();
    });
    events.handler($("analysisToggle"), "onclick", toggleAnalysis);
    events.listen($("analysisManual"), "change", (event) => {
      model.analysisIncludeManual = event.target.checked;
      actions.renderCalendar(true);
    });
    events.handler($("batchToggle"), "onclick", () => {
      stopAnalysisTransition();
      if (resettingBatch || model.analysisMode) return;
      stopTodayAttention();
      if ($("settingsDialog").open) actions.closeSettings();
      if (model.batchMode) {
        actions.leaveBatch();
        return;
      }
      model.batchMode = true;
      model.batchDays.clear();
      model.batchAnchor = null;
      if (model.batchMode) prepareBatchEditor();
      actions.renderCalendar();
    });
    events.handler($("batchCancel"), "onclick", () => {
      if (resettingBatch) return;
      stopTodayAttention();
      actions.leaveBatch();
      $("batchToggle").focus();
    });
    events.handler($("batchReset"), "onclick", () => {
      if (model.batchSaving || !model.batchMode) return;
      model.batchDraft = { reset: model.batchDays.size ? "selected" : "all" };
      $("batchStart").value = "";
      $("batchEnd").value = "";
      $("batchNext").checked = false;
      $("batchCalcOvertime").value = "";
      $("batchError").textContent = "";
      $("batchCalcResult").textContent = "";
      updateBatchNextToggle();
      actions.renderBatchTimeTemplates();
      refreshBatchPreview();
    });
    events.handler($("batchNextToggle"), "onclick", () => {
      $("batchNext").checked = !$("batchNext").checked;
      updateBatchNextToggle();
      actions.renderBatchTimeTemplates();
      refreshBatchPreview();
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
      if (model.batchSaving || !model.batchMode) return;
      refreshBatchPreview();
      const draft = model.batchDraft;
      if (!draft.canConfirm) {
        $("batchError").textContent = WorkTimeApp.i18n.t(
          draft.valid ? "copy.03ee2fc8fc" : "copy.f950d3ddc0",
        );
        return;
      }
      const count = draft.dates.length;
      model.batchSaving = resettingBatch = true;
      $("batchForm").setAttribute("aria-busy", "true");
      $("batchForm").inert = true;
      $("batchError").textContent = "";
      actions.renderCalendar();
      try {
        const result = await application.confirmBatch(draft);
        if (!result.persisted) throw result.error || Error("Save failed");
        model.batchSaving = resettingBatch = false;
        actions.leaveBatch();
        actions.render();
        actions.saveFeedback(
          true,
          draft.reset !== "none"
            ? WorkTimeApp.i18n.t("batch.saved")
            : WorkTimeApp.i18n.t("copy.f54a93c893") +
                count +
                WorkTimeApp.i18n.t("copy.a68e14c5a6"),
        );
        $("batchToggle").focus();
      } catch {
        $("batchError").textContent = WorkTimeApp.i18n.t("batch.saveFailed");
        actions.toast(WorkTimeApp.i18n.t("copy.77b0044d4f"), "error");
      } finally {
        model.batchSaving = resettingBatch = false;
        $("batchForm").removeAttribute("aria-busy");
        $("batchForm").inert = false;
        if (model.batchMode) refreshBatchPreview();
        else actions.render();
      }
    });
  }

  function dispose() {
    stopAnalysisTransition(false);
    stopTodayAttention();
    unlistenMotion?.();
    unlistenMotion = null;
    events.dispose();
    bound = false;
  }
  const hasDraft = () => model.batchMode;
  return {
    bind,
    dispose,
    updateBatchNextToggle,
    refreshBatchPreview,
    hasDraft,
  };
};
