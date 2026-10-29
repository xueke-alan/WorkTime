"use strict";
/** Single-week surface. The backing calendar continues to own date headers. */
WorkTimeApp.ui.createAgendaTimetable = function ({
  calendar,
  getState,
  chip,
  create,
  edit,
  select,
  focusDraft,
  save,
  notify,
}) {
  const math = WorkTimeApp.ui.agendaTimelineMath;
  const rules = WorkTimeApp.domain.agenda;
  const t = (key) => WorkTimeApp.i18n.t("agenda." + key);
  const scope = new AbortController();
  const root = document.createElement("div");
  root.className = "agenda-timetable";
  let geometry = null,
    session = null,
    signature = "",
    frame = null,
    disposed = false;
  let timedScroll = 0;
  let contentHidden = false;
  let blockClick = false;
  let axisAnimations = [];
  let previewFrame = null,
    previewEvent = null;
  function stopPreview() {
    if (previewFrame !== null) cancelAnimationFrame(previewFrame);
    previewFrame = null;
    previewEvent = null;
  }
  function schedulePreview(event) {
    previewEvent = event;
    if (previewFrame !== null) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = null;
      const latest = previewEvent;
      previewEvent = null;
      if (session && !session.saving) preview(latest);
    });
  }
  function stopAxisMotion() {
    for (const animation of axisAnimations) animation.cancel();
    axisAnimations = [];
    root.classList.remove("is-axis-morphing");
    root
      .querySelectorAll(".timetable-axis-exit")
      .forEach((node) => node.remove());
  }
  function playAxisPlans(plans, retain = false) {
    if (!plans.length) return;
    root.classList.add("is-axis-morphing");
    const animations = WorkTimeApp.ui.motion.animateCalendar(plans);
    axisAnimations = retain ? axisAnimations.concat(animations) : animations;
    const current = axisAnimations;
    Promise.all(current.map((animation) => animation.finished)).then(() => {
      if (axisAnimations === current) stopAxisMotion();
    });
  }
  function captureAxisPaint() {
    return new Map(
      [...root.querySelectorAll("[data-axis-key]")].map((node) => {
        const style = getComputedStyle(node);
        return [
          node.closest(".timetable-column").dataset.timetableDate +
            ":" +
            node.dataset.axisKey,
          {
            top: style.top,
            height: style.height,
            left: style.left,
            width: style.width,
            opacity: style.opacity,
            clone: node.cloneNode(true),
            start: Number(node.dataset.axisStart),
            end: Number(node.dataset.axisEnd),
          },
        ];
      }),
    );
  }
  function reconcileSurface(candidate, keepExits, retargets) {
    const surface = [...root.children].find(
      (node) => node.dataset.timetableDate === candidate.dataset.timetableDate,
    );
    if (!surface) {
      root.append(candidate);
      return candidate;
    }
    const patch = (node, next) => {
      for (const attribute of [...node.attributes])
        if (!next.hasAttribute(attribute.name))
          node.removeAttribute(attribute.name);
      for (const attribute of next.attributes)
        if (node.getAttribute(attribute.name) !== attribute.value)
          node.setAttribute(attribute.name, attribute.value);
    };
    patch(surface, candidate);
    const scroll = surface.firstElementChild,
      nextScroll = candidate.firstElementChild;
    const grid = scroll.firstElementChild,
      nextGrid = nextScroll.firstElementChild;
    patch(scroll, nextScroll);
    patch(grid, nextGrid);
    const old = new Map(
      [...grid.querySelectorAll(":scope > [data-axis-key]")].map((node) => [
        node.dataset.axisKey,
        node,
      ]),
    );
    for (const [index, next] of [...nextGrid.children].entries()) {
      let node = old.get(next.dataset.axisKey);
      // Saving a new draft changes its identity but not its painted segment.
      if (!node && next.classList.contains("timetable-event"))
        node = [...old.values()].find(
          (item) =>
            item.classList.contains("timetable-draft") &&
            item.dataset.axisStart === next.dataset.axisStart &&
            item.dataset.axisEnd === next.dataset.axisEnd,
        );
      if (node) {
        old.delete(node.dataset.axisKey);
        const retarget =
          keepExits &&
          node.classList.contains("timetable-event") &&
          ["top", "height", "left", "width"].some(
            (key) => node.style[key] !== next.style[key],
          );
        const style = retarget ? getComputedStyle(node) : null;
        const from = style && {
          top: style.top,
          height: style.height,
          left: style.left,
          width: style.width,
          opacity: style.opacity,
        };
        patch(node, next);
        if (node.innerHTML !== next.innerHTML) node.innerHTML = next.innerHTML;
        if (retarget) {
          // Overlap columns may change without changing the time axis. Update
          // that chip's destination rather than restoring a stale fill effect.
          for (const animation of node.getAnimations()) animation.cancel();
          const target = getComputedStyle(node);
          const timing = WorkTimeApp.ui.motion.calendar;
          retargets.push({
            element: node,
            frames: [
              from,
              {
                top: target.top,
                height: target.height,
                left: target.left,
                width: target.width,
                opacity: target.opacity,
              },
            ],
            options: {
              duration: timing.contentDuration,
              easing: timing.easing,
              fill: "both",
            },
          });
        }
      } else node = next;
      if (grid.children[index] !== node)
        grid.insertBefore(node, grid.children[index] || null);
    }
    for (const node of old.values()) node.remove();
    if (!keepExits)
      grid
        .querySelectorAll(".timetable-axis-exit")
        .forEach((node) => node.remove());
    return surface;
  }
  function morphAxis(previous, paint) {
    const timing = WorkTimeApp.ui.motion.calendar;
    const options = {
      duration: timing.contentDuration,
      easing: timing.easing,
      fill: "both",
    };
    const plans = [];
    for (const column of geometry.columns) {
      for (const node of column.querySelectorAll("[data-axis-key]")) {
        const key = column.dataset.timetableDate + ":" + node.dataset.axisKey;
        const old = paint.get(key);
        paint.delete(key);
        const start = Number(node.dataset.axisStart),
          end = Number(node.dataset.axisEnd);
        const from = old
          ? {
              top: old.top,
              height: old.height,
              left: old.left,
              width: old.width,
              opacity: old.opacity,
            }
          : {
              top: previous.axis.y(start) + "px",
              height:
                Math.max(0, previous.axis.y(end) - previous.axis.y(start)) +
                "px",
              opacity: 0,
            };
        const style = getComputedStyle(node);
        plans.push({
          element: node,
          frames: [
            from,
            {
              top: style.top,
              height: style.height,
              left: style.left,
              width: style.width,
              opacity: 1,
            },
          ],
          options,
        });
      }
      // A compressed stripe expands and fades into the ordinary rest shading.
      for (const [key, old] of paint) {
        if (
          !key.startsWith(column.dataset.timetableDate + ":") ||
          !old.clone.classList.contains("timetable-break")
        )
          continue;
        const ghost = old.clone;
        ghost.classList.add("timetable-axis-exit");
        ghost.removeAttribute("data-axis-key");
        ghost.setAttribute("aria-hidden", "true");
        // Fill effects are released per track before collective cleanup. The
        // underlying paint must already match the invisible final geometry.
        const finalTop = geometry.axis.y(old.start) + "px";
        const finalHeight =
          Math.max(0, geometry.axis.y(old.end) - geometry.axis.y(old.start)) +
          "px";
        Object.assign(ghost.style, {
          top: finalTop,
          height: finalHeight,
          opacity: "0",
          pointerEvents: "none",
        });
        column.append(ghost);
        plans.push({
          element: ghost,
          frames: [
            { top: old.top, height: old.height, opacity: old.opacity },
            {
              top: finalTop,
              height: finalHeight,
              opacity: 0,
            },
          ],
          options,
        });
      }
    }
    playAxisPlans(plans);
  }
  const listen = (node, type, callback, options = {}) =>
    node.addEventListener(type, callback, { ...options, signal: scope.signal });
  const enabled = () => {
    const s = getState();
    return s.active && s.weeks === 1;
  };
  const available = (existingItem = false) => {
    const s = getState();
    if (!enabled() || s.busy || s.readOnly || s.transitioning) return false;
    if (s.draft && !existingItem) {
      notify(t("dragDraft"));
      return false;
    }
    return true;
  };
  function cancel() {
    stopPreview();
    if (!session) return;
    root.querySelectorAll(".timetable-preview").forEach((n) => n.remove());
    session.hint?.remove();
    restorePlacements();
    session = null;
    root.classList.remove("is-dragging");
    document.body.classList.remove("agenda-timetable-resizing");
    signature = "";
    requestRender();
  }
  function requestRender() {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      render();
    });
  }
  function makeChip(item) {
    const template = document.createElement("template");
    template.innerHTML = chip(item);
    const button = template.content.firstElementChild;
    button.querySelectorAll(".agenda-resize-handle").forEach((n) => n.remove());
    button.classList.add("timetable-event");
    button.dataset.timetableItem = item.id;
    if (item.draft) {
      button.classList.add("timetable-draft");
      button.removeAttribute("data-agenda-edit");
      button.tabIndex = -1;
    }
    return button;
  }
  function handle(button, edge) {
    const node = document.createElement("span");
    node.className = "timetable-resize timetable-resize-" + edge;
    node.dataset.timetableResize = edge;
    node.setAttribute("aria-hidden", "true");
    button.append(node);
  }
  function placeTimed(segment, parent, axis, preview = false) {
    const button = makeChip(segment.item);
    button.dataset.timetableDate = segment.date;
    button.classList.toggle("is-point", segment.end === null);
    button.classList.toggle("continues-before", segment.continuesBefore);
    button.classList.toggle("continues-after", segment.continuesAfter);
    const timeLabel = button.querySelector(".agenda-chip-time");
    if (timeLabel)
      timeLabel.textContent =
        (segment.continuesBefore ? "↳ " : "") +
        math.clock(segment.start) +
        (segment.end === null ? "" : "–" + math.clock(segment.end)) +
        (segment.continuesAfter ? " ↴" : "");
    const top = axis.y(segment.start);
    button.dataset.axisKey = "event:" + segment.item.id;
    button.dataset.axisStart = String(segment.start);
    button.dataset.axisEnd = String(segment.end ?? segment.start);
    Object.assign(button.style, {
      top: top + "px",
      height:
        (segment.end === null ? 18 : Math.max(1, axis.y(segment.end) - top)) +
        "px",
      left: `calc(${(100 * (segment.column || 0)) / (segment.columns || 1)}% + 2px)`,
      width: `calc(${100 / (segment.columns || 1)}% - 4px)`,
    });
    if (segment.end !== null && !segment.item.draft) {
      if (!segment.continuesBefore) handle(button, "start");
      if (!segment.continuesAfter) handle(button, "end");
    }
    if (preview) {
      button.classList.add("timetable-preview");
      button.removeAttribute("data-agenda-edit");
      button.tabIndex = -1;
    }
    parent.append(button);
  }
  function displayedItems(state = getState()) {
    const fields = state.newItem;
    if (
      !fields ||
      fields.allDay ||
      !WorkTimeApp.domain.time.validDate(fields.date) ||
      !fields.start ||
      !Number.isFinite(math.minute(fields.start))
    )
      return state.items;
    const item = {
      ...fields,
      id: "__agenda_timetable_draft__",
      title: fields.title.trim() || t("new"),
      note: fields.note || "",
      status: fields.status || "pending",
      draft: true,
    };
    if (
      fields.end &&
      (fields.endDate || fields.date) === fields.date &&
      fields.end <= fields.start
    )
      return state.items;
    return [...state.items, item];
  }
  function render() {
    if (disposed) return;
    const on = enabled();
    calendar.classList.toggle("agenda-dual-card-view", on);
    if (!on) {
      cancel();
      stopAxisMotion();
      root.remove();
      signature = "";
      calendar.style.removeProperty("--agenda-all-card-height");
      geometry = null;
      return;
    }
    if (session) return;
    const state = getState();
    const cards = [
      ...calendar.querySelectorAll(":scope > .day[data-agenda-week]"),
    ];
    if (!cards.length) {
      stopAxisMotion();
      geometry = null;
      signature = "";
      const empty = document.createElement("div");
      empty.className = "timetable-empty";
      empty.setAttribute("role", "status");
      empty.textContent = t("noWorkdays");
      root.replaceChildren(empty);
      calendar.append(root);
      return;
    }
    if (cards.length > 7) return;
    const dates = cards.map((c) => c.dataset.date || c.dataset.previewDate);
    const metrics = cards.map((card) => {
      const style = getComputedStyle(card);
      const head = card.querySelector(".daytop");
      return {
        card,
        left: card.offsetLeft,
        top: card.offsetTop,
        width: card.offsetWidth,
        headerHeight:
          head.offsetTop + head.offsetHeight + parseFloat(style.rowGap || "0"),
        paddingLeft: parseFloat(style.paddingLeft),
        paddingRight: parseFloat(style.paddingRight),
        paddingBottom: parseFloat(style.paddingBottom),
        radius: style.borderRadius,
        rest: card.classList.contains("restday"),
        daySurface: style.getPropertyValue("--day-surface").trim(),
        dayEdge: style.getPropertyValue("--day-edge").trim(),
      };
    });
    const nextSignature = JSON.stringify([
      dates,
      state.items,
      state.newItem,
      state.schedules,
      metrics.map(
        ({
          left,
          top,
          width,
          headerHeight,
          radius,
          rest,
          daySurface,
          dayEdge,
        }) => [
          left,
          top,
          width,
          headerHeight,
          radius,
          rest,
          daySurface,
          dayEdge,
        ],
      ),
      calendar.clientHeight,
      state.selectedId,
      state.selectedDate,
      WorkTimeApp.i18n.locale,
    ]);
    if (root.parentElement === calendar && signature === nextSignature) {
      calendar.style.setProperty(
        "--agenda-all-card-height",
        geometry.allHeight + "px",
      );
      return;
    }
    signature = nextSignature;
    const focusId = root.contains(document.activeElement)
      ? document.activeElement.dataset.agendaEdit
      : null;
    const previousGeometry = geometry;
    const previousPaint = captureAxisPaint();
    calendar.append(root);
    // Content density must never move the split when navigating weeks.
    const allHeight = 160;
    calendar.style.setProperty("--agenda-all-card-height", allHeight + "px");
    const gap = parseFloat(getComputedStyle(calendar).columnGap) || 7;
    const bottomTop = metrics[0].top + allHeight + gap;
    const bottomHeight = Math.max(
      80,
      calendar.clientHeight -
        parseFloat(getComputedStyle(calendar).paddingBottom) -
        bottomTop,
    );
    const segments = math.slice(displayedItems(state), dates);
    const padding = Math.max(...metrics.map((m) => m.paddingBottom));
    const height = Math.max(360, bottomHeight - 2 * padding - 2);
    const axis = math.axis(state.schedules, segments, height);
    const sameDates = previousGeometry?.dates.join() === dates.join();
    const changedAxis =
      !previousGeometry ||
      JSON.stringify(previousGeometry.axis.bands) !==
        JSON.stringify(axis.bands);
    const keepAxisMotion =
      sameDates && !changedAxis && axisAnimations.length > 0;
    if (!keepAxisMotion) stopAxisMotion();
    if (!sameDates) root.replaceChildren();
    const ticks = [
      ...new Set([
        axis.start,
        axis.end,
        ...state.schedules.flatMap((s) => [
          math.minute(s.workStart),
          math.minute(s.workEnd),
          ...s.breaks.flatMap((b) => [b.start, b.end]),
        ]),
        ...Array.from({ length: 25 }, (_, i) => i * 60),
      ]),
    ]
      .filter((m) => m >= axis.start && m <= axis.end)
      .sort((a, b) => a - b);
    const retargets = [];
    const columns = [],
      scrolls = [];
    for (let i = 0; i < dates.length; i++) {
      const m = metrics[i];
      const surface = document.createElement("div");
      surface.className = "timetable-bottom-card";
      surface.classList.toggle("is-selected", dates[i] === state.selectedDate);
      surface.classList.toggle("is-rest", m.rest);
      surface.classList.toggle("has-day-surface", !!m.daySurface);
      if (m.daySurface)
        surface.style.setProperty("--day-surface", m.daySurface);
      if (m.dayEdge) surface.style.setProperty("--day-edge", m.dayEdge);
      surface.dataset.timetableDate = dates[i];
      surface.setAttribute("role", "group");
      surface.setAttribute("aria-label", WorkTimeApp.i18n.date(dates[i]));
      Object.assign(surface.style, {
        left: m.left + "px",
        top: bottomTop + "px",
        width: m.width + "px",
        height: bottomHeight + "px",
        borderRadius: m.radius,
        padding:
          padding +
          "px " +
          m.paddingRight +
          "px " +
          padding +
          "px " +
          m.paddingLeft +
          "px",
      });
      const scroll = document.createElement("div");
      scroll.className = "timetable-scroll";
      scroll.style.opacity = contentHidden ? "0" : "1";
      scroll.tabIndex = 0;
      scroll.setAttribute("aria-label", WorkTimeApp.i18n.date(dates[i]));
      const grid = document.createElement("div");
      grid.className = "timetable-grid timetable-column";
      grid.dataset.timetableDate = dates[i];
      grid.style.height = height + "px";
      const schedule = state.schedules[i];
      for (const [a, b] of [
        [axis.start, math.minute(schedule.workStart)],
        ...schedule.breaks.map((r) => [r.start, r.end]),
        [math.minute(schedule.workEnd), axis.end],
      ]) {
        const start = Math.max(axis.start, a),
          end = Math.min(axis.end, b);
        if (end <= start) continue;
        const shade = document.createElement("div");
        shade.className = "timetable-offhours";
        shade.dataset.axisKey = "shade:" + a + ":" + b;
        shade.dataset.axisStart = String(start);
        shade.dataset.axisEnd = String(end);
        shade.style.top = axis.y(start) + "px";
        shade.style.height = axis.y(end) - axis.y(start) + "px";
        grid.append(shade);
      }
      for (const minute of ticks) {
        if (
          axis.bands.some(
            (b) => b.compressed && minute > b.start && minute < b.end,
          )
        )
          continue;
        const line = document.createElement("div");
        line.className = "timetable-rule";
        // Compressed breaks paint their own edges. Keep coordinate markers,
        // but do not paint a second grid stroke at either boundary.
        line.classList.toggle(
          "is-break-boundary",
          axis.bands.some(
            (band) =>
              band.compressed && (minute === band.start || minute === band.end),
          ),
        );
        line.dataset.minute = String(minute);
        line.dataset.axisKey = "rule:" + minute;
        line.dataset.axisStart = line.dataset.axisEnd = String(minute);
        line.style.top = axis.y(minute) + "px";
        grid.append(line);
      }
      for (const b of axis.bands.filter((b) => b.compressed)) {
        const rest = document.createElement("div");
        rest.className = "timetable-break";
        rest.dataset.axisKey = "break:" + b.start + ":" + b.end;
        rest.dataset.axisStart = String(b.start);
        rest.dataset.axisEnd = String(b.end);
        rest.style.top = b.top + "px";
        rest.style.height = b.height + "px";
        rest.title =
          t("timetableBreak") +
          " " +
          math.clock(b.start) +
          "–" +
          math.clock(b.end);
        rest.setAttribute("aria-label", rest.title);
        grid.append(rest);
      }
      for (const s of math.columns(segments.filter((s) => s.date === dates[i])))
        placeTimed(s, grid, axis);
      scroll.append(grid);
      surface.append(scroll);
      const retainedSurface = reconcileSurface(
        surface,
        keepAxisMotion,
        retargets,
      );
      const retainedScroll = retainedSurface.firstElementChild;
      retainedScroll.scrollTop = timedScroll;
      columns.push(retainedScroll.firstElementChild);
      scrolls.push(retainedScroll);
    }
    geometry = { dates, axis, columns, scrolls, cards, metrics, allHeight };
    if (
      previousGeometry &&
      !contentHidden &&
      !state.transitioning &&
      sameDates &&
      changedAxis &&
      !WorkTimeApp.ui.animationCompat.preference().matches
    )
      morphAxis(previousGeometry, previousPaint);
    else if (retargets.length) playAxisPlans(retargets, true);
    if (focusId)
      [...root.querySelectorAll("[data-agenda-edit]")]
        .find((b) => b.dataset.agendaEdit === focusId)
        ?.focus({ preventScroll: true });
  }
  function hit(event, allDay = false) {
    if (!geometry) return null;
    for (let index = 0; index < geometry.dates.length; index++) {
      const surface = allDay ? geometry.cards[index] : geometry.columns[index];
      const rect = surface.getBoundingClientRect();
      const clip = allDay
        ? rect
        : surface.parentElement.getBoundingClientRect();
      const header = allDay
        ? surface.querySelector(".daytop").getBoundingClientRect()
        : null;
      const m = geometry.metrics[index];
      const left = rect.left + (allDay ? surface.clientLeft : 0);
      const right = rect.right - (allDay ? surface.clientLeft : 0);
      const top = allDay ? header.bottom + 3 : Math.max(rect.top, clip.top);
      const bottom = allDay
        ? rect.bottom - m.paddingBottom
        : Math.min(rect.bottom, clip.bottom);
      if (
        event.clientX >= left &&
        event.clientX < right &&
        event.clientY >= top &&
        event.clientY < bottom
      )
        return {
          date: geometry.dates[index],
          index,
          minute: allDay ? 0 : geometry.axis.at(event.clientY - rect.top),
        };
    }
    return null;
  }
  function previewAllDay(item) {
    const bounds = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    const sx = bounds.width / parseFloat(style.width) || 1;
    const sy = bounds.height / parseFloat(style.height) || 1;
    const paint = session.allDayPaint;
    for (const segment of rules.segments([item], geometry.dates)) {
      const first = geometry.cards[segment.start].getBoundingClientRect();
      const last = geometry.cards[segment.end].getBoundingClientRect();
      const button = makeChip(item);
      button.classList.add("timetable-preview");
      button.tabIndex = -1;
      button.removeAttribute("data-agenda-edit");
      Object.assign(button.style, {
        left: (first.left - bounds.left + paint.leftInset) / sx + "px",
        top: (paint.top - bounds.top) / sy + "px",
        height: paint.height / sy + "px",
        width:
          (last.right - first.left - paint.leftInset - paint.rightInset) / sx +
          "px",
      });
      root.append(button);
    }
  }
  function preview(event) {
    const current = session;
    if (!current || current.saving) return;
    if (!current.moved) {
      // Blank-grid creation needs deliberate vertical movement. Ordinary click
      // jitter (including sideways motion) must not become a 15-minute draft.
      const distance = current.item
        ? Math.hypot(event.clientX - current.x, event.clientY - current.y)
        : Math.abs(event.clientY - current.y);
      if (distance < (current.item ? 4 : 10)) return;
    }
    current.moved = true;
    blockClick = true;
    root.classList.add("is-dragging");
    document.body.classList.toggle(
      "agenda-timetable-resizing",
      current.edge === "start" || current.edge === "end",
    );
    const target = hit(event, current.allDay);
    current.candidate = null;
    root.querySelectorAll(".timetable-preview").forEach((n) => n.remove());
    restorePlacements();
    if (target) {
      try {
        if (current.allDay) {
          current.candidate =
            current.edge === "dateEnd"
              ? rules.resizeEnd(current.item, target.date)
              : rules.move(
                  current.item,
                  math.day(target.date) - math.day(current.origin.date),
                );
        } else {
          const base = math.day(target.date) * 1440;
          const snapped = Math.min(
            1440,
            Math.max(0, Math.round(target.minute / 15) * 15),
          );
          if (!current.item) {
            const origin =
              math.day(current.origin.date) * 1440 + current.startMinute;
            const endpoint = base + snapped;
            const start = Math.min(origin, endpoint);
            current.fields = fields(
              start,
              Math.max(start + 15, origin, endpoint),
            );
            current.candidate = {
              ...current.fields,
              id: "preview",
              title: t("new"),
              note: "",
              status: "pending",
            };
          } else {
            const original = math.bounds(current.item);
            const delta =
              (math.day(target.date) - math.day(current.origin.date)) * 1440 +
              Math.round((target.minute - current.origin.minute) / 15) * 15;
            let start = original.start,
              end = original.end;
            if (current.edge === "start")
              start = Math.min(end - 15, base + snapped);
            else if (current.edge === "end")
              end = Math.max(start + 15, base + snapped);
            else {
              start += delta;
              if (end !== null) end += delta;
            }
            current.candidate = math.update(current.item, start, end);
          }
        }
      } catch {
        current.candidate = null;
      }
    }
    if (!current.hint) {
      current.hint = document.createElement("div");
      current.hint.className = "timetable-hint";
      current.hint.setAttribute("role", "status");
      document.body.append(current.hint);
    }
    current.hint.textContent = current.candidate
      ? current.candidate.date +
        (current.allDay
          ? " — " + current.candidate.endDate
          : " " +
            current.candidate.start +
            (current.candidate.end
              ? " — " + current.candidate.endDate + " " + current.candidate.end
              : ""))
      : t("dragInvalid");
    current.hint.style.left =
      Math.max(8, Math.min(event.clientX + 12, innerWidth - 290)) + "px";
    current.hint.style.top =
      Math.max(8, Math.min(event.clientY + 18, innerHeight - 50)) + "px";
    if (current.candidate && !current.allDay) {
      const items = displayedItems().filter(
        (item) => item.id !== current.item?.id,
      );
      const segments = math.slice(
        [...items, current.candidate],
        geometry.dates,
      );
      if (!current.placements)
        current.placements = new Map(
          [
            ...root.querySelectorAll(
              ".timetable-event:not(.timetable-preview)",
            ),
          ].map((node) => [
            node,
            {
              left: node.style.left,
              width: node.style.width,
              visibility: node.style.visibility,
            },
          ]),
        );
      for (const node of current.placements.keys())
        if (node.dataset.timetableItem === current.item?.id)
          node.style.visibility = "hidden";
      for (const [index, date] of geometry.dates.entries()) {
        const nodes = new Map(
          [
            ...geometry.columns[index].querySelectorAll(
              "[data-timetable-item]",
            ),
          ].map((node) => [node.dataset.timetableItem, node]),
        );
        for (const segment of math.columns(
          segments.filter((s) => s.date === date),
        )) {
          if (segment.item === current.candidate)
            placeTimed(segment, geometry.columns[index], geometry.axis, true);
          else {
            const node = nodes.get(segment.item.id);
            if (!node) continue;
            node.style.left = `calc(${(100 * segment.column) / segment.columns}% + 2px)`;
            node.style.width = `calc(${100 / segment.columns}% - 4px)`;
          }
        }
      }
    } else if (current.candidate) previewAllDay(current.candidate);
  }
  function restorePlacements() {
    if (!session?.placements) return;
    for (const [node, style] of session.placements)
      Object.assign(node.style, style);
  }

  function fields(start, end) {
    return {
      date: math.date(Math.floor(start / 1440)),
      start: math.clock(start % 1440),
      endDate: math.date(Math.floor(end / 1440)),
      end: math.clock(end % 1440),
      allDay: false,
    };
  }
  listen(
    calendar,
    "pointerdown",
    (event) => {
      if (!enabled() || event.button !== 0 || !event.isPrimary || session)
        return;
      // Gestures use the final shared mapping, never an in-flight paint offset.
      stopAxisMotion();
      blockClick = false;
      if (event.target.closest(".timetable-draft")) return;
      const button = event.target.closest("[data-agenda-edit]");
      const allDay = !root.contains(event.target);
      if (!button && allDay) return; // The accessible blank-cell buttons own creation.
      const origin = hit(event, allDay);
      const item = button
        ? getState().items.find((i) => i.id === button.dataset.agendaEdit)
        : null;
      if (!origin || !available(true)) return;
      let allDayPaint = null;
      if (allDay && button) {
        const box = button.getBoundingClientRect();
        const start = Math.max(
          0,
          geometry.dates.indexOf(button.dataset.agendaSegmentStart),
        );
        const end = Math.max(
          start,
          geometry.dates.indexOf(button.dataset.agendaSegmentEnd),
        );
        allDayPaint = {
          leftInset:
            box.left - geometry.cards[start].getBoundingClientRect().left,
          rightInset:
            geometry.cards[end].getBoundingClientRect().right - box.right,
          top: box.top,
          height: box.height,
        };
      }
      session = {
        allDayPaint,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        origin,
        item,
        allDay,
        edge:
          event.target.closest("[data-timetable-resize]")?.dataset
            .timetableResize ||
          (allDay && event.target.closest("[data-agenda-resize]")
            ? "dateEnd"
            : null),
        startMinute: Math.min(1425, Math.round(origin.minute / 15) * 15),
        moved: false,
        candidate: null,
      };
      event.stopPropagation();
      event.preventDefault();
    },
    { capture: true },
  );
  listen(
    document,
    "pointermove",
    (event) => {
      if (session && session.pointerId === event.pointerId && !session.saving) {
        event.preventDefault();
        schedulePreview(event);
      }
    },
    { passive: false },
  );
  listen(document, "pointerup", async (event) => {
    const current = session;
    if (!current || current.pointerId !== event.pointerId || current.saving)
      return;
    stopPreview();
    // Returning close to the press point also counts as a click, even if an
    // earlier pointer sample briefly crossed the creation threshold.
    if (!current.item && Math.abs(event.clientY - current.y) < 10)
      current.moved = false;
    if (current.moved) preview(event);
    const target = hit(event, current.allDay);
    if (!current.moved) {
      cancel();
      if (!target) return;
      blockClick = true;
      if (current.item) edit(current.item.id, true);
      else select(target.date);
      return;
    }
    if (!current.candidate || !target || !available(!!current.item)) {
      cancel();
      return;
    }
    if (!current.item) {
      const value = current.fields;
      cancel();
      create(value);
      return;
    }
    const fresh = getState().items.find((i) => i.id === current.item.id);
    if (JSON.stringify(fresh) !== JSON.stringify(current.item)) {
      notify(t("dragChanged"));
      cancel();
      return;
    }
    current.saving = true;
    try {
      await save(current.candidate, target.date);
    } finally {
      // Preview columns already show the drop layout. Releasing them must not
      // start a second CSS transition through the pre-drag column widths.
      root.classList.add("is-settling");
      cancel();
      // Saving freezes pointer geometry. Paint the persisted state before
      // exposing the completed drop, rather than leaving one stale frame.
      render();
      root.getBoundingClientRect();
      root.classList.remove("is-settling");
    }
  });
  listen(
    calendar,
    "click",
    (event) => {
      if (!enabled()) return;
      if (event.target.closest(".timetable-draft")) {
        event.stopImmediatePropagation();
        focusDraft();
        return;
      }
      const button = event.target.closest("[data-agenda-edit]");
      const allDay = !root.contains(event.target);
      const target = hit(event, allDay);
      if (!target && !(button && event.detail === 0)) return;
      event.stopImmediatePropagation();
      if (blockClick && event.detail > 0) {
        event.preventDefault();
        blockClick = false;
        return;
      }
      if (button) {
        edit(button.dataset.agendaEdit, true);
        return;
      }
      if (target && allDay) select(target.date);
    },
    { capture: true },
  );
  listen(
    calendar,
    "scroll",
    (event) => {
      if (!enabled() || !geometry || !geometry.scrolls.includes(event.target))
        return;
      timedScroll = event.target.scrollTop;
      for (const scroll of geometry.scrolls)
        if (Math.abs(scroll.scrollTop - timedScroll) > 0.5)
          scroll.scrollTop = timedScroll;
    },
    { capture: true },
  );
  listen(
    document,
    "keydown",
    (event) => {
      if (event.key === "Escape" && session && !session.saving) {
        event.preventDefault();
        event.stopImmediatePropagation();
        blockClick = true;
        cancel();
      }
    },
    { capture: true },
  );
  listen(document, "pointercancel", cancel);
  listen(window, "blur", cancel);
  listen(window, "resize", () => {
    cancel();
    requestRender();
  });
  const observer = new ResizeObserver(requestRender);
  observer.observe(calendar);
  return {
    render,
    cancel,
    setContentHidden(hidden) {
      contentHidden = hidden;
      for (const node of root.querySelectorAll(".timetable-scroll"))
        node.style.opacity = hidden ? "0" : "1";
    },
    dispose() {
      disposed = true;
      stopAxisMotion();
      cancel();
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      scope.abort();
      root.remove();
      calendar.classList.remove("agenda-dual-card-view");
      calendar.style.removeProperty("--agenda-all-card-height");
    },
  };
};
