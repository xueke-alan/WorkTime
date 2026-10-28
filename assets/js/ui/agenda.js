"use strict";
/** Agenda presentation and interactions, using the application's shared persistence owner. */
WorkTimeApp.ui.createAgenda = function ({
  model,
  application,
  actions,
  clock,
  element: $,
  escape: esc,
  document,
  window,
}) {
  const rules = WorkTimeApp.domain.agenda;
  const statuses = ["pending", "completed", "in-progress", "cancelled"];
  const statusLabel = (status) =>
    t(
      {
        pending: "statusPending",
        completed: "statusCompleted",
        "in-progress": "statusInProgress",
        cancelled: "statusCancelled",
      }[status],
    );
  const scope = new AbortController();
  const workspace = document.querySelector(".workspace");
  const editor = document.querySelector(".workspace > .editor");
  const oaActions = document.querySelector(".sidebar-actions");
  const t = (key, values) => WorkTimeApp.i18n.t("agenda." + key, values);
  let active = false,
    analysisReturnAgenda = false,
    formOpen = false,
    auxiliaryOpen = false,
    listScroll = 0,
    returnFocus = null,
    disposed = false,
    busy = false,
    editingId = null,
    baseline = "",
    renderedDateHeader = "",
    weekView = 0,
    weekTransition = null,
    weekNavigation = null,
    weekLabelNode = null,
    weekLabelText = "",
    weekLabelExit = null,
    weekLabelReveal = null;
  const viewStorageKey = "worktime.calendarView";
  let lastSavedView = null;
  try {
    const raw = window.localStorage.getItem(viewStorageKey);
    const saved = JSON.parse(raw);
    if (
      saved &&
      ["attendance", "agenda"].includes(saved.mode) &&
      [0, 1, 2, 3].includes(saved.weeks)
    ) {
      active = saved.mode === "agenda";
      weekView = saved.weeks;
      model.analysisMode = saved.analysis === true;
      if (model.analysisMode) {
        analysisReturnAgenda = active;
        active = false;
      }
      lastSavedView = raw;
    }
  } catch {}
  function rememberView() {
    try {
      const saved = JSON.stringify({
        mode:
          active || (model.analysisMode && analysisReturnAgenda)
            ? "agenda"
            : "attendance",
        weeks: weekView,
        analysis: model.analysisMode,
      });
      if (saved === lastSavedView) return;
      window.localStorage.setItem(viewStorageKey, saved);
      lastSavedView = saved;
    } catch {}
  }
  const make = (tag, id, className, parent) => {
    const node = document.createElement(tag);
    node.id = id;
    node.className = className;
    parent.append(node);
    return node;
  };
  const modes = make(
    "div",
    "agendaModes",
    "agenda-modes calendar-view-button-group",
    document.querySelector(".month-controls"),
  );
  $("analysisToggle").after(modes);
  modes.innerHTML =
    '<button type="button" id="agendaMode" class="ui-button icon-only" aria-pressed="false" aria-controls="calendar agendaEditor"><svg class="ui-icon" aria-hidden="true"><use href="#ms-event-note"/></svg></button>';
  modes.setAttribute("role", "group");
  modes.prepend($("analysisToggle"));
  const modesRegion = document.createElement("div");
  modesRegion.className = "agenda-toolbar-region agenda-modes-region";
  const modesDivider = document.createElement("span");
  modesDivider.className = "agenda-toolbar-divider";
  modesDivider.setAttribute("aria-hidden", "true");
  modes.before(modesRegion);
  modesRegion.append(modesDivider, modes);
  let modesHidden = null;
  let modesAnimations = [];
  const modesObserver = new MutationObserver(renderModes);
  modesObserver.observe($("batchToggle"), {
    attributes: true,
    attributeFilter: ["aria-pressed"],
  });
  const viewToggle = document.createElement("button");
  viewToggle.id = "agendaViewToggle";
  viewToggle.type = "button";
  viewToggle.className = "ui-button icon-only agenda-view-toggle";
  viewToggle.setAttribute("aria-controls", "calendar");
  viewToggle.innerHTML =
    '<svg class="ui-icon" aria-hidden="true"><use href="#ms-calendar-month"/></svg>';
  const toolbarSlot = document.createElement("div");
  toolbarSlot.className = "agenda-toolbar-slot";
  const toolbarRegion = document.createElement("div");
  toolbarRegion.className = "agenda-toolbar-region";
  const toolbarDivider = document.createElement("span");
  toolbarDivider.className = "agenda-toolbar-divider";
  toolbarDivider.setAttribute("aria-hidden", "true");
  $("batchToggle").before(toolbarRegion);
  toolbarRegion.append(toolbarSlot, toolbarDivider);
  toolbarSlot.append($("batchToggle"), viewToggle);
  let toolbarKey = null;
  let toolbarAnimations = [];
  let toolbarClone = null;
  let viewIconAnimation = null;
  const calendar = $("calendar");
  let agendaDrag = null;
  model.agendaViewWeeks = active ? weekView : 0;
  model.agendaViewAnchor = model.selected;
  const motion = WorkTimeApp.ui.motion;
  const calendarMotion = motion.calendar;
  const animationCompat = WorkTimeApp.ui.animationCompat;
  const reduced = animationCompat.preference();
  const outgoing = new Map();
  const incoming = new Map();
  const chipSignatures = new WeakMap();
  const transferChips = new Map();
  const snapshotScroll = new WeakMap();
  const renderedContents = new Map();
  let renderedAgendaIds = new Set();
  let dateItemsSource = null,
    dateItemsKey = "",
    dateItems = new Map();
  const observedHosts = new Set();
  const contentObserver = new window.ResizeObserver(() => fitMonthCards());
  document.fonts?.ready.then(() => fitMonthCards());
  let switchingMode = false;
  let preparingWeekLayout = false;
  let movingAgenda = false;
  let completingAgenda = null;
  let memoDirty = false,
    memoSaving = false,
    memoStatus = "",
    memoSavePromise = null;
  const contentSelector =
    ":scope > :is(.daytime, .dayhours, .day-footer, .agenda-card-items):not(.agenda-content-outgoing)";
  const canAnimate = () =>
    !disposed &&
    !document.hidden &&
    !reduced.matches &&
    !WorkTimeApp.i18n.changing;
  function stopOutgoing(card) {
    for (const entry of outgoing.get(card) || []) {
      entry.animation.cancel();
      entry.node.remove();
    }
    outgoing.delete(card);
  }
  function finishTransitions(event) {
    if (disposed || !canAnimate() || event?.type === "resize") {
      stopToolbarMotion();
      stopModesMotion();
    }
    agendaDrag?.cancel();
    stopIncoming();
    agendaLayout?.stop();
    finishWeekLabelExit();
    weekLabelReveal?.cancel();
    weekLabelReveal = null;
    finishWeekNavigation();
    for (const card of outgoing.keys()) stopOutgoing(card);
    finishWeekTransition();
    settleDrawer();
    stopSidebarMotion();
    WorkTimeApp.ui.numbers.settle(
      document.querySelector(".sidebar-brand-subtitle"),
    );
    motion?.stop(weekLabelNode?.querySelector(".summary-number"));
    if (weekLabelNode) WorkTimeApp.ui.numbers.settle(weekLabelNode);
  }
  function finishWeekNavigation() {
    if (!weekNavigation) return;
    weekNavigation = null;
    actions.finishCalendarNavigation();
  }
  function navigateAgenda(date, retainSelection = true) {
    if (!leaveForm()) return;
    const previous = weekView ? weekDates()[0] : model.month;
    const next = WorkTimeApp.domain.time.localDate(date);
    next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
    const start = weekView
      ? WorkTimeApp.domain.time.dateKey(next)
      : date.slice(0, 7);
    finishTransitions();
    actions.finishCalendarNavigation();
    actions.animateCalendarNavigation(
      start === previous ? 0 : start > previous ? 1 : -1,
      () => {
        switchingMode = true;
        try {
          select(date, false, true, retainSelection);
        } finally {
          switchingMode = false;
        }
        motion?.stop(calendar.querySelector(".selected"));
      },
    );
    weekNavigation = true;
  }
  function captureContent(card, selector = contentSelector) {
    stopOutgoing(card);
    if (!canAnimate()) return [];
    const bounds = card.getBoundingClientRect();
    return [...card.querySelectorAll(selector)].flatMap((element) => {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || !element.textContent.trim()) return [];
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      const node = element.cloneNode(true);
      // Outgoing content is a short-lived visual snapshot, never an interactive copy.
      for (const child of [node, ...node.querySelectorAll("*")]) {
        child.removeAttribute("id");
        for (const attribute of [...child.attributes])
          if (attribute.name.startsWith("data-"))
            child.removeAttribute(attribute.name);
      }
      node.classList.add("agenda-content-outgoing");
      node.inert = true;
      node.setAttribute("aria-hidden", "true");
      // The outgoing layer outlives its source mode. Preserve the layout that
      // mode supplied so a flex column cannot become a row during its exit.
      for (const property of [
        "box-sizing",
        "flex-direction",
        "flex-wrap",
        "align-items",
        "align-content",
        "justify-content",
        "gap",
        "padding",
        "border",
        "font",
        "line-height",
        "white-space",
        "overflow",
        "text-overflow",
      ])
        node.style.setProperty(property, style.getPropertyValue(property));
      Object.assign(node.style, {
        position: "absolute",
        display: style.display,
        margin: "0",
        left: rect.left - bounds.left - card.clientLeft + "px",
        top: rect.top - bounds.top - card.clientTop + "px",
        width: rect.width + "px",
        height: rect.height + "px",
        minWidth: "0",
        maxWidth: "none",
        minHeight: "0",
        maxHeight: "none",
        flex: "none",
        opacity: style.opacity,
        transform: "none",
        pointerEvents: "none",
        zIndex: "4",
      });
      snapshotScroll.set(node, {
        top: element.scrollTop,
        left: element.scrollLeft,
      });
      // Week lanes live outside day cards and have independent scroll positions.
      const lanes = element.querySelectorAll(".agenda-week-lane");
      node.querySelectorAll(".agenda-week-lane").forEach((lane, index) => {
        snapshotScroll.set(lane, {
          top: lanes[index].scrollTop,
          left: lanes[index].scrollLeft,
        });
      });
      return [node];
    });
  }
  function stopIncoming() {
    for (const animation of incoming.values()) animation.cancel();
    incoming.clear();
  }
  function revealIncoming(element, delay = 0) {
    if (!element || !canAnimate()) return;
    incoming.get(element)?.cancel();
    motion?.stop(element);
    const animation = animationCompat.animate(
      element,
      [
        { opacity: 0, transform: "translateX(-6px)" },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: calendarMotion.contentDuration,
        delay,
        easing: calendarMotion.easing,
        fill: "both",
      },
    );
    incoming.set(element, animation);
    animation.finished.then(() => {
      if (incoming.get(element) !== animation) return;
      incoming.delete(element);
      animation.cancel();
    });
  }
  function visibleContent(card) {
    return [...card.querySelectorAll(contentSelector)].filter(
      (element) =>
        element.textContent.trim() &&
        window.getComputedStyle(element).display !== "none",
    );
  }
  function revealContent(
    card,
    snapshots,
    delay = snapshots.length ? 120 : 0,
    elements = visibleContent(card),
  ) {
    if (!canAnimate()) return;
    stopOutgoing(card);
    for (const element of elements) revealIncoming(element, delay);
    const entries = snapshots.map((node) => {
      // A full week can be taller than the destination month. Clip the visual
      // copy in a stationary viewport so neither its old size nor its horizontal
      // exit transform contributes to the calendar's scrollable overflow.
      const exitRoot = card === calendar ? document.createElement("div") : node;
      if (exitRoot !== node) {
        exitRoot.className = "agenda-mode-exit-clip";
        exitRoot.inert = true;
        exitRoot.setAttribute("aria-hidden", "true");
        exitRoot.append(node);
      }
      card.append(exitRoot);
      for (const element of [
        node,
        ...node.querySelectorAll(".agenda-week-lane"),
      ]) {
        const scroll = snapshotScroll.get(element);
        element.scrollTop = scroll.top;
        element.scrollLeft = scroll.left;
      }
      const opacity = Number(node.style.opacity);
      node.style.opacity = "0";
      return {
        node: exitRoot,
        animation: animationCompat.animate(
          node,
          [
            { opacity, transform: "none" },
            { opacity: 0, transform: "translateX(6px)" },
          ],
          {
            duration: calendarMotion.contentLeaveDuration,
            easing: "ease-out",
            fill: "both",
          },
        ),
      };
    });
    if (!entries.length) return;
    outgoing.set(card, entries);
    Promise.all(entries.map((entry) => entry.animation.finished)).then(() => {
      if (outgoing.get(card) === entries) {
        for (const entry of entries) entry.node.remove();
        outgoing.delete(card);
      }
    });
  }
  const unlistenMotion = animationCompat.listen(reduced, () => {
    if (reduced.matches) finishTransitions();
  });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) finishTransitions();
    },
    { signal: scope.signal },
  );
  const dayCards = () => [...calendar.querySelectorAll(":scope > .day")];
  const cardDate = (card) => card.dataset.date || card.dataset.previewDate;
  function fitMonthCards() {
    if (
      disposed ||
      !active ||
      weekView ||
      weekTransition ||
      preparingWeekLayout
    )
      return;
    const hosts = [...observedHosts]
      .map((host) => ({
        host,
        chips: [...host.querySelectorAll(":scope > .agenda-chip")],
        more: host.querySelector(":scope > .agenda-more"),
      }))
      .filter(({ chips, more }) => chips.length && more);
    // Reveal, measure and fit the entire calendar in phases, never per card.
    for (const { chips, more } of hosts) {
      for (const chip of chips) chip.hidden = false;
      more.hidden = true;
    }
    const measurements = hosts
      .map((entry) => ({
        ...entry,
        gap: parseFloat(window.getComputedStyle(entry.host).rowGap) || 0,
        available: entry.host.clientHeight,
        heights: entry.chips.map((chip) => chip.getBoundingClientRect().height),
      }))
      .filter(({ available }) => available > 0);
    const overflowing = measurements.filter(
      ({ heights, available, gap }) =>
        heights.reduce((sum, height) => sum + height, 0) +
          gap * (heights.length - 1) >
        available + 0.5,
    );
    for (const { more, chips } of overflowing) {
      more.textContent = WorkTimeApp.i18n.number(chips.length) + "+";
      more.hidden = false;
    }
    const reserves = overflowing.map(
      ({ more }) => more.getBoundingClientRect().height,
    );
    overflowing.forEach(({ chips, more, heights, available, gap }, index) => {
      let used = 0,
        count = 0;
      for (const height of heights) {
        if (used + height + gap + reserves[index] > available + 0.5) break;
        used += height + gap;
        count++;
      }
      const hiddenCount = chips.length - count;
      more.textContent = WorkTimeApp.i18n.number(hiddenCount) + "+";
      more.setAttribute("aria-label", t("more", { count: hiddenCount }));
      chips.forEach((chip, index) => {
        chip.hidden = index >= count;
      });
    });
  }
  function weekDates(weeks = weekView || 1) {
    const start = WorkTimeApp.domain.time.localDate(model.agendaViewAnchor);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return Array.from({ length: weeks * 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      return WorkTimeApp.domain.time.dateKey(date);
    });
  }
  function finishWeekLabelExit() {
    if (!weekLabelExit) return;
    const animation = weekLabelExit;
    weekLabelExit = null;
    animation.cancel();
    weekLabelNode.hidden = true;
    $("monthTitle").classList.remove("has-week-label");
    $("monthTitle").style.removeProperty("--week-label-width");
  }
  function updateWeekLabel() {
    const title = $("monthTitle");
    const shown = active && weekView > 0;
    if (!shown) {
      if (weekLabelExit) return;
      if (weekLabelNode) {
        weekLabelReveal?.cancel();
        weekLabelReveal = null;
        WorkTimeApp.ui.numbers.settle(weekLabelNode);
        if (active && switchingMode && !weekLabelNode.hidden && canAnimate()) {
          weekLabelText = "";
          title.classList.remove("has-week-label");
          const animation = animationCompat.animate(
            weekLabelNode.lastElementChild,
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: 160, easing: "ease-in", fill: "both" },
          );
          weekLabelExit = animation;
          animation.finished.then(() => {
            if (weekLabelExit === animation) finishWeekLabelExit();
          });
          return;
        }
        weekLabelNode.hidden = true;
      }
      weekLabelText = "";
      title.classList.remove("has-week-label");
      title.style.removeProperty("--week-label-width");
      return;
    }
    finishWeekLabelExit();
    title.classList.add("has-week-label");
    if (!weekLabelNode || weekLabelNode.parentElement !== title) {
      const divider = title.querySelector(":scope > .month-title-divider");
      if (!divider) return;
      weekLabelNode = document.createElement("span");
      weekLabelNode.id = "monthTitleWeek";
      weekLabelNode.className = "month-title-week";
      weekLabelNode.setAttribute("aria-hidden", "true");
      weekLabelNode.append(divider.cloneNode(true));
      const label = document.createElement("span");
      label.className = "month-title-week-label";
      label.setAttribute("data-number-motion", "");
      weekLabelNode.append(label);
      title.append(weekLabelNode);
    }
    const first = WorkTimeApp.domain.time.localDate(model.month + "-01");
    const offset = (first.getDay() + 6) % 7;
    const anchor = model.agendaViewAnchor;
    const number = Math.floor((offset + Number(anchor.slice(8)) - 1) / 7) + 1;
    const value =
      "w" + number + (weekView > 1 ? "-" + (number + weekView - 1) : "");
    const appearing = !weekLabelText;
    const extending = !!weekLabelText && value.startsWith(weekLabelText + "-");
    const label = weekLabelNode.lastElementChild;
    const nextMonth =
      weekView > 1 && weekDates()[(weekView - 1) * 7].slice(0, 7) > model.month;
    const previousNextMonth = label.dataset.nextMonth === "true";
    if (value !== weekLabelText) {
      weekLabelReveal?.cancel();
      weekLabelReveal = null;
    }
    WorkTimeApp.ui.numbers.set(label, value, {
      animateInitial: false,
      motion:
        !appearing &&
        !extending &&
        weekLabelText.includes("-") === weekView > 1,
    });
    const visual = label.querySelector(".summary-number-visual");
    if (weekView > 1) {
      let range = visual.querySelector(".month-title-week-range");
      if (!range) {
        range = document.createElement("span");
        range.className = "month-title-week-range";
        range.append(...[...visual.children].slice(2));
        visual.append(range);
      }
      const column = range.querySelector(".summary-number-column");
      column.classList.add("month-title-week-end");
      for (const row of column.querySelectorAll(".summary-number-digit")) {
        // Outgoing rows retain their own month marker during the roll.
        const outgoing = row.classList.contains("summary-number-outgoing");
        if (outgoing && row.dataset.monthMarked !== undefined) continue;
        row.dataset.monthMarked = "";
        const marked = outgoing ? previousNextMonth : nextMonth;
        const existing = row.querySelector(".month-title-week-next-month");
        if (!marked) existing?.remove();
        else if (!existing) {
          const badge = document.createElement("span");
          badge.className = "month-title-week-next-month";
          badge.textContent = "+1";
          row.append(badge);
        }
      }
    }
    label.dataset.nextMonth = String(nextMonth);
    if (extending && canAnimate()) {
      // Keep the shared week at its resting position; only slide in the range.
      const suffix = visual.querySelector(".month-title-week-range");
      const animation = animationCompat.animate(
        suffix,
        [
          { opacity: 0, transform: "translateX(-0.35em)" },
          { opacity: 1, transform: "translateX(0)" },
        ],
        {
          duration: 360,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "backwards",
        },
      );
      weekLabelReveal = animation;
      animation.finished.then(() => {
        if (weekLabelReveal === animation) weekLabelReveal = null;
      });
    }
    weekLabelNode.hidden = false;
    title.style.setProperty(
      "--week-label-width",
      weekView > 1 ? "4.5ch" : "2.8ch",
    );
    weekLabelText = value;
    // Complete ink alignment before the first visible frame; opacity never
    // changes the baseline or interferes with the alignment transform.
    WorkTimeApp.ui.alignment?.refresh([title]);
    if (appearing && canAnimate()) {
      const animation = animationCompat.animate(
        label,
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 220, easing: "ease-out", fill: "backwards" },
      );
      weekLabelReveal = animation;
      animation.finished.then(() => {
        if (weekLabelReveal === animation) weekLabelReveal = null;
      });
    }
  }
  function applyWeekLayout() {
    const enabled = active && weekView;
    const dates = new Set(enabled ? weekDates() : []);
    calendar.classList.toggle("agenda-week-view", !!enabled);
    if (enabled) calendar.dataset.agendaRows = String(weekView);
    else delete calendar.dataset.agendaRows;
    for (const card of dayCards()) {
      const visible = dates.has(cardDate(card));
      const selectable = active && (!weekView || visible);
      card.toggleAttribute("data-agenda-week", visible);
      let button = card.querySelector(".agenda-week-select");
      if (selectable && card.dataset.previewDate && !button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "day-select agenda-week-select";
        button.setAttribute(
          "aria-label",
          WorkTimeApp.i18n.date(cardDate(card)),
        );
        card.prepend(button);
      } else if (!selectable) {
        button?.remove();
        if (card.dataset.previewDate)
          card.querySelector(".agenda-card-items")?.remove();
      }
      if (card.dataset.previewDate && active) {
        card.classList.toggle(
          "selected",
          selectable &&
            cardDate(card) ===
              (model.calendarSelected === undefined
                ? model.selected
                : model.calendarSelected),
        );
        button?.setAttribute(
          "aria-pressed",
          String(
            selectable &&
              cardDate(card) ===
                (model.calendarSelected === undefined
                  ? model.selected
                  : model.calendarSelected),
          ),
        );
      }
    }
  }
  function finishWeekTransition() {
    const transition = weekTransition;
    if (!transition) return;
    weekTransition = null;
    for (const animation of transition.animations) animation.cancel();
    for (const [element, original] of transition.styles) {
      if (original === null) element.removeAttribute("style");
      else element.setAttribute("style", original);
      element.classList.remove("agenda-week-leaving");
    }
    for (const [element, inert] of transition.inert) element.inert = inert;
    fitMonthCards();
    agendaLayout.render();
  }
  function captureWeekLayout() {
    const laneBefore = agendaLayout.capture();
    const expandNotes = !active || !weekView;
    const chipHeights = new Map(
      [...calendar.querySelectorAll(".agenda-chip[data-agenda-edit]")].map(
        (chip) => [
          chip.dataset.agendaEdit,
          chip.getBoundingClientRect().height,
        ],
      ),
    );
    const before = new Map(
      dayCards()
        .filter((card) => window.getComputedStyle(card).display !== "none")
        .map((card) => [
          cardDate(card),
          {
            rect: card.getBoundingClientRect(),
            opacity: window.getComputedStyle(card).opacity,
          },
        ]),
    );
    const previousDates = new Set(weekDates());
    return { laneBefore, expandNotes, chipHeights, before, previousDates };
  }
  function switchWeek(enabled) {
    if (busy || enabled === weekView || !active) return;
    // Capture the painted state before cancellation restores the resting grid.
    const layout = captureWeekLayout();
    finishTransitions();
    actions.finishCalendarNavigation();
    weekView = enabled;
    model.agendaViewWeeks = enabled;
    model.agendaViewAnchor = model.selected;
    model.month = model.selected.slice(0, 7);
    switchingMode = true;
    preparingWeekLayout = true;
    try {
      actions.render();
    } finally {
      switchingMode = false;
      preparingWeekLayout = false;
    }
    animateWeekLayout(layout);
  }
  function animateWeekLayout({
    laneBefore,
    expandNotes,
    chipHeights,
    before,
    previousDates,
  }) {
    if (!canAnimate()) {
      agendaLayout.render();
      fitMonthCards();
      return;
    }
    const enabled = active ? weekView : 0;
    const transition = { animations: [], styles: new Map(), inert: new Map() };
    const saveStyle = (element) => {
      if (!transition.styles.has(element))
        transition.styles.set(element, element.getAttribute("style"));
    };
    saveStyle(calendar);
    const targetCalendarHeight = calendar.getBoundingClientRect().height;
    calendar.style.position = "relative";
    calendar.style.overflow = "hidden";
    calendar.style.height = targetCalendarHeight + "px";
    calendar.style.flex = "none";
    // Explicit tracks keep animated card heights from resizing neighboring rows.
    calendar.style.gridAutoRows = "minmax(0, 1fr)";
    calendar.style.gridTemplateRows = enabled
      ? `repeat(${enabled}, minmax(0, 1fr))`
      : `repeat(${calendar.dataset.weeks || 6}, minmax(0, 1fr))`;
    // Recalculate the overlay against the locked final grid before either
    // surface starts moving. Auto-height narrow layouts must not reflow mid-flight.
    agendaLayout.render({ animate: false });
    weekTransition = transition;
    // Read every resting surface before changing any card or starting effects.
    const cards = dayCards().map((card) => {
      const style = window.getComputedStyle(card);
      const visible = style.display !== "none";
      return {
        card,
        date: cardDate(card),
        visible,
        opacity: Number(style.opacity),
        rect: visible ? card.getBoundingClientRect() : null,
      };
    });
    const bounds = calendar.getBoundingClientRect();
    const borderLeft = calendar.clientLeft;
    const borderTop = calendar.clientTop;
    const scrollTop = calendar.scrollTop;
    const distance = bounds.height;
    const dates = weekDates();
    const plans = [];
    const dayMotions = new Map();
    const animateDay = (card, frames, options) => {
      dayMotions.set(cardDate(card), { frames, options });
      if (frames.some((frame) => frame.opacity !== undefined)) {
        // Fade independently so outgoing cards become transparent before they
        // leave the clipped viewport, while retaining their movement timing.
        plans.push({
          element: card,
          frames: frames.map(({ opacity }) => ({ opacity })),
          options: { ...options, easing: "ease-out" },
        });
        frames = frames.map(({ opacity: _opacity, ...frame }) => frame);
      }
      plans.push({ element: card, frames, options });
    };
    for (const { card, date, visible, opacity, rect: next } of cards) {
      const previous = before.get(date);
      const inWeek =
        card.hasAttribute("data-agenda-week") ||
        (!enabled && previousDates.has(date));
      saveStyle(card);
      motion?.stop(card);
      if (inWeek && previous && visible) {
        card.style.zIndex = "2";
        animateDay(
          card,
          [
            {
              transform: `translate(${previous.rect.left - next.left}px, ${previous.rect.top - next.top}px)`,
              height: previous.rect.height + "px",
              width: previous.rect.width + "px",
            },
            {
              transform: "none",
              height: next.height + "px",
              width: next.width + "px",
            },
          ],
          {
            duration: calendarMotion.duration,
            easing: calendarMotion.easing,
            fill: "both",
          },
        );
      } else if (enabled && previous) {
        card.classList.add("agenda-week-leaving");
        transition.inert.set(card, card.inert);
        card.inert = true;
        Object.assign(card.style, {
          position: "absolute",
          opacity: "0",
          left: previous.rect.left - bounds.left - borderLeft + "px",
          top: previous.rect.top - bounds.top - borderTop + scrollTop + "px",
          width: previous.rect.width + "px",
          height: previous.rect.height + "px",
          margin: "0",
          zIndex: "1",
        });
        const offset = date < dates[0] ? -distance : distance;
        animateDay(
          card,
          [
            { opacity: Number(previous.opacity), transform: "none" },
            { opacity: 0, transform: `translateY(${offset}px)` },
          ],
          {
            duration: calendarMotion.leaveDuration,
            easing: "ease-in",
            fill: "both",
          },
        );
      } else if (visible && (!previous || (!enabled && !inWeek))) {
        const offset = date < dates[0] ? -distance * 0.6 : distance * 0.6;
        animateDay(
          card,
          [
            { opacity: 0, transform: `translateY(${offset}px)` },
            {
              opacity,
              transform: "none",
            },
          ],
          {
            duration: calendarMotion.duration,
            easing: calendarMotion.easing,
            fill: "both",
          },
        );
      }
    }
    plans.push(
      ...agendaLayout.planAnimation(laneBefore, expandNotes, dayMotions),
    );
    if (expandNotes && !calendar.classList.contains("agenda-lane-view")) {
      for (const note of calendar.querySelectorAll(
        "[data-agenda-week] .agenda-chip-note",
      )) {
        const chip = note.closest(".agenda-chip");
        const height = chip.getBoundingClientRect().height;
        const compactHeight =
          chipHeights.get(chip.dataset.agendaEdit) ||
          height - note.getBoundingClientRect().height;
        saveStyle(chip);
        chip.style.clipPath = "inset(0 -7px 0 -2px)";
        const options = {
          duration: calendarMotion.duration,
          easing: calendarMotion.easing,
          fill: "both",
        };
        plans.push(
          {
            element: chip,
            frames: [
              { height: compactHeight + "px" },
              { height: height + "px" },
            ],
            options,
          },
          { element: note, frames: [{ opacity: 0 }, { opacity: 1 }], options },
        );
      }
    }
    transition.animations = motion.animateCalendar(plans);
    Promise.all(
      transition.animations.map((animation) => animation.finished),
    ).then(() => {
      if (weekTransition === transition) finishWeekTransition();
    });
  }
  window.addEventListener("resize", finishTransitions, {
    signal: scope.signal,
  });
  const pane = make("section", "agendaEditor", "agenda-editor", editor);
  editor.querySelector(".editor-content").after(pane);
  pane.hidden = true;
  pane.setAttribute("aria-labelledby", "agendaDate");
  pane.innerHTML = `
    <div class="editor-day-header editor-mode-header agenda-heading"><div id="agendaDate" class="editor-date"></div></div>
    <div class="agenda-day-toolbar" hidden><button id="agendaBack" type="button" class="ui-button icon-only" hidden><svg class="ui-icon" aria-hidden="true"><use href="#ms-chevron-left"/></svg></button><h2 id="agendaFormTitle"></h2></div>
    <div id="agendaCritical" class="agenda-critical" role="alert" hidden></div>
    <section id="agendaDayDetails" class="agenda-day-details"><div id="agendaList" class="agenda-list" tabindex="0"></div><div class="agenda-list-actions"><button id="agendaNew" type="button" class="ui-button primary" data-agenda-text="new"></button></div></section>
    <div class="agenda-editor-body">
    <form id="agendaForm" class="agenda-form" aria-labelledby="agendaFormTitle">
      <fieldset id="agendaFields">
        <div class="agenda-field agenda-title-field"><label for="agendaTitle" data-agenda-text="title"></label><input id="agendaTitle" maxlength="120" required autocomplete="off"></div>
        <div class="agenda-properties"><div class="agenda-field agenda-status-field"><label for="agendaItemStatus" data-agenda-text="status"></label><div class="agenda-status-input"><span class="agenda-status-dot" aria-hidden="true"></span><select id="agendaItemStatus">${statuses.map((status) => `<option value="${status}">${esc(statusLabel(status))}</option>`).join("")}</select></div></div>
        <div id="agendaSchedule" class="agenda-schedule-fields"></div>
        </div><div class="agenda-field agenda-note-field"><label for="agendaNote" data-agenda-text="note"></label><textarea id="agendaNote" rows="3" maxlength="5000"></textarea></div>
      </fieldset>
    </form>
    </div>
    <div class="agenda-feedback"><p id="agendaError" class="warnings" role="alert"></p><p id="agendaStatus" role="status" aria-live="polite"></p></div>
    <div class="agenda-editor-footer" hidden><p id="agendaDraft" class="muted" role="status" hidden data-agenda-text="unsavedChanges"></p><div class="agenda-actions"><button id="agendaCancel" type="button" class="ui-button" data-agenda-text="cancel"></button><button id="agendaSave" form="agendaForm" type="submit" class="ui-button primary" aria-keyshortcuts="Control+Enter Meta+Enter"></button></div></div>`;
  const statusMenu = make(
    "div",
    "agendaStatusMenu",
    "agenda-status-menu",
    pane,
  );
  statusMenu.setAttribute("popover", "auto");
  statusMenu.setAttribute("role", "menu");
  let statusTrigger = null;
  const statusPopover = WorkTimeApp.ui.popover.create(statusMenu, {
    trigger: () => statusTrigger,
  });
  function closeStatusMenu(restoreFocus = false) {
    if (statusPopover.isOpen()) statusPopover.hide();
    if (restoreFocus) statusTrigger?.focus({ preventScroll: true });
  }
  function openStatusMenu(button) {
    closeStatusMenu();
    statusTrigger = button;
    statusMenu.dataset.agendaId = button.dataset.agendaStatus;
    statusMenu.setAttribute("aria-label", t("changeStatus"));
    statusMenu.innerHTML = statuses
      .map(
        (status) =>
          `<button type="button" role="menuitemradio" aria-checked="${status === button.dataset.status}" data-agenda-status-choice="${status}"><span class="agenda-status-dot" data-status="${status}" aria-hidden="true"></span>${esc(statusLabel(status))}</button>`,
      )
      .join("");
    const rect = button.getBoundingClientRect();
    statusPopover.show();
    button.setAttribute("aria-expanded", "true");
    statusMenu.style.left =
      Math.max(
        8,
        Math.min(rect.left, window.innerWidth - statusMenu.offsetWidth - 8),
      ) + "px";
    statusMenu.style.top =
      Math.max(
        8,
        Math.min(
          rect.bottom + 6,
          window.innerHeight - statusMenu.offsetHeight - 8,
        ),
      ) + "px";
    statusMenu.querySelector('[aria-checked="true"]').focus();
  }
  statusMenu.addEventListener(
    "toggle",
    () => {
      if (!statusPopover.isOpen())
        statusTrigger?.setAttribute("aria-expanded", "false");
    },
    { signal: scope.signal },
  );
  statusMenu.addEventListener(
    "keydown",
    (event) => {
      const buttons = [...statusMenu.querySelectorAll("button")];
      const index = buttons.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        buttons[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length
        ].focus();
      } else if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        closeStatusMenu(true);
      }
    },
    { signal: scope.signal },
  );
  window.addEventListener("resize", () => closeStatusMenu(), {
    signal: scope.signal,
  });
  pane.addEventListener("scroll", () => closeStatusMenu(), {
    capture: true,
    signal: scope.signal,
  });
  const schedule = WorkTimeApp.ui.createAgendaSchedule({
    root: $("agendaSchedule"),
  });
  const summary = make(
    "section",
    "agendaSummary",
    "agenda-summary",
    document.querySelector(".summary-sidebar"),
  );
  summary.hidden = true;
  summary.innerHTML = '<div id="agendaOverview"></div>';
  const expandedGroups = new Set();
  const controls = make(
    "div",
    "agendaControls",
    "agenda-controls",
    document.querySelector(".panel-head"),
  );
  controls.innerHTML =
    '<button id="agendaOverviewOpen" class="ui-button" type="button" aria-haspopup="dialog" data-agenda-text="overviewMemo"></button>';
  const overviewDialog = make(
    "dialog",
    "agendaOverviewDialog",
    "agenda-overview-dialog",
    document.body,
  );
  overviewDialog.innerHTML =
    '<div class="dialog-head"><h2></h2><button id="agendaOverviewClose" class="ui-button" type="button"></button></div><div class="agenda-overview-host"></div>';
  const auxiliaryArea = editor.querySelector(".date-info-area");
  const originalAreaTabIndex = auxiliaryArea.getAttribute("tabindex");
  auxiliaryArea.tabIndex = -1;
  const drawerGrip = make(
    "button",
    "agendaDrawerGrip",
    "agenda-drawer-grip",
    auxiliaryArea,
  );
  drawerGrip.type = "button";
  auxiliaryArea.prepend(drawerGrip);
  let drawerTab = null,
    drawerAnimation = null,
    drawerTarget = false;
  const drawerGeometry = new window.ResizeObserver(() => {
    editor.style.setProperty(
      "--agenda-tabs-height",
      editor.querySelector(".notification-tabs").getBoundingClientRect()
        .height + "px",
    );
  });
  drawerGeometry.observe(editor.querySelector(".notification-tabs"));
  function settleDrawer() {
    const animation = drawerAnimation;
    drawerAnimation = null;
    animation?.cancel();
    editor.classList.toggle("agenda-auxiliary-open", active && drawerTarget);
    editor.classList.remove("agenda-auxiliary-closing");
  }
  function setAuxiliary(open) {
    auxiliaryOpen = open;
    const next = active && open;
    for (const tab of editor.querySelectorAll(".notification-tab")) {
      if (active)
        tab.setAttribute(
          "aria-expanded",
          String(open && tab.dataset.tab === drawerTab),
        );
      else tab.removeAttribute("aria-expanded");
    }
    if (next === drawerTarget) {
      if (!active || !canAnimate()) settleDrawer();
      return;
    }
    drawerTarget = next;
    const interrupted = drawerAnimation !== null;
    const start = interrupted
      ? window.getComputedStyle(auxiliaryArea).transform
      : next
        ? "translateY(100%)"
        : "translateY(0)";
    const previous = drawerAnimation;
    drawerAnimation = null;
    previous?.cancel();
    if (!active || !canAnimate()) {
      settleDrawer();
      return;
    }
    editor.classList.add("agenda-auxiliary-open");
    editor.classList.toggle("agenda-auxiliary-closing", !next);
    const animation = animationCompat.animate(
      auxiliaryArea,
      [
        { transform: start },
        { transform: next ? "translateY(0)" : "translateY(100%)" },
      ],
      {
        duration: next ? 320 : 240,
        easing: next
          ? "cubic-bezier(0.22, 1, 0.36, 1)"
          : "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "both",
      },
    );
    drawerAnimation = animation;
    animation.finished.then(() => {
      if (drawerAnimation !== animation) return;
      drawerAnimation = null;
      editor.classList.toggle("agenda-auxiliary-open", active && drawerTarget);
      editor.classList.remove("agenda-auxiliary-closing");
    });
  }
  function syncOverviewHost() {
    const narrow = window.matchMedia("(max-width: 1150px)").matches;
    if (!active || !narrow) overviewDialog.close();
    const host =
      active && narrow
        ? overviewDialog.querySelector(".agenda-overview-host")
        : document.querySelector(".summary-sidebar");
    if (summary.parentElement !== host) host.append(summary);
  }
  function leaveForm() {
    if (formOpen && hasDraft() && !window.confirm(t("discard"))) return false;
    reset();
    formOpen = false;
    return true;
  }
  function returnToList() {
    if (!leaveForm()) return;
    actions.render();
    $("agendaList").scrollTop = listScroll;
    const target =
      returnFocus?.isConnected && returnFocus.getClientRects().length
        ? returnFocus
        : $("agendaNew");
    target.focus({ preventScroll: true });
  }
  function openForm() {
    if (!formOpen) listScroll = $("agendaList").scrollTop;
    returnFocus = document.activeElement;
    formOpen = true;
    $("agendaStatus").textContent = "";
    setAuxiliary(false);
    overviewDialog.close();
  }
  function syncCritical() {
    const notices = [...$("editorInfo").querySelectorAll(".tone-error")].filter(
      (node) => !node.hidden && !node.classList.contains("hidden"),
    );
    const message = notices
      .map((node) =>
        node.querySelector(".notification-body")?.textContent.trim(),
      )
      .filter(Boolean)
      .join(" · ");
    if ($("agendaCritical").textContent !== message)
      $("agendaCritical").textContent = message;
    $("agendaCritical").hidden = !message;
  }
  const noticeObserver = new MutationObserver(syncCritical);
  noticeObserver.observe($("editorInfo"), {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });
  summary.insertAdjacentHTML(
    "afterbegin",
    '<section class="agenda-memo" aria-labelledby="agendaMemoLabel"><label id="agendaMemoLabel" for="agendaMemo" hidden></label><div class="agenda-memo-input"><span class="agenda-memo-watermark" aria-hidden="true"><span class="agenda-memo-important">Important</span><span>Note</span></span><textarea id="agendaMemo" rows="4" maxlength="10000" aria-labelledby="agendaMemoLabel" aria-describedby="agendaMemoStatus"></textarea></div><span id="agendaMemoStatus" role="status" aria-live="polite" hidden></span><button id="agendaMemoRetry" type="button" class="ui-button" hidden></button></section>',
  );
  function renderMemo() {
    if (
      !memoDirty &&
      !memoSaving &&
      $("agendaMemo").value !== (model.state.memo ?? "")
    )
      $("agendaMemo").value = model.state.memo ?? "";
    $("agendaMemoLabel").textContent = t("memo");
    $("agendaMemo").disabled = model.loadIssue === "unsupported";
    $("agendaMemoStatus").textContent = memoStatus
      ? t(memoStatus)
      : t("memoAutoSave");
    $("agendaMemoStatus").classList.toggle(
      "is-error",
      memoStatus === "saveFailed",
    );
    $("agendaMemoStatus").hidden = memoStatus !== "saveFailed";
    $("agendaMemoRetry").hidden = memoStatus !== "saveFailed";
    $("agendaMemoRetry").textContent = t("memoRetry");
  }
  function saveMemo() {
    if (memoSaving) return memoSavePromise;
    if (!memoDirty || disposed) return Promise.resolve();
    memoSavePromise = persistMemo();
    return memoSavePromise;
  }
  async function persistMemo() {
    const text = $("agendaMemo").value;
    memoSaving = true;
    memoStatus = "memoSaving";
    renderMemo();
    let persisted = false;
    try {
      persisted = (await application.saveMemo(text)).persisted;
    } catch {
      persisted = false;
    }
    if (disposed) return;
    memoSaving = false;
    memoDirty = !persisted || $("agendaMemo").value !== text;
    memoStatus = persisted ? "saved" : "saveFailed";
    actions.render();
    if (persisted && memoDirty) await saveMemo();
  }
  function sidebarTargets() {
    return {
      attendance: [
        oaActions,
        document.querySelector(".summary-sidebar > .summary-divider"),
        $("cards"),
        document.querySelector(".summary-sidebar > .target-panel"),
        $("dayForm"),
      ],
      agenda: [
        summary,
        formOpen
          ? pane.querySelector(".agenda-editor-body")
          : $("agendaDayDetails"),
      ],
    };
  }
  function stopSidebarMotion() {
    for (const element of Object.values(sidebarTargets()).flat())
      motion?.stop(element);
  }
  function revealSidebars() {
    if (!canAnimate()) return;
    for (const element of sidebarTargets()[active ? "agenda" : "attendance"]) {
      // Keep the brand stationary while the remaining content reveals together.
      if (
        element?.getClientRects().length &&
        window.getComputedStyle(element).display !== "none"
      )
        motion?.play(element, "motion-card-content");
    }
  }

  function values() {
    return {
      title: $("agendaTitle").value,
      ...schedule.values(),
      note: $("agendaNote").value,
      status: $("agendaItemStatus").value,
    };
  }
  const hasDraft = () => JSON.stringify(values()) !== baseline;
  function times() {
    schedule.render();
    $("agendaDraft").hidden = !hasDraft();
    pane.querySelector(".agenda-status-input").dataset.status =
      $("agendaItemStatus").value;
    $("agendaTitle").placeholder = t("titlePlaceholder");
    $("agendaNote").placeholder = t("notePlaceholder");
    $("agendaSave").textContent = t(editingId ? "saveChanges" : "createItem");
    $("agendaSave").title = $("agendaSave").textContent + " (Ctrl/⌘ + Enter)";
    $("agendaSave").disabled =
      busy ||
      model.loadIssue === "unsupported" ||
      !$("agendaTitle").value.trim();
    $("agendaCancel").disabled = busy;
    const note = $("agendaNote");
    if (note.getClientRects().length) {
      note.style.height = "auto";
      note.style.height =
        Math.min(240, Math.max(104, note.scrollHeight)) + "px";
    }
  }
  function reset(item = null) {
    closeStatusMenu();
    schedule.close();
    editingId = item?.id || null;
    $("agendaTitle").value = item?.title || "";
    schedule.setValue({ ...item, date: item?.date || model.selected });
    $("agendaNote").value = item?.note || "";
    $("agendaItemStatus").value = item?.status || "pending";
    baseline = JSON.stringify(values());
    $("agendaError").textContent = "";
    $("agendaFormTitle").textContent = t(item ? "edit" : "new");
    times();
  }
  function labelTime(item, compact = false) {
    if (!compact && (item.endDate ?? item.date) > item.date)
      return (
        WorkTimeApp.i18n.date(item.date) +
        (item.allDay ? "" : " " + item.start) +
        " — " +
        WorkTimeApp.i18n.date(item.endDate) +
        (item.allDay ? "" : " " + item.end)
      );
    return item.allDay
      ? t("allDay")
      : item.start + (item.end ? "–" + item.end : "");
  }
  function entry(item) {
    return `<div class="agenda-item${item.status === "completed" ? " is-complete" : ""}">
      <button type="button" class="agenda-complete" data-agenda-status="${esc(item.id)}" data-status="${item.status}" aria-haspopup="menu" aria-controls="agendaStatusMenu" aria-expanded="false" title="${esc(statusLabel(item.status))}" aria-label="${esc(t("changeStatus") + ": " + statusLabel(item.status) + " · " + item.title)}"${busy && !completingAgenda ? " disabled" : ""}></button>
      <button type="button" class="agenda-item-copy" data-agenda-edit="${esc(item.id)}"><strong>${esc(item.title)}</strong><small>${esc(labelTime(item))}</small>${item.note ? `<span class="agenda-note">${esc(item.note)}</span>` : ""}</button>
      <button type="button" class="agenda-delete" data-agenda-delete="${esc(item.id)}" aria-label="${esc(t("delete") + ": " + item.title)}"${busy && !completingAgenda ? " disabled" : ""}><span aria-hidden="true">×</span></button></div>`;
  }
  function updateMarkup(node, html) {
    if (node.innerHTML === html) return;
    const focused = document.activeElement;
    const identity = node.contains(focused)
      ? [...focused.attributes].find((attribute) =>
          attribute.name.startsWith("data-agenda-"),
        )
      : null;
    const scrollTop = node.scrollTop;
    if (node.id === "agendaList") {
      const template = document.createElement("template");
      template.innerHTML = html;
      const previous = new Map(
        [...node.querySelectorAll(":scope > .agenda-item")].map((entry) => [
          entry.querySelector("[data-agenda-status]").dataset.agendaStatus,
          entry,
        ]),
      );
      const children = [...template.content.children].map((candidate) => {
        const id = candidate.querySelector("[data-agenda-status]")?.dataset
          .agendaStatus;
        const old = previous.get(id);
        if (
          !old ||
          old.querySelector(".agenda-item-copy").innerHTML !==
            candidate.querySelector(".agenda-item-copy").innerHTML
        )
          return candidate;
        old.className = candidate.className;
        const oldButtons = [...old.querySelectorAll("button")];
        [...candidate.querySelectorAll("button")].forEach((button, index) => {
          const current = oldButtons[index];
          for (const attribute of [...current.attributes])
            if (!button.hasAttribute(attribute.name))
              current.removeAttribute(attribute.name);
          for (const attribute of button.attributes)
            if (current.getAttribute(attribute.name) !== attribute.value)
              current.setAttribute(attribute.name, attribute.value);
        });
        return old;
      });
      children.forEach((child, index) => {
        if (node.children[index] !== child)
          node.insertBefore(child, node.children[index] || null);
      });
      for (const child of [...node.children])
        if (!children.includes(child)) child.remove();
    } else if (node.classList.contains("agenda-card-items")) {
      const template = document.createElement("template");
      template.innerHTML = html;
      const key = (button) =>
        button.dataset.agendaEdit || button.dataset.agendaDate;
      const previous = new Map(
        [...node.children].map((button) => [key(button), button]),
      );
      [...template.content.children].forEach((candidate, index) => {
        const old =
          previous.get(key(candidate)) || transferChips.get(key(candidate));
        const signature = candidate.outerHTML;
        const button =
          old &&
          (chipSignatures.get(old) === signature ||
            updateCompletion(old, candidate))
            ? old
            : candidate;
        chipSignatures.set(button, signature);
        if (button === old) button.title = candidate.title;
        if (button === transferChips.get(key(candidate))) {
          for (const property of ["left", "top", "width"])
            button.style.removeProperty(property);
        }
        delete button.dataset.agendaSegmentStart;
        delete button.dataset.agendaSegmentEnd;
        if (old && old !== button) old.remove();
        previous.delete(key(candidate));
        if (node.children[index] !== button)
          node.insertBefore(button, node.children[index] || null);
      });
      for (const button of previous.values()) button.remove();
    } else node.innerHTML = html;
    node.scrollTop = scrollTop;
    if (identity)
      [...node.querySelectorAll("button")]
        .find((button) => button.getAttribute(identity.name) === identity.value)
        ?.focus({ preventScroll: true });
  }
  function updateCompletion(previous, candidate) {
    // Status/selection are paint changes. Reuse chips independently of the
    // save's lifetime, including form saves and deferred ResizeObserver renders.
    if (previous.dataset.agendaEdit !== candidate.dataset.agendaEdit)
      return false;
    for (const name of ["continues-before", "continues-after"])
      if (
        previous.classList.contains(name) !== candidate.classList.contains(name)
      )
        return false;
    for (const key of ["agendaSegmentStart", "agendaSegmentEnd"])
      if (
        candidate.dataset[key] &&
        previous.dataset[key] !== candidate.dataset[key]
      )
        return false;
    for (const selector of [
      ".agenda-chip-title-text",
      ".agenda-chip-time",
      ".agenda-chip-note",
    ])
      if (
        previous.querySelector(selector)?.textContent !==
        candidate.querySelector(selector)?.textContent
      )
        return false;
    if (
      !!previous.querySelector(".agenda-resize-handle") !==
      !!candidate.querySelector(".agenda-resize-handle")
    )
      return false;
    const status = previous.querySelector(".agenda-chip-status");
    const nextStatus = candidate.querySelector(".agenda-chip-status");
    if (!status || !nextStatus) return false;
    previous.classList.toggle(
      "is-selected",
      candidate.classList.contains("is-selected"),
    );
    previous.setAttribute(
      "aria-current",
      candidate.getAttribute("aria-current"),
    );
    previous.dataset.status = candidate.dataset.status;
    previous.title = candidate.title;
    status.dataset.status = nextStatus.dataset.status;
    previous.classList.toggle(
      "is-complete",
      candidate.classList.contains("is-complete"),
    );
    if (status.innerHTML !== nextStatus.innerHTML)
      status.innerHTML = nextStatus.innerHTML;
    status.setAttribute("aria-label", nextStatus.getAttribute("aria-label"));
    return true;
  }
  function chipMarkup(item) {
    const selected = formOpen && editingId === item.id;
    return `<button type="button" class="agenda-chip${item.status === "completed" ? " is-complete" : ""}${selected ? " is-selected" : ""}" aria-current="${selected}" data-agenda-edit="${esc(item.id)}" data-status="${item.status}" title="${esc((item.allDay ? item.title : labelTime(item) + " · " + item.title) + " · " + statusLabel(item.status))}">${weekView && !item.allDay ? `<span class="agenda-chip-time">${esc(labelTime(item, true))}</span>` : ""}<span class="agenda-chip-title"><span class="agenda-chip-title-text">${esc(item.title)}</span><span class="agenda-chip-status" data-status="${item.status}" role="img" aria-label="${esc(statusLabel(item.status))}"></span></span>${weekView && item.note.trim() ? `<span class="agenda-chip-note">${esc(item.note)}</span>` : ""}${item.allDay || item.end ? `<span class="agenda-resize-handle" data-agenda-resize="end" aria-hidden="true" title="${esc(t("resizeEnd"))}"></span>` : ""}</button>`;
  }
  const agendaLayout = WorkTimeApp.ui.createAgendaLayout({
    calendar,
    getState: () => ({
      active,
      weeks: weekView,
      items: model.state.agenda || [],
      transitioning: !!weekTransition,
      busy,
      switching: switchingMode,
      moving: movingAgenda,
      completing: !!completingAgenda,
    }),
    chip: chipMarkup,
    updateCompletion,
    takeChip: (item) => transferChips.get(item.id),
    edit,
    select,
    moreLabel: (count) => t("more", { count }),
  });
  agendaDrag = WorkTimeApp.ui.createAgendaDrag({
    calendar,
    getState: () => ({
      active,
      busy,
      readOnly: model.loadIssue === "unsupported",
      transitioning: !!weekTransition,
      draft: hasDraft(),
      items: model.state.agenda || [],
    }),
    settle() {
      stopIncoming();
      actions.finishCalendarNavigation();
      agendaLayout.stop();
      motion?.stop(calendar);
      for (const node of calendar.querySelectorAll(
        ".agenda-card-items, .agenda-lane-content, .day.motion-selection",
      ))
        motion?.stop(node);
    },
    notify(text) {
      $("agendaStatus").textContent = text;
    },
    moreLabel: (count) => t("more", { count }),
    async save(item, target) {
      movingAgenda = true;
      try {
        const candidate = { ...item, updatedAt: new Date().toISOString() };
        if (!(await perform(() => application.saveAgenda(candidate))))
          return false;
        model.selected = model.calendarSelected = target;
        openForm();
        reset(candidate);
        actions.render();
        const button = [...calendar.querySelectorAll(".agenda-chip")].find(
          (node) =>
            node.dataset.agendaEdit === item.id && node.getClientRects().length,
        );
        button?.focus({ preventScroll: true });
        // The drag controller owns release-to-destination motion and handoff.
        return true;
      } finally {
        movingAgenda = false;
      }
    },
  });
  function updateBrand(agendaMode) {
    const subtitle = document.querySelector(".sidebar-brand-subtitle");
    const key = model.analysisMode
      ? "analysis.toggle"
      : agendaMode
        ? "agenda.brand"
        : "short.brand";
    const titleKey = model.analysisMode || agendaMode ? key : "copy.5754e634a8";
    // This shared rolling view owns the text; locale renders must not replace it.
    subtitle.removeAttribute("data-i18n-text");
    subtitle.setAttribute("data-i18n-title", titleKey);
    WorkTimeApp.ui.numbers.set(subtitle, WorkTimeApp.i18n.t(key), {
      animateWhole: true,
      animateInitial: false,
      motion: canAnimate(),
    });
    subtitle.title = WorkTimeApp.i18n.t(titleKey);
  }
  function updateOaActions(target = active) {
    if (target && oaActions.contains(document.activeElement))
      $("agendaMode").focus({ preventScroll: true });
    oaActions.hidden = target;
    oaActions.inert = target;
    oaActions.setAttribute("aria-hidden", String(target));
  }
  function stopToolbarMotion() {
    viewIconAnimation?.cancel();
    viewIconAnimation = null;
    for (const animation of toolbarAnimations) animation.cancel();
    toolbarAnimations = [];
    toolbarClone?.remove();
    toolbarClone = null;
    toolbarRegion.style.removeProperty("width");
    toolbarRegion.style.removeProperty("margin-right");
    toolbarDivider.style.removeProperty("opacity");
    toolbarRegion.hidden = toolbarKey === "analysis";
  }
  function stopModesMotion() {
    for (const animation of modesAnimations) animation.cancel();
    modesAnimations = [];
    modesRegion.hidden = !!model.batchMode;
    modesRegion.style.removeProperty("width");
    modesRegion.style.removeProperty("margin-right");
    modes.style.removeProperty("opacity");
    modes.style.removeProperty("transform");
  }
  function renderModes() {
    const hidden = !!model.batchMode;
    if (modesHidden === hidden) return;
    const animate = modesHidden !== null && canAnimate();
    const width = modesRegion.getBoundingClientRect().width;
    const margin = getComputedStyle(modesRegion).marginRight;
    const painted = getComputedStyle(modes);
    const from = { opacity: painted.opacity, transform: painted.transform };
    for (const animation of modesAnimations) animation.cancel();
    modesAnimations = [];
    modesHidden = hidden;
    modesRegion.inert = hidden;
    modesRegion.setAttribute("aria-hidden", String(hidden));
    modesRegion.hidden = false;
    modesRegion.style.removeProperty("width");
    modesRegion.style.removeProperty("margin-right");
    modes.style.removeProperty("opacity");
    modes.style.removeProperty("transform");
    const expandedWidth = modesRegion.getBoundingClientRect().width;
    if (!animate) {
      modesRegion.hidden = hidden;
      return;
    }
    const gap =
      parseFloat(getComputedStyle(modesRegion.parentElement).columnGap) || 0;
    modesRegion.style.width = hidden ? "0px" : expandedWidth + "px";
    modesRegion.style.marginRight = hidden ? -gap + "px" : "0px";
    modes.style.opacity = hidden ? "0" : "1";
    modes.style.transform = hidden ? "translateX(-8px)" : "none";
    const startTime = document.timeline?.currentTime;
    const animations = [
      animationCompat.animate(
        modes,
        [
          width ? from : { opacity: 0, transform: "translateX(-8px)" },
          { opacity: modes.style.opacity, transform: modes.style.transform },
        ],
        {
          duration: hidden ? 160 : 200,
          delay: hidden ? 0 : 40,
          easing: hidden
            ? "cubic-bezier(0.4, 0, 0.8, 1)"
            : "cubic-bezier(0.2, 0.65, 0.3, 1)",
          fill: "both",
        },
        startTime,
      ),
      animationCompat.animate(
        modesRegion,
        [
          { width: width + "px", marginRight: width ? margin : -gap + "px" },
          {
            width: modesRegion.style.width,
            marginRight: modesRegion.style.marginRight,
          },
        ],
        {
          duration: 200,
          delay: hidden ? 160 : 0,
          easing: "cubic-bezier(0.2, 0.65, 0.3, 1)",
          fill: "both",
        },
        startTime,
      ),
      animationCompat.animate(
        modesDivider,
        [{ opacity: hidden ? 1 : 0 }, { opacity: hidden ? 0 : 1 }],
        {
          duration: 160,
          delay: hidden ? 160 : 40,
          easing: "ease-out",
          fill: "both",
        },
        startTime,
      ),
    ];
    modesAnimations = animations;
    Promise.all(animations.map((animation) => animation.finished)).then(() => {
      if (modesAnimations !== animations) return;
      stopModesMotion();
    });
  }
  function renderToolbar() {
    renderModes();
    const viewNames = [
      "monthView",
      "weekView",
      "fortnightView",
      "threeWeekView",
    ];
    const mode = model.analysisMode
      ? "analysis"
      : active
        ? "agenda"
        : "attendance";
    const key = mode;
    const changed = toolbarKey !== null && toolbarKey !== key;
    const incoming =
      mode === "analysis" ? null : active ? viewToggle : $("batchToggle");
    const animate = changed && canAnimate();
    const regionWidth = animate
      ? toolbarRegion.getBoundingClientRect().width
      : 0;
    const regionMargin = animate
      ? getComputedStyle(toolbarRegion).marginRight
      : "0px";
    const dividerOpacity = animate
      ? getComputedStyle(toolbarDivider).opacity
      : "1";
    const candidates = animate
      ? [...toolbarSlot.children].filter((node) => !node.hidden)
      : [];
    const source = (node) => node.dataset.toolbarSource || node.id;
    const visible = (nodes) =>
      nodes.sort(
        (a, b) =>
          Number(getComputedStyle(b).opacity) -
          Number(getComputedStyle(a).opacity),
      )[0];
    const old = visible(candidates.filter((node) => source(node) !== key));
    const continuing = visible(
      candidates.filter((node) => source(node) === key),
    );
    const incomingStyle = continuing && getComputedStyle(continuing);
    const incomingPainted = incomingStyle &&
      Number(incomingStyle.opacity) > 0.001 && {
        opacity: incomingStyle.opacity,
        transform: incomingStyle.transform,
      };
    let snapshot = null;
    let painted = null;
    if (
      animate &&
      old?.getClientRects().length &&
      Number(getComputedStyle(old).opacity) > 0.001
    ) {
      const style = getComputedStyle(old);
      painted = { opacity: style.opacity, transform: style.transform };
      snapshot = old.cloneNode(true);
      for (const ghost of snapshot.querySelectorAll(".agenda-toolbar-outgoing"))
        ghost.remove();
      snapshot.style.width = old.getBoundingClientRect().width + "px";
      snapshot.style.height = old.getBoundingClientRect().height + "px";
      for (const property of [
        "color",
        "background-color",
        "border-color",
        "border-radius",
        "font",
        "padding",
      ])
        snapshot.style.setProperty(property, style.getPropertyValue(property));
      // The compatibility helper releases fill effects at native completion.
      // Keep the snapshot's underlying state invisible until it is removed.
      snapshot.style.opacity = "0";
      snapshot.style.transform = "translateX(8px)";
      for (const node of [snapshot, ...snapshot.querySelectorAll("*")]) {
        node.removeAttribute("id");
        for (const attribute of [...node.attributes])
          if (attribute.name.startsWith("data-"))
            node.removeAttribute(attribute.name);
      }
      snapshot.hidden = false;
      snapshot.dataset.toolbarSource = source(old);
      snapshot.inert = true;
      snapshot.setAttribute("aria-hidden", "true");
      snapshot.classList.add("agenda-toolbar-outgoing");
    }
    if (toolbarKey !== key) stopToolbarMotion();
    toolbarKey = key;
    if (incoming) incoming.dataset.toolbarSource = key;
    if (changed || !toolbarAnimations.length)
      toolbarRegion.hidden = key === "analysis";
    for (const button of [viewToggle, $("batchToggle")]) {
      const hidden = button !== incoming;
      if (hidden && button.contains(document.activeElement))
        $(key === "analysis" ? "analysisToggle" : "agendaMode").focus({
          preventScroll: true,
        });
      button.hidden = hidden;
    }
    viewToggle.dataset.view = ["month", "week", "fortnight", "threeweek"][
      weekView
    ];
    viewToggle.dataset.agendaView = String(weekView);
    const icon = viewToggle.querySelector("svg");
    const use = icon.querySelector("use");
    const iconHref = [
      "#ms-calendar-month",
      "#ms-view-week",
      "#ms-calendar-view-month",
      "#ms-calendar-view-month",
    ][weekView];
    if (use.getAttribute("href") !== iconHref) {
      viewIconAnimation?.cancel();
      viewIconAnimation = null;
      use.setAttribute("href", iconHref);
      // The view button stays in place; only its new glyph is revealed.
      if (mode === "agenda" && !changed && canAnimate())
        viewIconAnimation = animationCompat.animate(
          icon,
          [
            { opacity: 0.35, transform: "scale(0.8)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          { duration: 180, easing: "ease-out", fill: "both" },
        );
    }
    viewToggle.title =
      t(viewNames[weekView]) +
      " · " +
      t("switchView", {
        view: t(viewNames[(weekView + 1) % 4]),
      });
    viewToggle.setAttribute("aria-label", viewToggle.title);
    viewToggle.disabled = busy;
    if (!animate) return;
    toolbarRegion.hidden = false;
    const expandedWidth = toolbarRegion.getBoundingClientRect().width;
    const gap =
      parseFloat(getComputedStyle(toolbarRegion.parentElement).columnGap) || 0;
    const startTime = document.timeline?.currentTime;
    const animations = [];
    if (snapshot) {
      toolbarClone = snapshot;
      toolbarSlot.append(snapshot);
      animations.push(
        animationCompat.animate(
          snapshot,
          [
            painted,
            {
              opacity: Number(painted.opacity) * 0.85,
              transform: "translateX(4px)",
              offset: 0.5,
            },
            { opacity: 0, transform: "translateX(8px)" },
          ],
          {
            duration: 160,
            easing: "cubic-bezier(0.4, 0, 0.8, 1)",
            fill: "both",
          },
          startTime,
        ),
      );
    }
    // Switching between attendance and agenda gets a short empty beat.
    const replacementPause =
      snapshot &&
      incoming &&
      (source(snapshot) === "attendance" || key === "attendance")
        ? 80
        : 0;
    if (incoming)
      animations.push(
        animationCompat.animate(
          incoming,
          [
            (!snapshot && incomingPainted) || {
              opacity: 0,
              transform: "translateX(8px)",
            },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: 200,
            // Finish the previous button's exit before revealing its replacement.
            delay: snapshot ? 160 + replacementPause : incomingPainted ? 0 : 40,
            easing: "cubic-bezier(0.2, 0.65, 0.3, 1)",
            fill: "both",
          },
          startTime,
        ),
      );
    // Include the outer flex gap in the collapse, keeping the permanent actions anchored.
    if (key === "analysis" || regionWidth !== expandedWidth) {
      toolbarRegion.style.width =
        key === "analysis" ? "0px" : expandedWidth + "px";
      toolbarRegion.style.marginRight =
        key === "analysis" ? -gap + "px" : "0px";
      toolbarDivider.style.opacity = key === "analysis" ? "0" : "1";
      animations.push(
        animationCompat.animate(
          toolbarRegion,
          [
            {
              width: regionWidth + "px",
              marginRight: regionWidth ? regionMargin : -gap + "px",
            },
            {
              width: toolbarRegion.style.width,
              marginRight: toolbarRegion.style.marginRight,
            },
          ],
          {
            duration: 200,
            delay: key === "analysis" ? 160 : 0,
            easing: "cubic-bezier(0.2, 0.65, 0.3, 1)",
            fill: "both",
          },
          startTime,
        ),
      );
      animations.push(
        animationCompat.animate(
          toolbarDivider,
          [
            { opacity: regionWidth ? dividerOpacity : "0" },
            { opacity: toolbarDivider.style.opacity },
          ],
          {
            duration: 160,
            delay: key === "analysis" ? 160 : 40,
            easing: "ease-out",
            fill: "both",
          },
          startTime,
        ),
      );
    }
    toolbarAnimations = animations;
    Promise.all(animations.map((animation) => animation.finished)).then(() => {
      if (toolbarAnimations === animations) stopToolbarMotion();
    });
  }
  function render() {
    if (disposed) return;
    if (!model.analysisMode) analysisReturnAgenda = false;
    rememberView();
    renderToolbar();
    updateOaActions();
    if (!active || busy) {
      closeStatusMenu();
      schedule.close();
    }
    schedule.render();
    renderMemo();
    updateBrand(active);
    modes.setAttribute(
      "aria-label",
      t("agenda") + " / " + WorkTimeApp.i18n.t("analysis.toggle"),
    );
    finishWeekTransition();
    workspace.classList.toggle("agenda-mode", active);
    pane.hidden = summary.hidden = !active;
    const todayKey =
      active && weekView ? "agenda.todayWeek" : "copy.323a7e0872";
    for (const attribute of ["title", "aria-label"]) {
      $("todayButton").setAttribute(attribute, WorkTimeApp.i18n.t(todayKey));
      $("todayButton").setAttribute("data-i18n-" + attribute, todayKey);
    }
    applyWeekLayout();
    updateWeekLabel();
    controls.hidden = !active;
    for (const node of controls.querySelectorAll("[data-agenda-text]"))
      node.textContent = t(node.dataset.agendaText);
    syncOverviewHost();
    overviewDialog.setAttribute("aria-label", t("overviewMemo"));
    overviewDialog.querySelector("h2").textContent = t("overviewMemo");
    $("agendaOverviewClose").textContent = t("pickerClose");
    drawerGrip.setAttribute("aria-label", t("pickerClose"));
    setAuxiliary(auxiliaryOpen);
    pane.querySelector(".agenda-editor-body").hidden = !formOpen;
    $("agendaDayDetails").hidden = formOpen;
    pane.querySelector(".agenda-day-toolbar").hidden = !formOpen;
    pane.querySelector(".agenda-editor-footer").hidden = !formOpen;
    $("agendaBack").hidden = !formOpen;
    $("agendaBack").title = t("backToList");
    $("agendaBack").setAttribute("aria-label", t("backToList"));
    $("agendaFormTitle").textContent = t(editingId ? "edit" : "new");
    for (const node of modes.querySelectorAll("[data-agenda-text]"))
      node.textContent = t(node.dataset.agendaText);
    $("agendaMode").title = t(active ? "attendance" : "agenda");
    $("agendaMode").setAttribute("aria-label", $("agendaMode").title);
    $("agendaMode").setAttribute("aria-pressed", String(active));
    $("agendaMode").disabled = model.batchMode;
    $("agendaNew").title = t("new");
    $("agendaNew").setAttribute("aria-label", t("new"));
    $("agendaNew").disabled = busy || model.loadIssue === "unsupported";
    $("agendaBack").disabled = busy;
    if (!active) {
      agendaLayout.render();
      return;
    }
    for (const node of pane.querySelectorAll("[data-agenda-text]"))
      node.textContent = t(node.dataset.agendaText);
    for (const option of $("agendaItemStatus").options)
      option.textContent = statusLabel(option.value);
    $("agendaFormTitle").textContent = t(editingId ? "edit" : "new");
    const dateMarkup = WorkTimeApp.ui.headerDateMarkup(model.selected, esc);
    if (dateMarkup !== renderedDateHeader) {
      $("agendaDate").innerHTML = dateMarkup;
      renderedDateHeader = dateMarkup;
    }
    $("agendaFields").disabled = busy || model.loadIssue === "unsupported";
    const items = model.state.agenda || [];
    const addedIds = new Set(
      items
        .filter((item) => !renderedAgendaIds.has(item.id))
        .map((item) => item.id),
    );
    const nextAgendaIds = new Set(items.map((item) => item.id));
    const removedSelector = [...renderedAgendaIds]
      .filter((id) => !nextAgendaIds.has(id))
      .map((id) => `.agenda-chip[data-agenda-edit="${CSS.escape(id)}"]`)
      .join(",");
    renderedAgendaIds = nextAgendaIds;
    const cards = [
      ...calendar.querySelectorAll(".day[data-date], .day[data-preview-date]"),
    ];
    const datesKey = [model.selected, ...cards.map(cardDate)].join(",");
    if (items !== dateItemsSource || datesKey !== dateItemsKey) {
      dateItems = rules.forDates(items, [
        model.selected,
        ...cards.map(cardDate),
      ]);
      dateItemsSource = items;
      dateItemsKey = datesKey;
    }
    const selectedItems = dateItems.get(model.selected);
    $("agendaDayDetails").setAttribute(
      "aria-label",
      WorkTimeApp.i18n.date(model.selected) + " · " + t("agenda"),
    );
    updateMarkup(
      $("agendaList"),
      selectedItems.map(entry).join("") ||
        `<div class="agenda-empty"><svg class="ui-icon" aria-hidden="true"><use href="#ms-event-note"/></svg><p>${esc(t("empty"))}</p><button type="button" class="ui-button" data-agenda-create>${esc(t("new"))}</button></div>`,
    );
    // Decorate the existing keyed day cards; the calendar owns dates, headers,
    // selection, adjacent days, weather layers and responsive grid geometry.
    const useLanes =
      weekView > 0 || items.some((item) => rules.lastDate(item) > item.date);
    transferChips.clear();
    if (
      movingAgenda &&
      useLanes !== calendar.classList.contains("agenda-lane-view")
    ) {
      for (const node of calendar.querySelectorAll(
        ".agenda-chip:not(.continues-before):not(.continues-after)",
      )) {
        const item = items.find((item) => item.id === node.dataset.agendaEdit);
        if (!item) continue;
        transferChips.set(item.id, node);
        const template = document.createElement("template");
        template.innerHTML = chipMarkup(item);
        chipSignatures.set(node, template.content.firstElementChild.outerHTML);
      }
    }
    const visibleDates = new Set(cards.map(cardDate));
    for (const date of renderedContents.keys())
      if (!visibleDates.has(date)) renderedContents.delete(date);
    for (const card of cards) {
      const date = cardDate(card);
      const entries = dateItems.get(date);
      let host = card.querySelector(".agenda-card-items");
      if (!host) {
        host = document.createElement("div");
        host.className = "agenda-card-items";
        card.append(host);
      }
      const html = useLanes
        ? ""
        : entries.map(chipMarkup).join("") +
          (!weekView && entries.length
            ? `<button type="button" class="agenda-more" data-agenda-date="${date}" hidden>${esc(WorkTimeApp.i18n.number(entries.length))}+</button>`
            : "");
      const previous = renderedContents.get(date);
      const changed =
        previous !== undefined &&
        previous !== html &&
        addedIds.size > 0 &&
        !switchingMode &&
        !movingAgenda &&
        !completingAgenda;
      const removed =
        removedSelector && !switchingMode && !movingAgenda
          ? captureContent(card, removedSelector)
          : [];
      if (previous !== html || !host.childElementCount)
        updateMarkup(host, html);
      renderedContents.set(date, html);
      if (!observedHosts.has(host)) {
        observedHosts.add(host);
        contentObserver.observe(host);
      }
      if (changed)
        for (const chip of host.querySelectorAll(".agenda-chip"))
          if (addedIds.has(chip.dataset.agendaEdit)) revealIncoming(chip);
      if (removed.length) revealContent(card, removed, 0, []);
    }
    for (const host of observedHosts) {
      if (!calendar.contains(host)) {
        contentObserver.unobserve(host);
        observedHosts.delete(host);
      }
    }
    if (!preparingWeekLayout) {
      agendaLayout.render();
      fitMonthCards();
    }
    // Lane geometry is cached, so selection must also update retained segments.
    for (const chip of calendar.querySelectorAll(".agenda-chip")) {
      const selected = formOpen && chip.dataset.agendaEdit === editingId;
      chip.classList.toggle("is-selected", selected);
      chip.setAttribute("aria-current", String(selected));
    }
    transferChips.clear();
    const dates = weekDates();
    $("calendarFoot").textContent = weekView
      ? t("weekCount", {
          start: WorkTimeApp.i18n.date(dates[0]),
          end: WorkTimeApp.i18n.date(dates[dates.length - 1]),
          count: items.filter((item) =>
            rules.overlaps(item, dates[0], dates[dates.length - 1]),
          ).length,
        })
      : t("monthCount", {
          count: items.filter((item) =>
            rules.overlaps(item, model.month + "-01", model.month + "-31"),
          ).length,
        });
    for (const [id, key] of [
      ["prevMonth", "prevWeek"],
      ["nextMonth", "nextWeek"],
    ]) {
      const label = weekView
        ? t(key)
        : WorkTimeApp.i18n.t(
            id === "prevMonth" ? "copy.69bb1687b5" : "copy.8c9b38e26d",
          );
      $(id).setAttribute("aria-label", label);
    }
    $("monthTitle").tabIndex = -1;
    $("monthTitle").setAttribute("aria-disabled", "true");
    $("monthTitle").setAttribute(
      "aria-label",
      t("agenda") + (weekLabelText ? " " + weekLabelText : ""),
    );
    $("analysisToggle").disabled = busy;
    $("batchToggle").disabled = true;
    // Global pending groups are independent of the currently selected day.
    const otherPending = items
      .filter((item) => ["pending", "in-progress"].includes(item.status))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          Number(b.allDay) - Number(a.allDay) ||
          a.start.localeCompare(b.start) ||
          a.createdAt.localeCompare(b.createdAt),
      );
    const groups = [
      [
        "overdue",
        otherPending.filter((item) => rules.lastDate(item) < model.today),
      ],
      [
        "today",
        otherPending.filter((item) =>
          rules.overlaps(item, model.today, model.today),
        ),
      ],
      ["upcoming", otherPending.filter((item) => item.date > model.today)],
    ].filter(([, list]) => list.length);
    updateMarkup(
      $("agendaOverview"),
      `<h2>${esc(t("pendingOverview"))}</h2>` +
        (groups
          .map(
            ([key, list]) =>
              `<section class="agenda-overview-section agenda-overview-${key}"><h3>${esc(t(key))} <span class="agenda-count">${list.length}</span></h3><div class="agenda-overview-items">${list
                .slice(0, expandedGroups.has(key) ? list.length : 3)
                .map(
                  (item) =>
                    `<button type="button" class="agenda-summary-link" data-agenda-jump="${esc(item.id)}"><span>${esc(item.title)}</span><small>${esc((item.endDate ?? item.date) > item.date ? labelTime(item) : WorkTimeApp.i18n.date(item.date) + " · " + labelTime(item))}</small></button>`,
                )
                .join(
                  "",
                )}</div>${list.length > 3 ? `<button type="button" class="ui-button agenda-expand" data-agenda-expand="${key}" aria-expanded="${expandedGroups.has(key)}">${esc(t(expandedGroups.has(key) ? "showLess" : "showAll", { count: list.length }))}</button>` : ""}</section>`,
          )
          .join("") ||
          `<p class="agenda-overview-empty">${esc(t("pendingEmpty"))}</p>`),
    );
    times();
    agendaDrag?.refresh();
  }
  function select(
    date,
    keepEditor = false,
    navigate = false,
    retainSelection = false,
  ) {
    if (!keepEditor && !leaveForm()) return;
    if (!keepEditor && date !== model.selected) listScroll = 0;
    agendaDrag?.cancel();
    finishWeekNavigation();
    const inRange =
      active &&
      !navigate &&
      (weekView
        ? weekDates().includes(date)
        : dayCards().some((card) => cardDate(card) === date));
    if (!inRange && !navigate && !keepEditor) {
      navigateAgenda(date, false);
      return;
    }
    if (!inRange) {
      model.agendaViewAnchor = date;
      model.month = date.slice(0, 7);
    }
    if (navigate && retainSelection)
      actions.retainCalendarSelection(weekView ? weekDates() : null, date);
    else model.selected = model.calendarSelected = date;
    if (!hasDraft() && !keepEditor) reset();
    actions.render();
  }
  function edit(id, date = null) {
    const item = (model.state.agenda || []).find((entry) => entry.id === id);
    if (!item || busy) return;
    if (hasDraft() && !window.confirm(t("discard"))) return;
    openForm();
    reset(item);
    if (date || rules.overlaps(item, model.selected, model.selected)) {
      if (date) model.selected = model.calendarSelected = date;
      actions.render();
    } else select(item.date, true);
    // Editing an event already highlights its strip. The calendar's temporary
    // date-selection outline would otherwise flash before returning to hover.
    for (const card of calendar.querySelectorAll(".day.motion-selection"))
      motion?.stop(card);
    const behavior = canAnimate() ? "smooth" : "instant";
    pane
      .querySelector(".agenda-editor-body")
      .scrollTo({ top: 0, left: 0, behavior });
    if (window.innerWidth <= 1150)
      pane.scrollIntoView({ block: "start", behavior });
    $("agendaTitle").focus({ preventScroll: true });
  }
  async function perform(operation) {
    if (busy) return false;
    $("agendaError").textContent = "";
    $("agendaStatus").textContent = "";
    busy = true;
    render();
    try {
      const result = await operation();
      if (disposed) return false;
      if (!result.persisted) throw Error(t("saveFailed"));
      $("agendaStatus").textContent = t("saved");
      return true;
    } catch {
      if (!disposed) $("agendaError").textContent = t("saveFailed");
      return false;
    } finally {
      busy = false;
      if (!disposed) actions.render();
    }
  }
  async function click(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled || busy) return;
    if (button.hasAttribute("data-agenda-create")) $("agendaNew").click();
    if (button.dataset.agendaExpand) {
      const key = button.dataset.agendaExpand;
      if (expandedGroups.has(key)) expandedGroups.delete(key);
      else expandedGroups.add(key);
      actions.render();
      summary
        .querySelector(`[data-agenda-expand="${key}"]`)
        ?.focus({ preventScroll: true });
    }
    if (button.dataset.agendaDate) select(button.dataset.agendaDate);
    if (button.dataset.agendaEdit) edit(button.dataset.agendaEdit);
    if (button.dataset.agendaJump) edit(button.dataset.agendaJump);
    if (button.dataset.agendaStatus) {
      openStatusMenu(button);
      return;
    }
    if (button.dataset.agendaStatusChoice) {
      const id = statusMenu.dataset.agendaId;
      const item = (model.state.agenda || []).find((entry) => entry.id === id);
      const status = button.dataset.agendaStatusChoice;
      closeStatusMenu(true);
      if (!item || item.status === status) return;
      completingAgenda = item.id;
      try {
        await perform(() =>
          application.saveAgenda({
            ...item,
            status,
            updatedAt: new Date().toISOString(),
          }),
        );
      } finally {
        completingAgenda = null;
        pane
          .querySelector(`[data-agenda-status="${CSS.escape(item.id)}"]`)
          ?.focus({ preventScroll: true });
      }
      return;
    }
    const id = button.dataset.agendaDelete;
    const item = (model.state.agenda || []).find((entry) => entry.id === id);
    if (!item) return;
    if (window.confirm(t("confirmDelete", { title: item.title }))) {
      if (editingId === item.id && hasDraft() && !window.confirm(t("discard")))
        return;
      if (await perform(() => application.removeAgenda(item.id))) {
        if (editingId === item.id) reset();
      }
    }
  }
  function setActive(value) {
    agendaDrag?.cancel();
    active = value;
    if (active) {
      model.agendaViewAnchor = model.selected;
      model.month = model.selected.slice(0, 7);
    }
    model.agendaViewWeeks = active ? weekView : 0;
  }
  function bind() {
    reset();
    const listen = (node, name, callback, options = {}) =>
      node.addEventListener(name, callback, {
        ...options,
        signal: scope.signal,
      });
    listen($("agendaMemo"), "input", () => {
      memoDirty = true;
      void saveMemo();
    });
    listen($("agendaMemoRetry"), "click", () => void saveMemo());
    listen($("agendaMode"), "click", () => {
      if (model.batchMode || busy || !leaveForm()) return;
      const weekLayout =
        weekView && !model.yearMode && !model.analysisMode
          ? captureWeekLayout()
          : null;
      stopIncoming();
      finishWeekNavigation();
      finishWeekTransition();
      stopSidebarMotion();
      actions.finishCalendarNavigation();
      if (model.analysisMode) {
        finishTransitions();
        actions.transitionAnalysis(
          false,
          () => setActive(true),
          revealSidebars,
        );
        return;
      }
      const snapshots = new Map(
        [...calendar.querySelectorAll(".day[data-date]")].map((card) => [
          card.dataset.date,
          captureContent(card),
        ]),
      );
      const laneSnapshots = captureContent(
        calendar,
        ":scope > .agenda-week-layers:not(.agenda-content-outgoing)",
      );
      setActive(!active);
      model.yearMode = model.analysisMode = false;
      model.month = model.selected.slice(0, 7);
      switchingMode = true;
      preparingWeekLayout = !!weekLayout;
      try {
        actions.render();
      } finally {
        switchingMode = false;
        preparingWeekLayout = false;
      }
      const reveals = [...calendar.querySelectorAll(".day[data-date]")].map(
        (card) => ({ card, elements: visibleContent(card) }),
      );
      for (const { card, elements } of reveals)
        revealContent(
          card,
          snapshots.get(card.dataset.date) || [],
          active || laneSnapshots.length ? 120 : undefined,
          elements,
        );
      revealContent(calendar, laneSnapshots);
      if (weekLayout) animateWeekLayout(weekLayout);
      if (active && !weekLayout)
        revealIncoming(calendar.querySelector(".agenda-week-layers"), 120);
      revealSidebars();
    });
    listen(
      document.querySelector(".panel-head"),
      "click",
      (event) => {
        const id = event.target.closest("button,[role=button]")?.id;
        if (
          model.analysisMode &&
          analysisReturnAgenda &&
          id === "analysisToggle"
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          actions.transitionAnalysis(
            false,
            () => setActive(true),
            revealSidebars,
          );
          return;
        }
        if (!active) return;
        if (
          ![
            "prevMonth",
            "nextMonth",
            "todayButton",
            "monthTitle",
            "analysisToggle",
            "batchToggle",
          ].includes(id)
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (id === "analysisToggle") {
          if (busy || !leaveForm()) return;
          finishTransitions();
          actions.transitionAnalysis(
            true,
            () => {
              analysisReturnAgenda = true;
              setActive(false);
            },
            revealSidebars,
          );
          return;
        }
        if (
          busy ||
          ["monthTitle", "analysisToggle", "batchToggle"].includes(id)
        )
          return;
        if (id === "todayButton") {
          if (!leaveForm()) return;
          model.today = clock.today();
          finishTransitions();
          actions.finishCalendarNavigation();
          select(model.today);
          motion?.stop(calendar.querySelector(".selected"));
          actions.highlightToday();
        } else if (weekView) {
          const next = WorkTimeApp.domain.time.localDate(
            model.agendaViewAnchor,
          );
          next.setDate(next.getDate() + (id === "nextMonth" ? 7 : -7));
          const date = WorkTimeApp.domain.time.dateKey(next);
          if (WorkTimeApp.domain.time.validDate(date)) navigateAgenda(date);
        } else {
          const [year, month] = model.month.split("-").map(Number);
          const next = new Date(
            year,
            month - 1 + (id === "nextMonth" ? 1 : -1),
            1,
          );
          const date = WorkTimeApp.domain.time.dateKey(next);
          if (WorkTimeApp.domain.time.validDate(date)) navigateAgenda(date);
        }
      },
      { capture: true },
    );
    listen(
      calendar,
      "click",
      (event) => {
        if (!active) return;
        const card = event.target.closest(
          ".day[data-date], .day[data-preview-date]",
        );
        const button = event.target.closest("button");
        if (!card) return;
        event.stopImmediatePropagation();
        if (busy) return;
        if (button?.dataset.agendaEdit) edit(button.dataset.agendaEdit);
        else if (button?.dataset.agendaDate) select(button.dataset.agendaDate);
        else select(cardDate(card));
      },
      { capture: true },
    );
    for (const node of [pane, summary]) listen(node, "click", click);
    listen(statusMenu, "click", (event) => {
      event.stopPropagation();
      void click(event);
    });
    listen(viewToggle, "click", () => switchWeek((weekView + 1) % 4));
    listen(window, "resize", () => {
      syncOverviewHost();
      settleDrawer();
    });
    listen(document, "visibilitychange", () => {
      if (document.hidden) settleDrawer();
    });
    listen($("agendaOverviewOpen"), "click", () => {
      syncOverviewHost();
      overviewDialog.showModal();
      $("agendaMemo").focus();
    });
    listen($("agendaOverviewClose"), "click", () => overviewDialog.close());
    listen(drawerGrip, "click", () => {
      setAuxiliary(false);
      editor
        .querySelector(`.notification-tab[data-tab="${drawerTab}"]`)
        ?.focus({ preventScroll: true });
    });
    listen(overviewDialog, "close", () => {
      if (active && window.innerWidth <= 1150 && !formOpen)
        $("agendaOverviewOpen").focus({ preventScroll: true });
    });
    listen(editor.querySelector(".notification-tabs"), "click", (event) => {
      const tab = event.target.closest(".notification-tab");
      if (!active || !tab) return;
      const close = auxiliaryOpen && drawerTab === tab.dataset.tab;
      drawerTab = tab.dataset.tab;
      setAuxiliary(!close);
    });
    listen(
      document,
      "click",
      (event) => {
        if (!active || !auxiliaryOpen) return;
        const target = event.target;
        if (
          !auxiliaryArea.contains(target) &&
          !editor.querySelector(".notification-tabs").contains(target)
        )
          setAuxiliary(false);
      },
      { capture: true },
    );
    listen(auxiliaryArea, "keydown", (event) => {
      if (
        active &&
        auxiliaryOpen &&
        event.key === "Escape" &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        setAuxiliary(false);
        editor
          .querySelector(`[data-tab="${drawerTab}"]`)
          ?.focus({ preventScroll: true });
      }
    });
    listen($("agendaNew"), "click", () => {
      if (busy) return;
      if (!hasDraft() || window.confirm(t("discard"))) {
        openForm();
        reset();
        actions.render();
        $("agendaTitle").focus();
      }
    });
    listen($("agendaBack"), "click", returnToList);
    listen($("agendaCancel"), "click", returnToList);
    listen(pane, "keydown", (event) => {
      if (!formOpen || busy || event.isComposing || event.defaultPrevented)
        return;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (!$("agendaSave").disabled)
          $("agendaForm").requestSubmit($("agendaSave"));
      } else if (
        event.key === "Escape" &&
        !WorkTimeApp.ui.popover.anyOpen() &&
        event.target.tagName !== "SELECT"
      ) {
        event.preventDefault();
        returnToList();
      }
    });
    listen($("agendaForm"), "input", () => {
      $("agendaError").textContent = "";
      $("agendaStatus").textContent = "";
      times();
    });
    listen($("agendaForm"), "submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const old = (model.state.agenda || []).find(
        (item) => item.id === editingId,
      );
      const now = new Date().toISOString();
      const fields = values();
      const candidate = {
        ...old,
        ...fields,
        id: editingId || WorkTimeApp.services.archive.uuid(),
        start: fields.allDay ? "" : fields.start,
        end: fields.allDay ? "" : fields.end,
        completed: fields.status === "completed",
        createdAt: old?.createdAt || now,
        updatedAt: now,
      };
      try {
        rules.validate(candidate);
      } catch {
        $("agendaError").textContent = t("invalid");
        return;
      }
      const statusOnly =
        old &&
        Object.entries(fields).every(
          ([key, value]) => key === "status" || old[key] === value,
        );
      if (await perform(() => application.saveAgenda(candidate))) {
        reset();
        formOpen = false;
        if (rules.overlaps(candidate, model.selected, model.selected)) {
          model.calendarSelected = model.selected;
          actions.render();
        } else select(candidate.date);
        if (statusOnly)
          for (const chip of calendar.querySelectorAll(".agenda-chip"))
            if (chip.dataset.agendaEdit === candidate.id)
              for (const animation of chip.getAnimations())
                if ("transitionProperty" in animation) animation.finish();
        $("agendaList").scrollTop = listScroll;
        const savedEntry = returnFocus?.dataset.agendaEdit
          ? [...$("agendaList").querySelectorAll("[data-agenda-edit]")].find(
              (node) => node.dataset.agendaEdit === candidate.id,
            )
          : null;
        (savedEntry || $("agendaNew")).focus({ preventScroll: true });
      }
    });
    render();
  }
  return {
    bind,
    render,
    hasDraft: () => hasDraft() || memoDirty || memoSaving || agendaDrag?.active,
    async prepareAgendaArchive() {
      await saveMemo();
      if (memoDirty) throw Error(t("saveFailed"));
    },
    dispose() {
      disposed = true;
      agendaDrag.dispose();
      agendaLayout.dispose();
      schedule.dispose();
      statusPopover.destroy();
      updateBrand(false);
      contentObserver.disconnect();
      observedHosts.clear();
      finishTransitions();
      updateOaActions(false);
      unlistenMotion();
      scope.abort();
      noticeObserver.disconnect();
      modesObserver.disconnect();
      drawerAnimation?.cancel();
      drawerGeometry.disconnect();
      if (originalAreaTabIndex === null)
        auxiliaryArea.removeAttribute("tabindex");
      else auxiliaryArea.setAttribute("tabindex", originalAreaTabIndex);
      editor.style.removeProperty("--agenda-tabs-height");
      overviewDialog.close();
      editor.classList.remove(
        "agenda-auxiliary-open",
        "agenda-auxiliary-closing",
      );
      for (const tab of editor.querySelectorAll(".notification-tab"))
        tab.removeAttribute("aria-expanded");
      for (const animation of modesAnimations) animation.cancel();
      modesRegion.before($("analysisToggle"));
      toolbarRegion.before($("batchToggle"));
      $("batchToggle").hidden = false;
      for (const node of [
        modes,
        modesRegion,
        pane,
        summary,
        controls,
        viewToggle,
        toolbarSlot,
        toolbarDivider,
        toolbarRegion,
        overviewDialog,
        drawerGrip,
      ])
        node.remove();
      for (const host of calendar.querySelectorAll(".agenda-card-items"))
        host.remove();
      workspace.classList.remove("agenda-mode");
      weekLabelNode?.remove();
      $("monthTitle").classList.remove("has-week-label");
      $("monthTitle").style.removeProperty("--week-label-width");
      calendar.classList.remove("agenda-week-view");
      delete calendar.dataset.agendaRows;
      model.agendaViewWeeks = 0;
      for (const card of dayCards()) {
        card.removeAttribute("data-agenda-week");
        card.querySelector(".agenda-week-select")?.remove();
      }
    },
  };
};
