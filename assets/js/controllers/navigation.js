"use strict";
/** navigation controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createNavigationController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const { core: C, model, actions, element: $, clock, application } = options;
  const animationCompat = WorkTimeApp.ui.animationCompat;
  const calendarMotion = WorkTimeApp.ui.motion.calendar;
  const reducedMotion = animationCompat.preference();
  let todayAttention = null,
    todayGlow = null,
    todayGlowAnimation = null,
    todayGlowFrame = null,
    pageTransition = null,
    monthAnimations = [],
    monthTransition = null,
    unlistenMotion,
    resettingBatch = false;

  function stopTodayAttention() {
    todayAttention?.cancel();
    todayAttention = null;
    todayGlowAnimation?.cancel();
    todayGlowAnimation = null;
    if (todayGlowFrame !== null) cancelAnimationFrame(todayGlowFrame);
    todayGlowFrame = null;
    todayGlow?.remove();
    todayGlow = null;
  }

  function commitPageTransition(transition) {
    if (transition.committed) return;
    transition.committed = true;
    transition.update();
    actions.render();
    transition.afterRender?.();
    // Page transitions own the entire content surface; suppress nested reveals.
    for (const element of $("panelContent").querySelectorAll("*"))
      WorkTimeApp.ui.motion?.stop(element);
  }

  function stopPageTransition(settle = true) {
    stopMonthTransition();
    const transition = pageTransition;
    if (!transition) return;
    pageTransition = null;
    for (const animation of transition.animations) animation.cancel();
    try {
      if (settle) commitPageTransition(transition);
    } finally {
      for (const [element, inert] of transition.elements) element.inert = inert;
      if (settle) transition.onComplete?.();
    }
  }

  async function transitionPage({
    direction,
    update,
    afterRender,
    onComplete,
  }) {
    if (resettingBatch || model.batchMode || pageTransition) return;
    actions.closeImport();
    stopMonthTransition();
    stopTodayAttention();
    const transition = {
      direction,
      update,
      afterRender,
      onComplete,
      committed: false,
      animations: [],
      elements: new Map(),
    };
    pageTransition = transition;
    const play = (entering) => {
      const distance = -24 * transition.direction,
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
          ...[
            ...document.querySelectorAll(
              "#dayForm, #analysisSidebar > .analysis-sidebar-section, #agendaDayDetails, #agendaEditor .agenda-editor-body",
            ),
          ].filter(
            (element) =>
              element.getClientRects().length &&
              getComputedStyle(element).display !== "none",
          ),
        ];
      transition.animations = elements.map((element) => {
        if (!transition.elements.has(element))
          transition.elements.set(element, element.inert);
        element.inert = true;
        WorkTimeApp.ui.motion?.stop(element);
        const sidebar = element.closest(".editor");
        const frames = sidebar
          ? [{ opacity: 0, transform: `translateY(${offset / 3}px)` }, resting]
          : element === content
            ? [shifted, resting]
            : [{ opacity: 0 }, { opacity: 1 }];
        return animationCompat.animate(
          element,
          entering ? frames : frames.toReversed(),
          {
            duration: entering
              ? calendarMotion.analysisEnterDuration
              : calendarMotion.analysisLeaveDuration,
            easing: entering ? calendarMotion.easing : "ease-in",
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
        commitPageTransition(transition);
        return;
      }
      await play(false);
      if (pageTransition !== transition) return;
      commitPageTransition(transition);
      await play(true);
    } finally {
      if (pageTransition === transition) stopPageTransition();
    }
  }
  function transitionAnalysis(target, beforeRender = null, afterRender = null) {
    return transitionPage({
      direction: target ? 1 : -1,
      update() {
        if (model.yearMode) {
          model.month = model.returnMonth;
          model.yearMode = false;
        }
        model.analysisMode = target;
        beforeRender?.();
      },
      afterRender,
    });
  }
  function toggleAnalysis() {
    return transitionAnalysis(!model.analysisMode);
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
    const timing = {
      duration: 800,
      easing: "ease-out",
      // Let the page arrive first; overlap only its final 120ms with the glow.
      delay: Math.max(
        0,
        ...(monthTransition?.element.getAnimations() || []).map(
          (animation) =>
            animation.effect.getComputedTiming().endTime -
            Number(animation.currentTime || 0) -
            120,
        ),
      ),
    };
    const agenda = $("calendar").closest(".agenda-mode") !== null;
    if (agenda) {
      // Paint outside the clipped calendar/navigation page and above event lanes.
      // This transparent layer follows the live card without intercepting events.
      const host = $("panelContent"),
        glow = document.createElement("span");
      glow.className = "calendar-today-glow";
      glow.setAttribute("aria-hidden", "true");
      glow.style.borderRadius = style.borderRadius;
      host.append(glow);
      todayGlow = glow;
      const follow = () => {
        if (todayGlow !== glow) return;
        if (!card.isConnected) return stopTodayAttention();
        const bounds = card.getBoundingClientRect(),
          origin = host.getBoundingClientRect();
        Object.assign(glow.style, {
          left: bounds.left - origin.left + "px",
          top: bounds.top - origin.top + "px",
          width: bounds.width + "px",
          height: bounds.height + "px",
        });
        todayGlowFrame = requestAnimationFrame(follow);
      };
      follow();
      todayGlowAnimation = animationCompat.animate(
        glow,
        frames.map(({ offset, boxShadow }) => ({ offset, boxShadow })),
        timing,
      );
    }
    const attention = animationCompat.animate(
      card,
      agenda
        ? frames.map((frame) => ({ ...frame, boxShadow: style.boxShadow }))
        : frames,
      timing,
    );
    todayAttention = attention;
    attention.finished.then(() => {
      if (todayAttention === attention) stopTodayAttention();
    });
  }

  function stopMonthTransition() {
    const transition = monthTransition;
    monthTransition = null;
    for (const animation of monthAnimations) animation.cancel();
    monthAnimations = [];
    if (!transition) return;
    const { element, viewport, style, suffixes } = transition;
    for (const suffix of suffixes) {
      suffix.parentElement?.classList.remove("calendar-month-suffix-host");
      suffix.remove();
    }
    viewport.replaceWith(element);
    if (style === null) element.removeAttribute("style");
    else element.setAttribute("style", style);
    transition.onComplete?.();
  }

  function animateMonth(
    direction,
    update = () => {},
    onComplete = () => {},
    { axis = "y" } = {},
  ) {
    actions.closeImport();
    stopMonthTransition();
    const element = $("calendar");
    const enabled =
      direction &&
      !model.analysisMode &&
      !reducedMotion.matches &&
      !document.hidden &&
      typeof element.animate === "function";
    let copy, previousBounds;
    const scrolls = [];
    const previousDays = new Map();
    const attendance = !element.closest(".agenda-mode");
    const daySelector = attendance ? ":scope > .day" : ".day[data-agenda-week]";
    function numberPosition(card, bounds) {
      const label =
        card.querySelector(".daynum-text") || card.querySelector(".daynum");
      if (!label?.firstChild) return null;
      const range = document.createRange();
      range.selectNodeContents(label.firstChild);
      const rect = range.getBoundingClientRect();
      return { left: rect.left - bounds.left, top: rect.top - bounds.top };
    }
    if (enabled) {
      WorkTimeApp.ui.motion?.stop(element);
      previousBounds = element.getBoundingClientRect();
      for (const card of element.querySelectorAll(daySelector)) {
        const rect = card.getBoundingClientRect();
        if (!rect.height) continue;
        previousDays.set(card.dataset.date || card.dataset.previewDate, {
          top: rect.top - previousBounds.top,
          bottom: rect.bottom - previousBounds.top,
          opacity: attendance ? getComputedStyle(card).opacity : null,
          monthSuffix: card.querySelector(".daynum small")?.textContent || "",
          number: attendance ? numberPosition(card, rect) : null,
        });
      }
      copy = element.cloneNode(true);
      if (element.scrollTop || element.scrollLeft)
        scrolls.push([copy, element.scrollTop, element.scrollLeft]);
      copy.removeAttribute("id");
      for (const node of copy.querySelectorAll("[id]"))
        node.removeAttribute("id");
      const selector =
        ".agenda-card-items, .agenda-week-lane, .timetable-scroll";
      const sources = element.querySelectorAll(selector);
      const copies = copy.querySelectorAll(selector);
      sources.forEach((source, index) => {
        const node = copies[index];
        if (source.scrollTop || source.scrollLeft)
          scrolls.push([node, source.scrollTop, source.scrollLeft]);
      });
      // Only an open agenda editor supplies ID-dependent selected-day colors.
      // Ordinary days inherit their resting class styles instead of freezing a
      // half-completed hover/selection transition into the entire outgoing page.
      if (element.querySelector(".agenda-chip.is-selected")) {
        const source = element.querySelector(".day.selected");
        const node = copy.querySelector(".day.selected");
        if (source && node) {
          const style = getComputedStyle(source);
          for (const property of ["background", "border-color", "box-shadow"])
            node.style.setProperty(property, style.getPropertyValue(property));
        }
      }
      copy.classList.add("calendar-navigation-copy");
      copy.inert = true;
      copy.setAttribute("aria-hidden", "true");
    }
    update();
    // Rendering may have triggered selection/content reveals. The whole calendar
    // is the only moving surface during date navigation.
    if (!enabled || !copy) {
      onComplete();
      return;
    }
    WorkTimeApp.ui.motion?.stop(element);
    for (const child of element.querySelectorAll("*"))
      WorkTimeApp.ui.motion?.stop(child);
    if (attendance)
      WorkTimeApp.ui.alignment?.refresh([
        ...element.querySelectorAll(".daytop"),
      ]);
    const bounds = element.getBoundingClientRect();
    if (!bounds.height || !previousBounds.height) {
      onComplete();
      return;
    }
    // Shared weeks are drawn once on a continuous track, both at month
    // boundaries and when a multiweek agenda advances by one week.
    const nextDays = [...element.querySelectorAll(daySelector)].filter(
      (card) => card.getBoundingClientRect().height > 0,
    );
    const sharedOffsets = nextDays.flatMap((card) => {
      const previous = previousDays.get(
        card.dataset.date || card.dataset.previewDate,
      );
      // Month grids can have different row heights (four, five or six weeks).
      // Join the top edge when moving forward and the bottom edge on return.
      const edge = attendance && direction < 0 ? "bottom" : "top";
      return previous
        ? [previous[edge] - (card.getBoundingClientRect()[edge] - bounds.top)]
        : [];
    });
    const horizontal = axis === "x";
    const translate = (value) =>
      horizontal ? `translateX(${value}px)` : `translateY(${value}px)`;
    let offset =
      direction *
      (horizontal
        ? direction > 0
          ? previousBounds.width
          : bounds.width
        : direction > 0
          ? previousBounds.height
          : bounds.height);
    const sharedOffset = sharedOffsets[0];
    const partial =
      !horizontal &&
      (attendance ||
        (element.classList.contains("agenda-week-view") &&
          previousDays.size === nextDays.length &&
          Math.abs(previousBounds.height - bounds.height) < 1)) &&
      Math.sign(sharedOffset) === direction &&
      Math.abs(sharedOffset) < Math.max(bounds.height, previousBounds.height) &&
      sharedOffsets.every((value) => Math.abs(value - sharedOffset) < 1);
    if (partial) offset = sharedOffset;
    const viewport = document.createElement("div");
    viewport.className = "calendar-navigation-viewport";
    viewport.style.height = bounds.height + "px";
    const style = element.getAttribute("style");
    element.before(viewport);
    viewport.append(element, copy);
    Object.assign(element.style, {
      height: bounds.height + "px",
      width: bounds.width + "px",
      flex: "none",
      willChange: "transform",
    });
    Object.assign(copy.style, {
      position: "absolute",
      top: "0",
      left: "0",
      margin: "0",
      width: previousBounds.width + "px",
      height: previousBounds.height + "px",
      flex: "none",
      pointerEvents: "none",
      transform: "none",
      opacity: "1",
    });
    if (partial) {
      // Keep only the departing strip of the old page. Shared rows are drawn
      // by the new page, including their cross-day agenda lanes.
      const nextDates = new Set(
        nextDays.map((card) => card.dataset.date || card.dataset.previewDate),
      );
      const leaving = [...previousDays]
        .filter(([date]) => !nextDates.has(date))
        .map(([, rect]) => rect);
      if (direction > 0)
        copy.style.clipPath = `inset(0 0 ${previousBounds.height - offset}px 0)`;
      else
        copy.style.clipPath = `inset(${Math.min(...leaving.map((rect) => rect.top))}px 0 0 0)`;
    }
    for (const [node, top, left] of scrolls) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
    const suffixes = [];
    const transition = { element, viewport, style, suffixes, onComplete };
    monthTransition = transition;
    const pageTravel =
      !element.classList.contains("agenda-week-view") ||
      (!partial &&
        (nextDays.length > 7 ||
          element.classList.contains("agenda-dual-card-view")));
    const timing = {
      duration:
        horizontal || !pageTravel
          ? calendarMotion.navigationDuration
          : calendarMotion.pageNavigationDuration,
      easing:
        horizontal || !pageTravel
          ? calendarMotion.easing
          : calendarMotion.pageNavigationEasing,
      fill: "both",
    };
    const details = [];
    if (attendance && partial) {
      for (const card of nextDays) {
        const previous = previousDays.get(
          card.dataset.date || card.dataset.previewDate,
        );
        if (!previous) continue;
        const opacity = getComputedStyle(card).opacity;
        if (previous.opacity !== opacity)
          details.push({
            element: card,
            frames: [{ opacity: previous.opacity }, { opacity }],
            options: timing,
          });
        const suffix = card.querySelector(".daynum small");
        const host = card.querySelector(".daynum");
        if (!!suffix !== !!previous.monthSuffix && previous.number) {
          const position = numberPosition(card, card.getBoundingClientRect());
          if (position) {
            const x = previous.number.left - position.left;
            const y = previous.number.top - position.top;
            if (Math.abs(x) > 0.1 || Math.abs(y) > 0.1)
              details.push({
                element: host,
                frames: [
                  { transform: `translate(${x}px, ${y}px)` },
                  { transform: "translate(0px, 0px)" },
                ],
                options: timing,
              });
          }
        }
        if (suffix && !previous.monthSuffix)
          details.push({
            element: suffix,
            frames: [{ opacity: 0 }, { opacity: 1 }],
            options: timing,
          });
        else if (!suffix && previous.monthSuffix) {
          const outgoing = document.createElement("small");
          outgoing.className = "calendar-month-suffix-outgoing";
          outgoing.textContent = previous.monthSuffix;
          outgoing.setAttribute("aria-hidden", "true");
          host.classList.add("calendar-month-suffix-host");
          host.append(outgoing);
          suffixes.push(outgoing);
          details.push({
            element: outgoing,
            frames: [{ opacity: 1 }, { opacity: 0 }],
            options: timing,
          });
        }
      }
    }
    monthAnimations = WorkTimeApp.ui.motion.animateCalendar([
      {
        element: copy,
        frames: [
          { transform: translate(0) },
          { transform: translate(-offset) },
        ],
        options: timing,
      },
      {
        element,
        frames: [{ transform: translate(offset) }, { transform: translate(0) }],
        options: timing,
      },
      ...details,
    ]);
    Promise.all(monthAnimations.map((animation) => animation.finished)).then(
      () => {
        if (monthTransition === transition) stopMonthTransition();
      },
    );
  }

  function retainCalendarSelection(dates = null, fallback = model.selected) {
    const selected =
      model.calendarSelected === undefined
        ? model.selected
        : model.calendarSelected;
    let visible = false;
    if (selected) {
      if (dates) visible = dates.includes(selected);
      else if (model.yearMode)
        visible = selected.slice(0, 4) === String(model.viewYear);
      else {
        // Include the adjacent dates actually drawn in the month grid.
        const first = C.localDate(model.month + "-01");
        const last = C.localDate(model.month + "-01");
        last.setMonth(last.getMonth() + 1, 0);
        first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
        last.setDate(last.getDate() + 6 - ((last.getDay() + 6) % 7));
        visible = selected >= C.dateKey(first) && selected <= C.dateKey(last);
      }
    }
    model.calendarSelected = visible ? selected : null;
    // Editors still need a valid working date after the highlighted card exits.
    model.selected = visible ? selected : fallback;
  }

  function navigateMonth(v, selectToday = false) {
    stopPageTransition();
    if (resettingBatch || model.batchMode) return;
    stopTodayAttention();
    model.yearMode = false;
    if (!/^\d{4}-\d{2}$/.test(v) || !C.validDate(v + "-01")) return;
    const direction = v === model.month ? 0 : v > model.month ? 1 : -1;
    animateMonth(direction, () => {
      model.month = v;
      retainCalendarSelection(
        null,
        model.month === model.today.slice(0, 7)
          ? model.today
          : model.month + "-01",
      );
      if (direction && !selectToday) model.calendarSelected = null;
      model.batchDays.clear();
      model.batchAnchor = null;
      actions.render();
    });
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
    events.listen(
      document.querySelector(".panel-head"),
      "click",
      (event) => {
        if (!pageTransition) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
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
      if (reducedMotion.matches) stopPageTransition();
    });
    events.listen(document, "visibilitychange", () => {
      if (document.hidden) {
        stopTodayAttention();
        stopPageTransition();
      }
    });
    events.listen(window, "resize", () => stopPageTransition());
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
        model.selected = model.calendarSelected = k;
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
      if (resettingBatch || model.batchMode || model.analysisMode) return;
      return transitionPage({
        direction: model.yearMode ? -1 : 1,
        update() {
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
        },
      });
    });
    events.listen($("calendar"), "click", (e) => {
      const button = e.target.closest("[data-year-date]");
      if (!button || model.batchMode) return;
      const month = button.dataset.yearDate.slice(0, 7);
      return transitionPage({
        direction: -1,
        update() {
          model.yearMode = false;
          model.month = month;
          model.selected = model.calendarSelected = button.dataset.yearDate;
        },
        afterRender() {
          if ($("settingsDialog").open) actions.refreshSettings();
        },
        onComplete() {
          $("calendar")
            .querySelector(
              "[data-date=" + JSON.stringify(model.selected) + "] .day-select",
            )
            ?.focus({ preventScroll: true });
        },
      });
    });
    events.handler($("prevMonth"), "onclick", () => {
      stopPageTransition();
      if (model.batchMode) return;
      stopTodayAttention();
      if (model.yearMode) {
        if (model.viewYear > 1900)
          animateMonth(-1, () => {
            model.viewYear--;
            retainCalendarSelection();
            actions.renderCalendar();
          });
        return;
      }
      const d = C.localDate(model.month + "-01");
      d.setMonth(d.getMonth() - 1);
      navigateMonth(C.dateKey(d).slice(0, 7));
    });
    events.handler($("nextMonth"), "onclick", () => {
      stopPageTransition();
      if (model.batchMode) return;
      stopTodayAttention();
      if (model.yearMode) {
        if (model.viewYear < 9999)
          animateMonth(1, () => {
            model.viewYear++;
            retainCalendarSelection();
            actions.renderCalendar();
          });
        return;
      }
      const d = C.localDate(model.month + "-01");
      d.setMonth(d.getMonth() + 1);
      navigateMonth(C.dateKey(d).slice(0, 7));
    });
    events.handler($("todayButton"), "onclick", () => {
      if (model.batchMode) return;
      if (model.yearMode)
        return transitionPage({
          direction: -1,
          update() {
            model.today = clock.today();
            model.selected = model.calendarSelected = model.today;
            model.month = model.today.slice(0, 7);
            model.yearMode = false;
          },
          afterRender() {
            if ($("settingsDialog").open) actions.refreshSettings();
          },
          onComplete: highlightToday,
        });
      model.today = clock.today();
      model.selected = model.calendarSelected = model.today;
      navigateMonth(model.today.slice(0, 7), true);
      if (!model.analysisMode) highlightToday();
    });
    events.handler($("analysisToggle"), "onclick", toggleAnalysis);
    events.listen($("analysisManual"), "change", (event) => {
      model.analysisIncludeManual = event.target.checked;
      actions.renderCalendar(true);
    });
    events.handler($("batchToggle"), "onclick", () => {
      stopPageTransition();
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
    events.handler($("batchAutoSelect"), "onclick", () => {
      if (resettingBatch || model.batchSaving || !model.batchMode) return;
      model.batchDays.clear();
      model.batchAnchor = null;
      for (const card of $("calendar").querySelectorAll(".day[data-date]")) {
        const date = card.dataset.date;
        if (
          date.slice(0, 7) === model.month &&
          C.canBatchEditDate(model.state, date) &&
          !C.complete(C.effectiveRecord(model.state.days[date], true))
        )
          model.batchDays.add(date);
      }
      refreshBatchPreview();
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
    stopPageTransition(false);
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
    transitionAnalysis,
    transitionPage,
    animateCalendarNavigation: animateMonth,
    retainCalendarSelection,
    highlightToday,
    finishCalendarNavigation() {
      stopPageTransition();
      stopMonthTransition();
      stopTodayAttention();
    },
    hasDraft,
  };
};
