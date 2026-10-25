"use strict";
/** Mouse-only rescheduling. Native day rectangles own hit testing, including lanes. */
WorkTimeApp.ui.createAgendaDrag = function ({
  calendar,
  getState,
  settle,
  save,
  notify,
}) {
  const rules = WorkTimeApp.domain.agenda;
  const scope = new AbortController();
  let session = null,
    blockClick = false,
    disposed = false;
  let updateFrame = null,
    pendingPointer = null;
  function stopUpdate() {
    if (updateFrame !== null) cancelAnimationFrame(updateFrame);
    updateFrame = null;
    pendingPointer = null;
  }
  const retiring = new Map();
  const listen = (node, type, callback, options = {}) =>
    node.addEventListener(type, callback, { ...options, signal: scope.signal });
  const signature = (item) =>
    JSON.stringify([
      item.id,
      item.date,
      item.endDate ?? item.date,
      item.start,
      item.end,
      item.title,
      item.note,
      item.completed,
      item.allDay,
      item.updatedAt,
    ]);
  const cards = () =>
    [...calendar.querySelectorAll(":scope > .day")].filter(
      (node) => getComputedStyle(node).display !== "none",
    );
  const dateOf = (card) => card.dataset.date || card.dataset.previewDate;
  const at = (x, y) =>
    cards().find((card) => {
      const rect = card.getBoundingClientRect();
      return (
        x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
      );
    });
  const dayNumber = (date) =>
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    ) / 86400000;
  const message = (key) => WorkTimeApp.i18n.t("agenda." + key);
  function available() {
    const state = getState();
    if (!state.active || state.busy || state.readOnly || state.transitioning)
      return false;
    if (state.draft) {
      notify(message("dragDraft"));
      return false;
    }
    return true;
  }
  function clearMarks() {
    for (const node of calendar.querySelectorAll(
      ".agenda-drag-source, .agenda-drop-range, .agenda-drop-target",
    ))
      node.classList.remove(
        "agenda-drag-source",
        "agenda-drop-range",
        "agenda-drop-target",
      );
  }
  function release(current) {
    if (calendar.hasPointerCapture(current.pointer))
      calendar.releasePointerCapture(current.pointer);
  }
  function retire(current, revert) {
    const ghost = current.ghost;
    if (!ghost) return;
    current.hint?.remove();
    if (
      WorkTimeApp.ui.animationCompat.preference().matches ||
      document.hidden ||
      disposed
    ) {
      ghost.remove();
      return;
    }
    const end =
      revert && current.operation !== "resizeEnd"
        ? `translate(${current.origin.left - parseFloat(ghost.style.left)}px, ${current.origin.top - parseFloat(ghost.style.top)}px)`
        : "none";
    ghost.style.opacity = "0";
    const animation = WorkTimeApp.ui.animationCompat.animate(
      ghost,
      [
        { opacity: 0.9, transform: "none" },
        { opacity: 0, transform: end },
      ],
      { duration: 160, easing: "ease-out", fill: "both" },
    );
    retiring.set(ghost, animation);
    animation.finished.then(() => {
      ghost.remove();
      retiring.delete(ghost);
    });
  }
  function cancel() {
    stopUpdate();
    const current = session;
    session = null;
    clearMarks();
    document.body.classList.remove("agenda-is-dragging", "agenda-is-resizing");
    if (current) {
      for (const animation of current.snapAnimations || []) animation.cancel();
      release(current);
      current.ghost?.remove();
      current.hint?.remove();
    }
    for (const [ghost, animation] of retiring) {
      animation.cancel();
      ghost.remove();
    }
    retiring.clear();
  }
  function fresh(current) {
    const latest = getState().items.find((item) => item.id === current.item.id);
    return latest && signature(latest) === current.signature;
  }
  function refresh() {
    if (!session?.started) return;
    if (session.phase !== "saving" && !fresh(session)) {
      notify(message("dragChanged"));
      cancel();
      return;
    }
    for (const node of calendar.querySelectorAll(".agenda-chip"))
      node.classList.toggle(
        "agenda-drag-source",
        node.dataset.agendaEdit === session.item.id,
      );
  }
  function start(event) {
    const current = session;
    if (!available()) {
      blockClick = true;
      cancel();
      return false;
    }
    if (!current.source.isConnected) {
      notify(message("dragChanged"));
      blockClick = true;
      cancel();
      return false;
    }
    settle();
    current.origin = current.source.getBoundingClientRect();
    const ghost = current.source.cloneNode(true);
    // The floating preview is one complete ribbon, independent of date seams.
    ghost.classList.remove("agenda-sliced");
    for (const slice of ghost.querySelectorAll(":scope > .agenda-slice"))
      slice.remove();
    for (const node of [ghost, ...ghost.querySelectorAll("*")]) {
      node.removeAttribute("id");
      for (const attribute of [...node.attributes])
        if (attribute.name.startsWith("data-"))
          node.removeAttribute(attribute.name);
    }
    ghost.classList.add("agenda-drag-preview");
    ghost.inert = true;
    ghost.setAttribute("aria-hidden", "true");
    ghost.removeAttribute("hidden");
    ghost.style.cssText = "";
    Object.assign(ghost.style, {
      position: "fixed",
      width: current.origin.width + "px",
      height: current.origin.height + "px",
      minWidth: "0",
      maxWidth: "none",
      margin: "0",
      overflow: "hidden",
    });
    current.template = ghost;
    current.ghost = ghost;
    if (current.operation === "resizeEnd") {
      const visible = cards();
      current.offsets = new Map();
      current.scrolls = new Map();
      for (let index = 0; index < visible.length; index += 7) {
        const row = visible.slice(index, index + 7);
        const dates = row.map(dateOf);
        const scroller = [
          ...calendar.querySelectorAll(".agenda-week-lane"),
        ].find((lane) => lane.dataset.dates.split(",")[0] === dates[0]);
        if (scroller)
          current.scrolls.set(dates[0], {
            node: scroller,
            top: scroller.scrollTop,
          });
        const source = [...calendar.querySelectorAll(".agenda-chip")].find(
          (node) =>
            node.dataset.agendaEdit === current.item.id &&
            (node.dataset.agendaSegmentStart
              ? node.dataset.agendaSegmentStart >= dates[0] &&
                node.dataset.agendaSegmentStart <= dates[dates.length - 1]
              : row.some((card) => card.contains(node))),
        );
        if (source)
          current.offsets.set(
            dates[0],
            source.getBoundingClientRect().top -
              row[0].querySelector(".daytop").getBoundingClientRect().bottom,
          );
        if (row.includes(at(current.x, current.y)))
          current.rowOffset =
            current.origin.top -
            row[0].querySelector(".daytop").getBoundingClientRect().bottom;
      }
      current.ghost = document.createElement("div");
      current.ghost.className = "agenda-drag-preview agenda-resize-preview";
      current.ghost.inert = true;
      current.ghost.setAttribute("aria-hidden", "true");
    }
    current.offsetX = current.x - current.origin.left;
    current.offsetY = current.y - current.origin.top;
    current.started = true;
    current.phase = "dragging";
    current.hint = document.createElement("div");
    current.hint.className = "agenda-drag-hint";
    current.hint.setAttribute("aria-hidden", "true");
    document.body.append(current.ghost, current.hint);
    document.body.classList.add("agenda-is-dragging");
    document.body.classList.toggle(
      "agenda-is-resizing",
      current.operation === "resizeEnd",
    );
    calendar.setPointerCapture(event.pointerId);
    blockClick = true;
    refresh();
    return true;
  }
  function previewResize(current, snap = false) {
    const visible = cards();
    const geometry = [];
    const candidate = current.candidate || current.previewCandidate;
    for (let index = 0; index < visible.length; index += 7) {
      const row = visible.slice(index, index + 7);
      const dates = row.map(dateOf);
      if (
        !candidate ||
        !rules.overlaps(candidate, dates[0], dates[dates.length - 1])
      )
        continue;
      const covered = row.filter((card) =>
        rules.overlaps(candidate, dateOf(card), dateOf(card)),
      );
      const first = covered[0],
        last = covered[covered.length - 1];
      const left =
        first.getBoundingClientRect().left +
        first.clientLeft +
        parseFloat(getComputedStyle(first).paddingLeft);
      const fullRight =
        last.getBoundingClientRect().right -
        last.clientLeft -
        parseFloat(getComputedStyle(last).paddingRight);
      const after = rules.lastDate(candidate) > dates[dates.length - 1];
      const rowEnd = row[row.length - 1];
      const maxRight =
        rowEnd.getBoundingClientRect().right -
        rowEnd.clientLeft -
        parseFloat(getComputedStyle(rowEnd).paddingRight);
      const right =
        snap || after
          ? fullRight
          : Math.max(
              left + 1,
              Math.min(current.pointerX ?? fullRight, maxRight),
            );
      const top =
        row[0].querySelector(".daytop").getBoundingClientRect().bottom +
        (current.offsets.get(dates[0]) ?? current.rowOffset ?? 8) -
        ((current.scrolls.get(dates[0])?.node.scrollTop || 0) -
          (current.scrolls.get(dates[0])?.top || 0));
      const clipTop =
        Math.max(
          ...row.map(
            (card) =>
              card.querySelector(".daytop").getBoundingClientRect().bottom,
          ),
        ) + 4;
      const clipBottom = Math.min(
        ...row.map(
          (card) =>
            card.getBoundingClientRect().bottom -
            parseFloat(getComputedStyle(card).paddingBottom),
        ),
      );
      geometry.push({
        left,
        right,
        top,
        clipTop,
        clipBottom,
        before: candidate.date < dates[0],
        after,
      });
    }
    const key = JSON.stringify(geometry);
    if (key === current.previewKey) return;
    current.previewKey = key;
    const nodes = geometry.map(
      ({ left, right, top, clipTop, clipBottom, before, after }, index) => {
        const node =
          current.ghost.children[index] || current.template.cloneNode(true);
        node.classList.remove(
          "agenda-drag-preview",
          "continues-before",
          "continues-after",
        );
        node.classList.add("agenda-resize-segment");
        node.classList.toggle("continues-before", before);
        node.classList.toggle("continues-after", after);
        const direction = `${before}/${after}`;
        const changed = node.dataset.previewDirection !== direction;
        if (changed) {
          for (const child of node.querySelectorAll(
            ".agenda-resize-handle,.agenda-chip-continuation",
          ))
            child.remove();
          node.dataset.previewDirection = direction;
        }
        const title = node.querySelector(".agenda-chip-title");
        const icon = (direction) => {
          const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          svg.classList.add("agenda-chip-continuation");
          const use = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "use",
          );
          use.setAttribute("href", "#ms-chevron-" + direction);
          svg.append(use);
          return svg;
        };
        if (changed && before) title.prepend(icon("left"));
        if (changed && after) title.append(icon("right"));
        Object.assign(node.style, {
          left: left + "px",
          top: top + "px",
          width: right - left + "px",
          clipPath: `inset(${Math.max(0, clipTop - top)}px 0 ${Math.max(0, top + current.origin.height - clipBottom)}px 0)`,
        });
        return node;
      },
    );
    for (const node of nodes)
      if (node.parentElement !== current.ghost) current.ghost.append(node);
    while (current.ghost.children.length > nodes.length)
      current.ghost.lastElementChild.remove();
  }
  function settleResizePreview(current) {
    const before = [...current.ghost.children].map(
      (node) => node.getBoundingClientRect().width,
    );
    previewResize(current, true);
    if (WorkTimeApp.ui.animationCompat.preference().matches || document.hidden)
      return Promise.resolve();
    current.snapAnimations = [...current.ghost.children].flatMap(
      (node, index) => {
        const width = node.getBoundingClientRect().width;
        if (
          !Number.isFinite(before[index]) ||
          Math.abs(width - before[index]) < 0.5
        )
          return [];
        return [
          WorkTimeApp.ui.animationCompat.animate(
            node,
            [{ width: before[index] + "px" }, { width: width + "px" }],
            {
              duration: 220,
              easing: "cubic-bezier(0.2, 0.65, 0.3, 1)",
              fill: "both",
            },
          ),
        ];
      },
    );
    return Promise.all(
      current.snapAnimations.map((animation) => animation.finished),
    );
  }
  function update(event) {
    const current = session;
    if (!current || current.phase === "saving") return;
    refresh();
    if (session !== current) return;
    current.pointerX = event.clientX;
    if (current.operation !== "resizeEnd")
      Object.assign(current.ghost.style, {
        left: event.clientX - current.offsetX + "px",
        top: event.clientY - current.offsetY + "px",
      });
    const card = at(event.clientX, event.clientY);
    clearMarks();
    refresh();
    current.target = card ? dateOf(card) : null;
    current.candidate = null;
    if (current.target) {
      try {
        current.candidate =
          current.operation === "resizeEnd"
            ? rules.resizeEnd(current.item, current.target)
            : rules.move(
                current.item,
                dayNumber(current.target) - dayNumber(current.anchor),
              );
      } catch {
        /* Out-of-range intervals cannot be dropped. */
      }
    }
    if (current.candidate) {
      current.previewCandidate = current.candidate;
      card.classList.add("agenda-drop-target");
      for (const node of cards())
        if (rules.overlaps(current.candidate, dateOf(node), dateOf(node)))
          node.classList.add("agenda-drop-range");
      current.hint.textContent =
        WorkTimeApp.i18n.date(current.candidate.date) +
        ((current.candidate.endDate ?? current.candidate.date) !==
        current.candidate.date
          ? " — " + WorkTimeApp.i18n.date(current.candidate.endDate)
          : "");
    } else current.hint.textContent = message("dragInvalid");
    if (current.operation === "resizeEnd") previewResize(current);
    current.ghost.classList.toggle("is-invalid", !current.candidate);
    const hintWidth = current.hint.getBoundingClientRect().width;
    Object.assign(current.hint.style, {
      left:
        Math.max(8, Math.min(event.clientX + 12, innerWidth - hintWidth - 8)) +
        "px",
      top:
        Math.max(
          8,
          Math.min(
            event.clientY + 18,
            innerHeight - current.hint.offsetHeight - 8,
          ),
        ) + "px",
    });
  }
  listen(
    calendar,
    "pointerdown",
    (event) => {
      if (
        event.pointerType !== "mouse" ||
        event.button !== 0 ||
        session?.phase === "saving"
      )
        return;
      blockClick = false;
      const source = event.target.closest(".agenda-chip[data-agenda-edit]");
      const state = getState();
      if (!source || !state.active || state.busy || state.readOnly) return;
      const item = state.items.find(
        (entry) => entry.id === source.dataset.agendaEdit,
      );
      if (!item) return;
      const resizing = !!event.target.closest('[data-agenda-resize="end"]');
      if (
        resizing &&
        ((!item.allDay && !item.end) ||
          source.classList.contains("continues-after"))
      )
        return;
      let card = at(event.clientX, event.clientY);
      // A continuous bar bridges card gaps; pick the nearest covered column there.
      if (!card)
        card = cards()
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return (
              event.clientY >= rect.top &&
              event.clientY < rect.bottom &&
              rules.overlaps(item, dateOf(node), dateOf(node))
            );
          })
          .sort(
            (a, b) =>
              Math.abs(
                event.clientX -
                  (a.getBoundingClientRect().left +
                    a.getBoundingClientRect().width / 2),
              ) -
              Math.abs(
                event.clientX -
                  (b.getBoundingClientRect().left +
                    b.getBoundingClientRect().width / 2),
              ),
          )[0];
      if (!card || !rules.overlaps(item, dateOf(card), dateOf(card))) return;
      if (
        resizing &&
        (source.dataset.agendaSegmentEnd || dateOf(card)) !==
          rules.lastDate(item)
      )
        return;
      session = {
        operation: resizing ? "resizeEnd" : "move",
        source,
        item,
        signature: signature(item),
        anchor: resizing ? rules.lastDate(item) : dateOf(card),
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        started: false,
        phase: "pending",
      };
    },
    { capture: true },
  );
  listen(
    document,
    "pointermove",
    (event) => {
      if (
        !session ||
        event.pointerId !== session.pointer ||
        session.phase === "saving"
      )
        return;
      if (!session.started) {
        if (
          Math.hypot(event.clientX - session.x, event.clientY - session.y) <= 6
        )
          return;
        if (!start(event)) return;
      }
      event.preventDefault();
      pendingPointer = { clientX: event.clientX, clientY: event.clientY };
      if (updateFrame === null)
        updateFrame = requestAnimationFrame(() => {
          const pointer = pendingPointer;
          stopUpdate();
          if (pointer) update(pointer);
        });
    },
    { capture: true, passive: false },
  );
  listen(
    document,
    "pointerup",
    async (event) => {
      const current = session;
      if (
        !current ||
        event.pointerId !== current.pointer ||
        current.phase === "saving"
      )
        return;
      if (!current.started) {
        session = null;
        return;
      }
      stopUpdate();
      update(event);
      if (session !== current) return;
      if (
        !current.candidate ||
        (current.operation === "resizeEnd"
          ? current.candidate?.endDate ===
            (current.item.endDate ?? current.item.date)
          : current.target === current.anchor) ||
        !available()
      ) {
        cancel();
        return;
      }
      if (!fresh(current)) {
        notify(message("dragChanged"));
        cancel();
        return;
      }
      current.phase = "saving";
      const snapFinished =
        current.operation === "resizeEnd"
          ? settleResizePreview(current)
          : Promise.resolve();
      release(current);
      let success = false;
      try {
        success = await save(
          current.candidate,
          current.target,
          current.operation,
        );
      } catch {
        notify(message("saveFailed"));
      }
      await snapFinished;
      if (session !== current) return;
      session = null;
      clearMarks();
      document.body.classList.remove(
        "agenda-is-dragging",
        "agenda-is-resizing",
      );
      retire(current, !success);
    },
    { capture: true },
  );
  listen(
    document,
    "click",
    (event) => {
      if (blockClick && event.detail > 0) {
        blockClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
  listen(
    document,
    "pointerdown",
    (event) => {
      if (!session && !event.target.closest(".agenda-chip")) blockClick = false;
    },
    { capture: true },
  );
  listen(calendar, "dragstart", (event) => {
    if (event.target.closest(".agenda-chip")) event.preventDefault();
  });
  listen(document, "pointercancel", cancel, { capture: true });
  listen(calendar, "lostpointercapture", () => {
    if (session?.phase === "dragging") cancel();
  });
  listen(
    document,
    "keydown",
    (event) => {
      if (event.key === "Escape" && session) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    },
    { capture: true },
  );
  listen(window, "blur", cancel);
  listen(window, "resize", cancel);
  listen(
    document,
    "scroll",
    () => {
      if (session?.operation === "resizeEnd" && session.phase === "dragging")
        previewResize(session);
    },
    { capture: true },
  );
  listen(document, "visibilitychange", () => {
    if (document.hidden) cancel();
  });
  return {
    cancel,
    refresh,
    get active() {
      return !!session?.started;
    },
    dispose() {
      disposed = true;
      cancel();
      scope.abort();
    },
  };
};
