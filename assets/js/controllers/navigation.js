"use strict";
/** navigation controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createNavigationController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const { core: C, model, actions, element: $, clock, application } = options;
  const animationCompat = WorkTimeApp.ui.animationCompat;
  const calendarMotion = WorkTimeApp.ui.motion.calendar;
  const reducedMotion = animationCompat.preference();
  let todayAttention = null,
    todayEffects = [],
    todayGlows = [],
    todayGlowFrame = null,
    pageTransition = null,
    monthAnimations = [],
    monthTransition = null,
    unlistenMotion,
    resettingBatch = false;

  function stopTodayAttention() {
    todayAttention?.cancel();
    todayAttention = null;
    for (const animation of todayEffects) animation.cancel();
    todayEffects = [];
    if (todayGlowFrame !== null) cancelAnimationFrame(todayGlowFrame);
    todayGlowFrame = null;
    for (const glow of todayGlows) glow.remove();
    todayGlows = [];
  }

  function commitPageTransition(transition) {
    if (transition.committed) return;
    transition.committed = true;
    const wasYearMode = model.yearMode;
    transition.update();
    actions.render();
    if (transition.sidebarTransition) actions.closeImport();
    if (wasYearMode !== model.yearMode && $("settingsPane").hidden) {
      const content = document.querySelector(".editor > .editor-content");
      WorkTimeApp.ui.motion?.stop(content);
      WorkTimeApp.ui.motion?.play(
        content,
        model.yearMode ? "motion-sidebar-forward" : "motion-sidebar-back",
      );
    }
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
    sidebarTransition = false,
  }) {
    if (resettingBatch || model.batchMode || pageTransition) return;
    if (!sidebarTransition && !model.yearMode) actions.closeImport();
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
      sidebarTransition: sidebarTransition || model.yearMode,
      summaryTransition:
        (sidebarTransition || model.yearMode) &&
        document
          .querySelector(".summary-sidebar")
          .classList.contains("is-oa-open"),
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
          ...document.querySelectorAll(".calendar-footer > :not(.site-meta)"),
          ...(transition.summaryTransition
            ? [
                ...document.querySelectorAll(
                  ".summary-sidebar > :is(.cards, .target-panel, .sidebar-oa-workspace)",
                ),
              ].filter((element) => element.getClientRects().length)
            : []),
          ...(transition.sidebarTransition
            ? []
            : [
                ...document.querySelectorAll(
                  "#dayForm, #analysisSidebar > .analysis-sidebar-section, #agendaDayDetails, #agendaEditor .agenda-editor-body",
                ),
              ].filter(
                (element) =>
                  element.getClientRects().length &&
                  getComputedStyle(element).display !== "none",
              )),
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
  let analysisStyleRequest = 0,
    pendingAnalysis = null;
  async function transitionAnalysis(
    target,
    beforeRender = null,
    afterRender = null,
    { focusAttendance = false } = {},
  ) {
    const request = ++analysisStyleRequest;
    pendingAnalysis = target;
    if (target) {
      try {
        await WorkTimeApp.services.assets.style("assets/css/analysis.css");
      } catch (error) {
        if (request === analysisStyleRequest && bound) {
          pendingAnalysis = null;
          window.alert(WorkTimeApp.i18n.message(error.message));
        }
        return;
      }
    }
    if (request !== analysisStyleRequest || !bound) return;
    pendingAnalysis = null;
    return transitionPage({
      direction: target ? 1 : -1,
      update() {
        if (model.yearMode) {
          model.month = model.returnMonth;
          model.yearMode = false;
        }
        model.analysisMode = target;
        if (!target) {
          if (focusAttendance)
            model.selected = model.calendarSelected =
              WorkTimeApp.domain.calendar.attendanceFocusDate(
                model.month,
                clock.today(),
                model.state.days,
              );
          else model.calendarSelected = null;
        }
        beforeRender?.();
      },
      afterRender,
    });
  }
  function toggleAnalysis() {
    const target = !(pendingAnalysis ?? model.analysisMode);
    return transitionAnalysis(target, null, null, {
      focusAttendance: !target,
    });
  }
  function highlightToday() {
    stopTodayAttention();
    const card = $("calendar").querySelector(
      ".day[data-date=" + JSON.stringify(model.today) + "]",
    );
    if (!card || document.hidden) return;
    const cards = [card];
    const agenda = $("calendar").closest(".agenda-mode") !== null;
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
    const followers = [];
    const attentions = cards.map((card) => {
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
            {
              offset: 0,
              backgroundColor: background,
              boxShadow: ring(0, 0, 0),
            },
            {
              offset: 0.3,
              backgroundColor: bright,
              boxShadow: ring(3, 10, 32),
            },
            {
              offset: 1,
              backgroundColor: background,
              boxShadow: ring(8, 16, 0),
            },
          ];
      if (agenda) {
        // Paint outside the clipped calendar/navigation page and above event lanes.
        // This transparent layer follows the live card without intercepting events.
        const host = $("panelContent"),
          glow = document.createElement("span");
        glow.className = "calendar-today-glow";
        glow.setAttribute("aria-hidden", "true");
        glow.style.borderRadius = style.borderRadius;
        host.append(glow);
        todayGlows.push(glow);
        followers.push({ card, glow, host });
        todayEffects.push(
          animationCompat.animate(
            glow,
            frames.map(({ offset, boxShadow }) => ({ offset, boxShadow })),
            timing,
          ),
        );
      }
      return animationCompat.animate(
        card,
        agenda
          ? frames.map((frame) => ({ ...frame, boxShadow: style.boxShadow }))
          : frames,
        timing,
      );
    });
    const attention = attentions[0];
    todayEffects.push(...attentions.slice(1));
    todayAttention = attention;
    // Both cards share one tracking frame and one cleanup lifetime.
    const follow = () => {
      if (todayAttention !== attention) return;
      for (const { card, glow, host } of followers) {
        if (!card.isConnected) return stopTodayAttention();
        const bounds = card.getBoundingClientRect(),
          origin = host.getBoundingClientRect();
        Object.assign(glow.style, {
          left: bounds.left - origin.left + "px",
          top: bounds.top - origin.top + "px",
          width: bounds.width + "px",
          height: bounds.height + "px",
        });
      }
      if (followers.length) todayGlowFrame = requestAnimationFrame(follow);
    };
    follow();
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
    if (!$("settingsPane").hidden) actions.refreshSettings();
  }
  const batchText = (key, values = {}) =>
    WorkTimeApp.i18n.t("batch." + key, values);
  function prepareBatchEditor() {
    const schedule = C.scheduleForDate(model.state, model.selected);
    model.batchInput = {
      mode: "direct",
      direct: { start: "", end: "", nextDay: false },
      overtime: { start: "", hours: "" },
    };
    model.batchDraft = { reset: "none" };
    model.batchPreview = null;
    $("batchStart").value =
      $("batchEnd").value =
      $("batchCalcOvertime").value =
        "";
    $("batchStart").placeholder = schedule.workStart;
    $("batchEnd").placeholder = schedule.workEnd;
    $("batchNext").checked = false;
    $("batchError").textContent = "";
    updateBatchMode();
    actions.renderBatchTimeTemplates();
    refreshBatchPreview();
  }
  function updateBatchMode() {
    const overtime = model.batchInput.mode === "overtime";
    $("batchInputSection").dataset.inputMode = overtime ? "overtime" : "direct";
    $("batchModeToggle").querySelector(".button-label").textContent = batchText(
      overtime ? "direct" : "overtime",
    );
    $("batchModeToggle").title = batchText(
      overtime ? "switchDirect" : "switchOvertime",
    );
    $("batchModeToggle").setAttribute("aria-label", $("batchModeToggle").title);
    $("batchEndField").hidden = overtime;
    $("batchNextField").inert = overtime;
    document.querySelector(".batch-template-area").inert = overtime;
    $("batchOvertimeFields").hidden = !overtime;
    $("batchEnd").disabled = overtime;
    $("batchCalcOvertime").disabled = !overtime;
    $("batchCalcOvertime").required = overtime;
    updateBatchNextToggle();
  }
  function rememberBatchInput() {
    const input = model.batchInput;
    if (input.mode === "direct")
      input.direct = {
        start: $("batchStart").value,
        end: $("batchEnd").value,
        nextDay: $("batchNext").checked,
      };
    else
      input.overtime = {
        start: $("batchStart").value,
        hours: $("batchCalcOvertime").value,
      };
  }
  function switchBatchMode(mode) {
    if (model.batchSaving || model.batchInput.mode === mode) return;
    rememberBatchInput();
    const input = model.batchInput;
    input.mode = mode;
    if (mode === "overtime") {
      if (!input.overtime.start)
        input.overtime.start =
          input.direct.start ||
          C.scheduleForDate(model.state, model.selected).workStart;
      $("batchStart").value = input.overtime.start;
      $("batchCalcOvertime").value = input.overtime.hours;
    } else {
      $("batchStart").value = input.direct.start;
      $("batchEnd").value = input.direct.end;
      $("batchNext").checked = input.direct.nextDay;
    }
    $("batchError").textContent = "";
    updateBatchMode();
    actions.renderBatchTimeTemplates();
    refreshBatchPreview();
  }
  function refreshBatchPreview() {
    if (!model.batchMode || model.batchSaving) return;
    updateBatchMode();
    rememberBatchInput();
    const dates = [...model.batchDays].filter(
      (date) =>
        date.slice(0, 7) === model.month &&
        C.canBatchEditDate(model.state, date),
    );
    let record = {
      start: $("batchStart").value,
      end: $("batchEnd").value,
      nextDay: $("batchNext").checked,
      effectiveMinutes: null,
    };
    let issue = "";
    const overtime = model.batchInput.mode === "overtime";
    $("batchSchedule").textContent = WorkTimeApp.ui.scheduleDescription(
      C.scheduleForDate(model.state, model.selected),
    );
    $("batchCalcResult").textContent = "";
    if (overtime) {
      record = null;
      const schedules = dates.map((date) =>
        C.scheduleForDate(model.state, date),
      );
      const hours = $("batchCalcOvertime").value;
      if (!model.state.settings.configured)
        issue = WorkTimeApp.i18n.t("copy.99d09d1bd5");
      else if (C.timeMin($("batchStart").value) === null)
        issue = batchText("needStart");
      else if (
        hours === "" ||
        !$("batchCalcOvertime").validity.valid ||
        !Number.isFinite(Number(hours)) ||
        Number(hours) < 0
      )
        issue = batchText("needHours");
      else if (
        schedules.some(
          (item) =>
            C.scheduleSignature(item) !== C.scheduleSignature(schedules[0]),
        )
      )
        issue = batchText("mixedSchedules");
      else if (schedules.length) {
        const minutes =
          schedules[0].standardMinutes + Math.round(Number(hours) * 60);
        const match =
          minutes < 1440
            ? C.endForDuration($("batchStart").value, minutes, schedules[0])
            : null;
        if (!match) issue = WorkTimeApp.i18n.t("copy.0e1112168e");
        else {
          record = {
            start: $("batchStart").value,
            end: match.end,
            nextDay: match.nextDay,
            effectiveMinutes: null,
          };
          $("batchCalcResult").textContent = batchText("calculated", {
            time:
              match.end + (match.nextDay ? " · " + batchText("nextDay") : ""),
          });
        }
      }
    } else if (C.timeMin(record.start) === null) issue = batchText("needStart");
    else if (C.timeMin(record.end) === null) issue = batchText("needEnd");
    else if (!C.complete(record)) issue = batchText("invalidRange");
    const valid = !!record && !issue && C.complete(record);
    model.batchDraft = {
      reset: "none",
      month: model.month,
      dates,
      record: valid ? record : null,
      valid,
      canConfirm: valid && dates.length > 0,
    };
    model.batchPreview = {
      base: model.state,
      state: WorkTimeApp.domain.batch.applyBatchChanges(
        model.state,
        model.batchDraft,
      ),
    };
    const status = $("batchPreviewStatus");
    const line = (tag, text, className = "") => {
      const element = document.createElement(tag);
      element.className = className;
      element.textContent = text;
      return element;
    };
    status.replaceChildren();
    status.removeAttribute("title");
    if (!dates.length) status.append(line("p", batchText("chooseDates")));
    else if (!valid) status.append(line("p", issue));
    else {
      const counts = { added: 0, completed: 0, replaced: 0 };
      for (const date of dates) {
        const day = model.state.days[date];
        const previous = C.effectiveRecord(day, true);
        if (C.complete(previous)) counts.replaced++;
        else if (
          (previous && (previous.start || previous.end)) ||
          day?.draft?.start ||
          day?.draft?.end
        )
          counts.completed++;
        else counts.added++;
      }
      status.append(
        line(
          "strong",
          record.start +
            " – " +
            record.end +
            (record.nextDay ? " · " + batchText("nextDay") : ""),
          "batch-preview-time",
        ),
      );
      const summary = line("p", "", "batch-preview-counts");
      for (const key of ["added", "completed", "replaced"]) {
        const item = line("span", "");
        item.append(line("span", batchText("count" + key)));
        item.append(line("b", String(counts[key])));
        summary.append(item);
      }
      status.append(summary);
      status.title = batchText("previewNote");
    }
    actions.renderStats();
    actions.renderCalendar();
  }
  function updateBatchNextToggle() {
    $("batchNextToggle").setAttribute(
      "aria-pressed",
      String($("batchNext").checked),
    );
  }
  async function persistBatch(draft, message, keepEditing = false) {
    model.batchSaving = resettingBatch = true;
    $("batchForm").setAttribute("aria-busy", "true");
    $("batchForm").inert = true;
    $("batchError").textContent = "";
    actions.renderCalendar();
    try {
      const result = await application.confirmBatch(draft);
      if (!result.persisted) throw result.error || Error("Save failed");
      model.batchSaving = resettingBatch = false;
      if (!keepEditing) actions.leaveBatch();
      actions.render();
      actions.saveFeedback(true, message);
      if (!keepEditing) $("batchToggle").focus();
    } catch {
      $("batchError").textContent = batchText("saveFailed");
      actions.toast(WorkTimeApp.i18n.t("copy.77b0044d4f"), "error");
    } finally {
      model.batchSaving = resettingBatch = false;
      $("batchForm").removeAttribute("aria-busy");
      $("batchForm").inert = false;
      if (model.batchMode) {
        refreshBatchPreview();
        if (keepEditing) $("batchReset").focus();
      }
    }
  }
  function handleBatchClear() {
    if (!model.batchMode || model.batchSaving || !model.batchDays.size) return;
    const draft = {
      reset: "selected",
      month: model.month,
      dates: [...model.batchDays],
      record: null,
    };
    const candidate = WorkTimeApp.domain.batch.applyBatchChanges(
      model.state,
      draft,
    );
    if (
      !draft.dates.some(
        (date) => candidate.days[date] !== model.state.days[date],
      )
    ) {
      actions.toast(batchText("nothingToClear"));
      return;
    }
    return persistBatch(draft, batchText("saved"), true);
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
    for (const id of ["batchStart", "batchEnd", "batchCalcOvertime"])
      for (const type of ["input", "change"])
        events.listen($(id), type, () => {
          $("batchError").textContent = "";
          refreshBatchPreview();
        });
    events.listen(
      $("batchCalcOvertime"),
      "wheel",
      (event) => {
        const input = $("batchCalcOvertime");
        if (
          model.batchSaving ||
          model.batchInput?.mode !== "overtime" ||
          document.activeElement !== input ||
          !event.deltaY
        )
          return;
        event.preventDefault();
        if (event.deltaY < 0) input.stepUp();
        else input.stepDown();
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { passive: false },
    );
    unlistenMotion = animationCompat.listen(reducedMotion, () => {
      stopTodayAttention();
      if (reducedMotion.matches) {
        stopPageTransition();
      }
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
        if (!$("settingsPane").hidden) actions.refreshSettings();
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
        sidebarTransition: true,
        update() {
          if (model.yearMode) {
            model.yearMode = false;
            model.month = model.returnMonth;
          } else {
            model.yearMode = true;
            model.viewYear = Number(model.month.slice(0, 4));
            model.yearViewMode = "heatmap";
            model.returnMonth = model.month;
            model.batchMode = false;
            model.batchDays.clear();
            model.batchAnchor = null;
          }
          // Reveal only the destination sidebar when the page commits.
          actions.closeSettings({ animate: false });
        },
      });
    });
    events.listen($("calendar"), "click", (e) => {
      const monthButton = e.target.closest("[data-year-month-switch]");
      if (monthButton) {
        if (resettingBatch || model.batchMode || !model.yearMode) return;
        const month = monthButton.dataset.yearMonthSwitch;
        if (
          !/^\d{4}-\d{2}$/.test(month) ||
          Number(month.slice(0, 4)) !== model.viewYear ||
          !C.validDate(month + "-01") ||
          month === model.month
        )
          return;
        model.month = month;
        model.returnMonth = month;
        // Refresh the whole workspace so the left month label, summary cards,
        // target figures and year calendar all follow the selected month.
        actions.render();
        return;
      }
      const button = e.target.closest("[data-year-date]");
      if (button) {
        if (model.batchMode) return;
        const month = button.dataset.yearDate.slice(0, 7);
        return transitionPage({
          direction: -1,
          update() {
            model.yearMode = false;
            model.month = month;
            model.selected = model.calendarSelected = button.dataset.yearDate;
          },
          afterRender() {
            if (!$("settingsPane").hidden) actions.refreshSettings();
          },
          onComplete() {
            $("calendar")
              .querySelector(
                "[data-date=" +
                  JSON.stringify(model.selected) +
                  "] .day-select",
              )
              ?.focus({ preventScroll: true });
          },
        });
      }
      const monthSection = e.target.closest(".year-month");
      if (!monthSection || resettingBatch || model.batchMode || !model.yearMode)
        return;
      const month = monthSection.dataset.yearMonth;
      if (
        !/^\d{4}-\d{2}$/.test(month || "") ||
        Number(month.slice(0, 4)) !== model.viewYear ||
        !C.validDate(month + "-01") ||
        month === model.month
      )
        return;
      model.month = month;
      model.returnMonth = month;
      actions.render();
    });
    events.handler($("prevMonth"), "onclick", () => {
      stopPageTransition();
      if (model.batchMode) return;
      stopTodayAttention();
      if (model.yearMode) {
        if (model.viewYear > 1900)
          animateMonth(-1, () => {
            const monthNumber = model.month.slice(5);
            model.viewYear--;
            model.month = model.viewYear + "-" + monthNumber;
            model.returnMonth = model.month;
            retainCalendarSelection();
            actions.renderStats();
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
            const monthNumber = model.month.slice(5);
            model.viewYear++;
            model.month = model.viewYear + "-" + monthNumber;
            model.returnMonth = model.month;
            retainCalendarSelection();
            actions.renderStats();
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
            if (!$("settingsPane").hidden) actions.refreshSettings();
          },
          onComplete: highlightToday,
        });
      model.today = clock.today();
      model.selected = model.calendarSelected = model.today;
      navigateMonth(model.today.slice(0, 7), true);
      if (!model.analysisMode) highlightToday();
    });
    events.handler($("analysisToggle"), "onclick", toggleAnalysis);
    events.handler($("batchToggle"), "onclick", () => {
      stopPageTransition();
      if (resettingBatch || model.analysisMode) return;
      stopTodayAttention();
      if (!$("settingsPane").hidden) actions.closeSettings();
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
      const end = new Date(
        Number(model.month.slice(0, 4)),
        Number(model.month.slice(5)),
        0,
      ).getDate();
      for (let day = 1; day <= end; day++) {
        const date = model.month + "-" + String(day).padStart(2, "0");
        if (
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
    events.handler($("batchClearSelection"), "onclick", () => {
      if (model.batchSaving) return;
      model.batchDays.clear();
      model.batchAnchor = null;
      refreshBatchPreview();
    });
    events.handler($("batchModeToggle"), "onclick", () =>
      switchBatchMode(
        model.batchInput.mode === "direct" ? "overtime" : "direct",
      ),
    );
    events.handler($("batchReset"), "onclick", handleBatchClear);
    events.handler($("batchNextToggle"), "onclick", () => {
      $("batchNext").checked = !$("batchNext").checked;
      updateBatchNextToggle();
      actions.renderBatchTimeTemplates();
      refreshBatchPreview();
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
      await persistBatch(
        draft,
        WorkTimeApp.i18n.t("copy.f54a93c893") +
          draft.dates.length +
          WorkTimeApp.i18n.t("copy.a68e14c5a6"),
      );
    });
  }

  function dispose() {
    analysisStyleRequest++;
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
      analysisStyleRequest++;
      pendingAnalysis = null;
      stopPageTransition();
      stopMonthTransition();
      stopTodayAttention();
    },
    hasDraft,
  };
};
