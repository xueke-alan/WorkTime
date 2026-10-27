"use strict";
/** Mouse-only rescheduling. Native day rectangles own hit testing, including lanes. */
WorkTimeApp.ui.createAgendaDrag = function ({
  calendar,
  getState,
  settle,
  save,
  notify,
  moreLabel = (count) => count + "+",
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
      item.status,
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
  function gridAt(x, y) {
    const cells = cards().map((node) => ({
      node,
      rect: node.getBoundingClientRect(),
    }));
    if (
      !cells.length ||
      x < Math.min(...cells.map(({ rect }) => rect.left)) ||
      x >= Math.max(...cells.map(({ rect }) => rect.right)) ||
      y < Math.min(...cells.map(({ rect }) => rect.top)) ||
      y >= Math.max(...cells.map(({ rect }) => rect.bottom))
    )
      return null;
    // Internal gutters belong to the nearest date for both preview and release.
    // Points outside the date grid still cancel the operation.
    let nearest = null,
      distance = Infinity;
    for (const { node, rect } of cells) {
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const next = dx * dx + dy * dy;
      if (next < distance) {
        nearest = node;
        distance = next;
      }
    }
    return nearest;
  }
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
  function clearDropMarks() {
    for (const node of calendar.querySelectorAll(
      ".agenda-drop-range, .agenda-drop-target",
    ))
      node.classList.remove("agenda-drop-range", "agenda-drop-target");
  }
  function clearMarks() {
    clearDropMarks();
    for (const node of calendar.querySelectorAll(".agenda-drag-source"))
      node.classList.remove("agenda-drag-source");
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
    document.body.classList.remove(
      "agenda-is-dragging",
      "agenda-is-resizing",
      "agenda-is-dropping",
    );
    if (current) {
      for (const animation of current.snapAnimations || []) animation.cancel();
      for (const animation of current.layoutAnimations || [])
        animation.cancel();
      clearReorder(current);
      stopPreviewMotion(current);
      restorePreviewRows(current);
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
    if (session.handoff) return;
    if (session.phase !== "saving" && !fresh(session)) {
      notify(message("dragChanged"));
      cancel();
      return;
    }
    for (const node of calendar.querySelectorAll(".agenda-chip")) {
      const source = node.dataset.agendaEdit === session.item.id;
      if (node.classList.contains("agenda-drag-source") !== source)
        node.classList.toggle("agenda-drag-source", source);
    }
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
    current.resizeGrabOffset = current.x - current.origin.right;
    const ghost = current.source.cloneNode(true);
    // A floating preview paints one complete surface, without date clipping.
    ghost.classList.remove("agenda-sliced");
    for (const slice of ghost.querySelectorAll(":scope > .agenda-slice"))
      slice.remove();
    for (const node of [ghost, ...ghost.querySelectorAll("*")]) {
      node.removeAttribute("id");
      for (const attribute of [...node.attributes])
        // Status is visual state, unlike interactive agenda identifiers.
        if (
          attribute.name.startsWith("data-") &&
          attribute.name !== "data-status"
        )
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
      current.leftOffsets = new Map();
      current.rightOffsets = new Map();
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
        if (source) {
          const bounds = source.getBoundingClientRect();
          current.leftOffsets.set(
            dates[0],
            bounds.left - row[0].getBoundingClientRect().left,
          );
          current.rightOffsets.set(dates[0], {
            start: source.dataset.agendaSegmentStart || current.item.date,
            end:
              source.dataset.agendaSegmentEnd || rules.lastDate(current.item),
            offset: bounds.right - row[0].getBoundingClientRect().left,
          });
          current.offsets.set(
            dates[0],
            bounds.top -
              row[0].querySelector(".daytop").getBoundingClientRect().bottom,
          );
        }
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
  function previewMotionAllowed() {
    return (
      !WorkTimeApp.ui.animationCompat.preference().matches && !document.hidden
    );
  }
  function stopPreviewMotion(current) {
    if (current.clipFrame !== undefined)
      cancelAnimationFrame(current.clipFrame);
    current.clipFrame = undefined;
    for (const state of current.previewSegments?.values() || []) {
      state.opacityAnimation?.cancel();
      state.widthAnimation?.cancel();
      state.topAnimation?.cancel();
      state.opacityAnimation = state.widthAnimation = state.topAnimation = null;
    }
  }
  function updatePreviewClips(current) {
    for (const state of current.previewSegments?.values() || []) {
      if (!state.node.isConnected || !state.clip) continue;
      const bounds = state.node.getBoundingClientRect();
      const path = `inset(${Math.max(0, state.clip.top - bounds.top)}px 0 ${Math.max(0, bounds.bottom - Math.min(state.clip.bottom, current.previewClipBottoms?.get(state.node.dataset.previewWeek) ?? Infinity))}px 0)`;
      if (state.lastClipPath !== path) {
        state.node.style.clipPath = path;
        state.lastClipPath = path;
      }
    }
  }
  function watchPreviewClips(current) {
    if (current.clipFrame !== undefined) return;
    const frame = () => {
      current.clipFrame = undefined;
      if (session !== current || current.handoff) return;
      updatePreviewClips(current);
      // Geometry is stationary once the preview's animation tracks settle.
      // Pointer and scroll updates restart this watcher when needed.
      if (
        [...current.previewSegments.values()].some(
          (state) =>
            state.opacityAnimation ||
            state.widthAnimation ||
            state.topAnimation,
        )
      )
        current.clipFrame = requestAnimationFrame(frame);
    };
    current.clipFrame = requestAnimationFrame(frame);
  }
  function previewOpacity(state, target, startTime) {
    if (
      state.opacityTarget === target &&
      (!state.opacityAnimation || previewMotionAllowed())
    )
      return state.opacityAnimation?.finished || Promise.resolve();
    const from = Number(getComputedStyle(state.node).opacity);
    state.opacityTarget = target;
    state.opacityAnimation?.cancel();
    state.node.style.opacity = String(target);
    const finish = () => {
      if (target === 0 && state.stage === "exiting") {
        state.node.remove();
        state.stage = "detached";
      }
    };
    if (!previewMotionAllowed() || Math.abs(from - target) < 0.001) {
      state.opacityAnimation = null;
      finish();
      return Promise.resolve();
    }
    const animation = WorkTimeApp.ui.animationCompat.animate(
      state.node,
      [{ opacity: from }, { opacity: target }],
      { duration: 160, easing: target ? "ease-in" : "ease-out", fill: "both" },
      startTime,
    );
    state.opacityAnimation = animation;
    animation.finished.then(() => {
      if (state.opacityAnimation !== animation) return;
      state.opacityAnimation = null;
      finish();
    });
    return animation.finished;
  }
  function previewWidth(state, width, roleChanged, startTime, snap) {
    const from = state.node.getBoundingClientRect().width;
    const now = Number(document.timeline.currentTime);
    const running = state.widthAnimation && state.widthDeadline > now;
    if (
      state.widthTarget === width &&
      !roleChanged &&
      !snap &&
      (!state.widthAnimation || previewMotionAllowed())
    )
      return;
    if (roleChanged || snap) state.widthDeadline = now + 220;
    const duration = Math.max(0, state.widthDeadline - now);
    state.widthAnimation?.cancel();
    state.widthAnimation = null;
    state.widthTarget = width;
    state.node.style.width = width + "px";
    if (
      previewMotionAllowed() &&
      (roleChanged || running || snap) &&
      duration > 0 &&
      Math.abs(from - width) > 0.5
    ) {
      const animation = WorkTimeApp.ui.animationCompat.animate(
        state.node,
        [{ width: from + "px" }, { width: width + "px" }],
        { duration, easing: "cubic-bezier(0.2, 0.65, 0.3, 1)", fill: "both" },
        startTime,
      );
      state.widthAnimation = animation;
      animation.finished.then(() => {
        if (state.widthAnimation === animation) state.widthAnimation = null;
      });
    }
  }
  function clearPreviewOverflow(current) {
    for (const state of current.previewOverflow?.values() || []) {
      for (const node of state.labels.values()) node.remove();
      for (const node of state.original)
        if (node.classList.contains("agenda-preview-more-hidden"))
          node.classList.remove("agenda-preview-more-hidden");
    }
    current.previewOverflow = null;
  }
  function previewOverflow(current, group, positions, heights, total, slot) {
    if (!group.lane || calendar.classList.contains("agenda-week-view"))
      return Infinity;
    current.previewOverflow ||= new Map();
    let state = current.previewOverflow.get(group.lane);
    if (!state) {
      state = {
        original: [
          ...group.lane.querySelectorAll(
            ":scope > .agenda-more:not(.agenda-preview-more)",
          ),
        ],
        labels: new Map(),
      };
      current.previewOverflow.set(group.lane, state);
    }
    if (!group.covered && !group.source) {
      for (const node of state.labels.values()) node.remove();
      state.labels.clear();
      for (const node of state.original)
        if (node.classList.contains("agenda-preview-more-hidden"))
          node.classList.remove("agenda-preview-more-hidden");
      return Infinity;
    }
    for (const node of state.original)
      if (!node.classList.contains("agenda-preview-more-hidden"))
        node.classList.add("agenda-preview-more-hidden");
    const height = group.lane.clientHeight;
    let limit = heights.length;
    if (group.covered && total > height) {
      limit = 0;
      while (
        limit < heights.length &&
        positions[limit] + (heights[limit] || current.origin.height) <=
          height - 19
      )
        limit++;
    }
    const entries = [
      ...group.remaining.map((entry) => ({
        ...entry,
        lane: group.positions.get(entry.item.id),
        hidden: (() => {
          const node = group.nodesById.get(entry.item.id);
          return node
            ? (current.previewPeers?.get(node)?.hidden ?? node.hidden)
            : true;
        })(),
      })),
      ...(group.covered
        ? [
            {
              item: current.candidate || current.previewCandidate,
              lane: slot,
              start: Math.max(
                0,
                group.dates.findIndex(
                  (date) =>
                    date >=
                    (current.candidate || current.previewCandidate).date,
                ),
              ),
              end: group.dates.findLastIndex(
                (date) =>
                  date <=
                  rules.lastDate(current.candidate || current.previewCandidate),
              ),
            },
          ]
        : []),
    ];
    for (let column = 0; column < 7; column++) {
      const count = entries.filter(
        (entry) =>
          (group.covered ? entry.lane >= limit : entry.hidden) &&
          entry.start <= column &&
          entry.end >= column,
      ).length;
      const date = group.dates[column];
      let label = state.labels.get(date);
      if (!count) {
        label?.remove();
        state.labels.delete(date);
        continue;
      }
      if (!label) {
        label = document.createElement("button");
        label.type = "button";
        label.className = "agenda-more agenda-preview-more";
        label.inert = true;
        label.setAttribute("aria-hidden", "true");
        label.dataset.previewDate = date;
        group.lane.append(label);
        state.labels.set(date, label);
      }
      if (label.textContent !== count + "+") label.textContent = count + "+";
      const description = moreLabel(count);
      if (label.getAttribute("aria-label") !== description)
        label.setAttribute("aria-label", description);
      const card = group.row[column],
        bounds = card.getBoundingClientRect(),
        style = getComputedStyle(card);
      const extension =
        parseFloat(
          getComputedStyle(calendar).getPropertyValue(
            "--agenda-card-left-extension",
          ),
        ) || 0;
      const left =
        bounds.left +
        card.clientLeft +
        parseFloat(style.paddingLeft) -
        extension;
      const styles = {
        left: left - group.lane.getBoundingClientRect().left + "px",
        bottom: "0px",
        width:
          bounds.right -
          card.clientLeft -
          parseFloat(style.paddingRight) -
          left +
          "px",
      };
      for (const [name, value] of Object.entries(styles))
        if (label.style[name] !== value) label.style[name] = value;
    }
    return limit;
  }
  function restorePreviewRows(current, committed = false) {
    for (const state of current.previewPeers?.values() || []) {
      state.animation?.cancel();
      state.node.style.transform = state.transform;
      if (!committed && state.hidden !== undefined)
        state.node.hidden = state.hidden;
      state.node.classList.remove("agenda-preview-peer");
    }
    for (const state of current.previewHeights?.values() || [])
      if (state.node.style.height === state.applied)
        state.node.style.height = state.original;
    current.previewPeers = current.previewHeights = null;
    clearPreviewOverflow(current);
  }
  function arrangePreviewRows(current, visible, candidate, startTime) {
    const groups = [];
    const items = getState().items;
    current.previewPeers ||= new Map();
    current.previewHeights ||= new Map();
    current.previewSlots ||= new Map();
    const lanes = new Map(
      [...calendar.querySelectorAll(".agenda-week-lane")].map((lane) => [
        lane.dataset.dates.split(",")[0],
        lane,
      ]),
    );
    for (let index = 0; index < visible.length; index += 7) {
      const row = visible.slice(index, index + 7),
        dates = row.map(dateOf);
      if (dates.length !== 7) continue;
      const lane = lanes.get(dates[0]);
      const entries = rules.segments(items, dates);
      const source = entries.find((entry) => entry.item.id === current.item.id);
      const nodes = lane
        ? [...lane.querySelectorAll(".agenda-chip")]
        : row.flatMap((card) =>
            [...card.querySelectorAll(".agenda-chip")].filter(
              (node) => !node.hidden,
            ),
          );
      const remaining = entries.filter(
        (entry) => entry.item.id !== current.item.id,
      );
      groups.push({
        row,
        dates,
        lane,
        nodes,
        nodesById: new Map(
          nodes.map((node) => [node.dataset.agendaEdit, node]),
        ),
        source,
        remaining,
        covered: rules.overlaps(candidate, dates[0], dates[6]),
      });
    }
    const results = new Map();
    current.previewVisible = new Map();
    current.previewClipBottoms = new Map();
    for (const group of groups) {
      // Reserve a row once per week for the whole gesture. Newly covered weeks
      // append after existing rows; candidate-date sorting belongs to release.
      // Each week still measures its own heights, so empty weeks start at zero.
      const week = group.dates[0];
      const slot =
        current.previewSlots.get(week) ??
        group.source?.lane ??
        group.remaining.reduce(
          (count, entry) => Math.max(count, entry.lane + 1),
          0,
        );
      if (group.covered || group.source) current.previewSlots.set(week, slot);
      const prefixHeights = [];
      if (group.covered) prefixHeights[slot] = current.origin.height;
      group.positions = new Map();
      const occupied = new Map();
      if (group.covered) {
        const start = Math.max(
          0,
          group.dates.findIndex((date) => date >= candidate.date),
        );
        const end = group.dates.findLastIndex(
          (date) => date <= rules.lastDate(candidate),
        );
        occupied.set(slot, [[start, end]]);
      }
      // Preserve existing lanes. Only overlapping intervals cascade down when
      // the preview actually needs their space; unrelated events never compact.
      const remaining = [...group.remaining].sort(
        (a, b) =>
          a.lane - b.lane ||
          a.start - b.start ||
          a.item.id.localeCompare(b.item.id),
      );
      for (const entry of remaining) {
        let target = entry.lane;
        while (
          (occupied.get(target) || []).some(
            ([left, right]) => entry.start <= right && entry.end >= left,
          )
        )
          target++;
        if (!occupied.has(target)) occupied.set(target, []);
        occupied.get(target).push([entry.start, entry.end]);
        group.positions.set(entry.item.id, target);
        const node = group.nodesById.get(entry.item.id);
        if (group.covered && node)
          prefixHeights[target] = Math.max(
            prefixHeights[target] || 0,
            node.getBoundingClientRect().height || current.origin.height,
          );
      }
      const positions = [],
        fallback = current.origin.height;
      let total = 0;
      for (let index = 0; index < prefixHeights.length; index++) {
        positions[index] = total;
        total += (prefixHeights[index] || fallback) + 3;
      }
      const rowTop = group.row[0].getBoundingClientRect().top;
      const scroll = group.lane?.scrollTop || 0;
      const base = group.lane
        ? group.lane.getBoundingClientRect().top
        : Math.max(
            ...group.row.map(
              (card) =>
                card.querySelector(".daytop").getBoundingClientRect().bottom +
                parseFloat(getComputedStyle(card).rowGap || "0") +
                4,
            ),
          );
      const limit = previewOverflow(
        current,
        group,
        positions,
        prefixHeights,
        total,
        slot,
      );
      current.previewVisible.set(group.dates[0], slot < limit);
      if (group.covered && group.lane && limit < prefixHeights.length)
        current.previewClipBottoms.set(
          group.dates[0],
          group.lane.getBoundingClientRect().bottom - 19,
        );
      if (group.covered)
        results.set(group.dates[0], base + positions[slot] - scroll);
      for (const node of group.nodes) {
        if (node.dataset.agendaEdit === current.item.id) continue;
        let state = current.previewPeers.get(node);
        if (!state) {
          state = {
            node,
            transform: node.style.transform,
            hidden: node.hidden,
            offset: node.getBoundingClientRect().top - rowTop,
            scroll,
            target: 0,
          };
          current.previewPeers.set(node, state);
        }
        const wasHidden = node.hidden;
        const hidden = group.covered
          ? group.positions.get(node.dataset.agendaEdit) >= limit
          : state.hidden;
        if (node.hidden !== hidden) node.hidden = hidden;
        const natural = group.lane
          ? base + (parseFloat(node.style.top) || 0) - scroll
          : rowTop + state.offset - (scroll - state.scroll);
        const targetTop = group.covered
          ? base +
            positions[group.positions.get(node.dataset.agendaEdit)] -
            scroll
          : natural;
        const dy = targetTop - natural;
        if (!Number.isFinite(dy) || Math.abs(dy - state.target) < 0.5) continue;
        const from =
          wasHidden || node.hidden
            ? dy
            : node.getBoundingClientRect().top - natural;
        state.animation?.cancel();
        state.target = dy;
        node.style.transform = dy ? `translateY(${dy}px)` : state.transform;
        node.classList.toggle("agenda-preview-peer", Math.abs(dy) > 0.5);
        if (previewMotionAllowed())
          state.animation = WorkTimeApp.ui.animationCompat.animate(
            node,
            [
              { transform: `translateY(${from}px)` },
              { transform: `translateY(${dy}px)` },
            ],
            {
              duration: 220,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              fill: "both",
            },
            startTime,
          );
      }
      const content = group.lane?.querySelector(".agenda-lane-content");
      if (content) {
        let state = current.previewHeights.get(content);
        if (!state) {
          state = { node: content, original: content.style.height };
          current.previewHeights.set(content, state);
        }
        const height = group.covered
          ? Math.max(parseFloat(state.original) || 0, total) + "px"
          : state.original;
        if (content.style.height !== height) content.style.height = height;
        state.applied = height;
      }
    }
    return results;
  }
  function previewResize(current, snap = false) {
    const visible = cards();
    const geometry = [];
    const candidate = current.candidate || current.previewCandidate;
    const startTime = document.timeline.currentTime;
    const rowTops = candidate
      ? arrangePreviewRows(current, visible, candidate, startTime)
      : new Map();
    for (let index = 0; index < visible.length; index += 7) {
      const row = visible.slice(index, index + 7);
      const dates = row.map(dateOf);
      if (
        !candidate ||
        !rules.overlaps(candidate, dates[0], dates[dates.length - 1]) ||
        current.previewVisible?.get(dates[0]) === false
      )
        continue;
      const covered = row.filter((card) =>
        rules.overlaps(candidate, dateOf(card), dateOf(card)),
      );
      const first = covered[0],
        last = covered[covered.length - 1];
      const firstRect = first.getBoundingClientRect();
      const firstStyle = getComputedStyle(first);
      const scaleX = firstRect.width / first.offsetWidth;
      const leftExtension =
        parseFloat(
          getComputedStyle(calendar).getPropertyValue(
            "--agenda-card-left-extension",
          ),
        ) || 0;
      const leftOffset = current.leftOffsets.get(dates[0]);
      const left =
        leftOffset !== undefined
          ? row[0].getBoundingClientRect().left + leftOffset
          : firstRect.left +
            (first.clientLeft +
              parseFloat(firstStyle.paddingLeft) -
              leftExtension) *
              scaleX;
      const originalEdge = current.rightOffsets.get(dates[0]);
      const liveRight = originalEdge
        ? row[0].getBoundingClientRect().left + originalEdge.offset
        : null;
      const fullRight =
        originalEdge?.end === dateOf(last)
          ? liveRight
          : last.getBoundingClientRect().right -
            last.clientLeft -
            parseFloat(getComputedStyle(last).paddingRight);
      const after = rules.lastDate(candidate) > dates[dates.length - 1];
      const rowEnd = row[row.length - 1];
      const maxRight =
        rowEnd.getBoundingClientRect().right -
        rowEnd.clientLeft -
        parseFloat(getComputedStyle(rowEnd).paddingRight);
      // Existing single-date segments already include the calendar's rounded
      // layout geometry. Recomputing their edge from card rects adds a fraction
      // of a pixel, making a left drag grow before restoring on release.
      const firstDateRight =
        originalEdge?.start === originalEdge?.end &&
        originalEdge?.start === dateOf(first)
          ? liveRight
          : firstRect.right -
            first.clientLeft -
            parseFloat(firstStyle.paddingRight);
      let pointerRight =
        current.pointerX === undefined
          ? fullRight
          : current.pointerX - current.resizeGrabOffset;
      if (!snap && !after) {
        // Smoothly saturate the last few pixels without a direction-dependent
        // latch. The curve and its derivative meet normal tracking at 6px.
        const extra = pointerRight - firstDateRight;
        if (extra <= 2) pointerRight = firstDateRight;
        else if (extra < 6) {
          const progress = (extra - 2) / 4;
          pointerRight =
            firstDateRight + extra * progress * progress * (3 - 2 * progress);
        }
      }
      const right =
        snap || after
          ? fullRight
          : Math.max(firstDateRight, Math.min(pointerRight, maxRight));
      const top =
        rowTops.get(dates[0]) ??
        row[0].querySelector(".daytop").getBoundingClientRect().bottom +
          (current.rowOffset ?? 8);
      const clipTop =
        current.scrolls.get(dates[0])?.node.getBoundingClientRect().top ??
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
        week: dates[0],
        titleRight:
          firstRect.right -
          first.clientLeft -
          parseFloat(firstStyle.paddingRight),
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
    current.previewSegments ||= new Map();
    const coverage = geometry.map((part) => part.week).join(",");
    const coverageChanged =
      current.previewCoverage !== undefined &&
      current.previewCoverage !== coverage;
    current.previewCoverage = coverage;
    const nodes = geometry.map(
      ({
        week,
        titleRight,
        left,
        right,
        top,
        clipTop,
        clipBottom,
        before,
        after,
      }) => {
        let state = current.previewSegments.get(week);
        if (!state) {
          const node = current.template.cloneNode(true);
          state = {
            node,
            stage: "detached",
            initialized: false,
            widthDeadline: 0,
          };
          current.previewSegments.set(week, state);
        }
        const { node } = state;
        const oldTop = node.isConnected
          ? node.getBoundingClientRect().top
          : top;
        const roleChanged = state.initialized && state.after !== after;
        const detached = node.parentElement !== current.ghost;
        if (detached) {
          node.style.opacity =
            !state.initialized && current.offsets.has(week) ? "1" : "0";
          state.opacityTarget = undefined;
        }
        state.stage = "active";
        node.dataset.previewStage = "active";
        node.dataset.previewWeek = week;
        const direction = `${before}/${after}`;
        const changed = node.dataset.previewDirection !== direction;
        if (changed) {
          node.classList.remove("agenda-drag-preview");
          node.classList.add("agenda-resize-segment");
          node.classList.toggle("continues-before", before);
          node.classList.toggle("continues-after", after);
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
        });
        if (detached) {
          node.style.width = Math.round((right - left) * 1e6) / 1e6 + "px";
          current.ghost.append(node);
        }
        const heading = node.querySelector(".agenda-chip-title-text");
        if (heading)
          heading.style.maxWidth =
            Math.max(0, titleRight - heading.getBoundingClientRect().left) +
            "px";
        previewOpacity(state, 1, startTime);
        previewWidth(
          state,
          Math.round((right - left) * 1e6) / 1e6,
          roleChanged,
          startTime,
          snap,
        );
        if (
          coverageChanged &&
          state.initialized &&
          Math.abs(oldTop - top) > 0.5 &&
          previewMotionAllowed()
        ) {
          state.topAnimation?.cancel();
          const animation = WorkTimeApp.ui.animationCompat.animate(
            node,
            [{ top: oldTop + "px" }, { top: top + "px" }],
            {
              duration: 220,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              fill: "both",
            },
            startTime,
          );
          state.topAnimation = animation;
          animation.finished.then(() => {
            if (state.topAnimation === animation) state.topAnimation = null;
          });
        }
        state.clip = { top: clipTop, bottom: clipBottom };
        state.initialized = true;
        state.after = after;
        return node;
      },
    );
    for (const state of current.previewSegments.values()) {
      if (nodes.includes(state.node) || state.stage !== "active") continue;
      state.stage = "exiting";
      state.node.dataset.previewStage = "exiting";
      const width = state.node.getBoundingClientRect().width;
      state.widthAnimation?.cancel();
      state.widthAnimation = null;
      state.node.style.width = width + "px";
      state.widthTarget = undefined;
      state.widthDeadline = 0;
      const top = state.node.getBoundingClientRect().top;
      state.topAnimation?.cancel();
      state.topAnimation = null;
      state.node.style.top = top + "px";
      previewOpacity(state, 0, startTime);
    }
    updatePreviewClips(current);
    watchPreviewClips(current);
  }
  function settleResizePreview(current) {
    current.previewKey = "";
    previewResize(current, true);
    const animations = [];
    for (const state of current.previewSegments?.values() || [])
      for (const animation of [
        state.opacityAnimation,
        state.widthAnimation,
        state.topAnimation,
      ])
        if (animation) animations.push(animation.finished);
    for (const state of current.previewPeers?.values() || [])
      if (state.animation) animations.push(state.animation.finished);
    return Promise.all(animations);
  }
  function resizeReorders(current) {
    const items = getState().items;
    const next = items.map((item) =>
      item.id === current.item.id ? current.candidate : item,
    );
    const visible = cards();
    for (let index = 0; index < visible.length; index += 7) {
      const dates = visible.slice(index, index + 7).map(dateOf);
      if (dates.length !== 7) continue;
      const previous = new Map(
        rules.segments(items, dates).map(({ item, lane }) => [item.id, lane]),
      );
      if (
        rules
          .segments(next, dates)
          .some(
            ({ item, lane }) =>
              previous.has(item.id) && previous.get(item.id) !== lane,
          )
      )
        return true;
    }
    return false;
  }
  async function prepareResizeCommit(current) {
    // Finish the trailing-edge snap before changing persisted lane geometry.
    await settleResizePreview(current);
    if (
      session !== current ||
      (!resizeReorders(current) && !current.previewPeers?.size) ||
      WorkTimeApp.ui.animationCompat.preference().matches ||
      document.hidden
    )
      return;
    current.layoutBefore = new Map(
      [...calendar.querySelectorAll(".agenda-week-lane .agenda-chip")]
        .filter((node) => !node.hidden)
        .map((node) => [segmentKey(node), node.getBoundingClientRect()]),
    );
    for (const [week, state] of current.previewSegments?.entries() || []) {
      if (state.stage !== "active") continue;
      const row = [...calendar.querySelectorAll(".agenda-week-lane")].find(
        (node) => node.dataset.dates.split(",")[0] === week,
      );
      if (row)
        current.layoutBefore.set(
          row.dataset.dates + "/" + current.item.id,
          state.node.getBoundingClientRect(),
        );
    }
  }
  function segmentKey(node) {
    return (
      node.closest(".agenda-week-lane").dataset.dates +
      "/" +
      node.dataset.agendaEdit
    );
  }
  function clearReorder(current) {
    for (const node of current.layoutNodes || [])
      node.classList.remove("agenda-reorder-moving", "agenda-reorder-front");
    current.layoutNodes = [];
  }
  async function revealResizeLayout(current) {
    if (!current.layoutBefore) return;
    const placements = [
      ...calendar.querySelectorAll(".agenda-week-lane .agenda-chip"),
    ]
      .filter((node) => !node.hidden)
      .map((node) => ({
        node,
        before: current.layoutBefore.get(segmentKey(node)),
        after: node.getBoundingClientRect(),
      }))
      .filter(
        ({ before, after }) =>
          before &&
          (Math.abs(before.left - after.left) > 0.5 ||
            Math.abs(before.top - after.top) > 0.5),
      );
    if (WorkTimeApp.ui.animationCompat.preference().matches || document.hidden)
      return;
    current.layoutNodes = placements.map(({ node }) => node);
    // FLIP retained strips in one clock. The resized item rides above its
    // neighbours with an opaque surface; the drag ghost has already retired.
    const startTime = document.timeline.currentTime;
    current.layoutAnimations = placements.map(({ node, before, after }) => {
      node.classList.add("agenda-reorder-moving");
      node.classList.toggle(
        "agenda-reorder-front",
        node.dataset.agendaEdit === current.item.id,
      );
      return WorkTimeApp.ui.animationCompat.animate(
        node,
        [
          {
            transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)`,
          },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: 280,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
        },
        startTime,
      );
    });
    await Promise.all(
      current.layoutAnimations.map((animation) => animation.finished),
    );
    clearReorder(current);
  }
  async function landMove(current) {
    const targets = [...calendar.querySelectorAll(".agenda-chip")].filter(
      (node) =>
        node.dataset.agendaEdit === current.item.id &&
        !node.hidden &&
        node.getClientRects().length,
    );
    const target =
      targets.find((node) => {
        const start =
          node.dataset.agendaSegmentStart || node.closest(".day")?.dataset.date;
        const end = node.dataset.agendaSegmentEnd || start;
        return start <= current.target && current.target <= end;
      }) || targets[0];
    if (!target || !previewMotionAllowed()) return;
    const from = current.moveRelease || current.ghost.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const rect = (bounds) => ({
      left: bounds.left + "px",
      top: bounds.top + "px",
      width: bounds.width + "px",
      height: bounds.height + "px",
    });
    // Keep the very same drag surface through release; reveal the persisted
    // segments only after it reaches the destination. Width/height avoid text scaling.
    const animation = WorkTimeApp.ui.animationCompat.animate(
      current.ghost,
      [rect(from), rect(to)],
      { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
    );
    current.layoutAnimations = [animation];
    await animation.finished;
  }
  function update(event, final = false) {
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
    const card = gridAt(event.clientX, event.clientY);
    if (current.operation !== "resizeEnd") clearDropMarks();
    current.target = card ? dateOf(card) : null;
    // Keep a saturated one-day preview at the left limit rather than toggling
    // invalid opacity when crossing the start date. Strict release still cancels.
    if (
      !final &&
      current.operation === "resizeEnd" &&
      current.target &&
      current.target < current.item.date
    )
      current.target = current.item.date;
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
      if (current.operation !== "resizeEnd") {
        card.classList.add("agenda-drop-target");
        for (const node of cards())
          if (rules.overlaps(current.candidate, dateOf(node), dateOf(node)))
            node.classList.add("agenda-drop-range");
      }
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
      // Commit the same nearest-date interpretation used by the preview.
      update(event, true);
      if (session !== current) return;
      if (
        !current.candidate ||
        (current.operation !== "resizeEnd" &&
          current.target === current.anchor) ||
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
      if (current.operation !== "resizeEnd")
        current.moveRelease = current.ghost.getBoundingClientRect();
      clearDropMarks();
      release(current);
      if (
        current.operation === "resizeEnd" &&
        current.candidate.endDate ===
          (current.item.endDate ?? current.item.date)
      ) {
        // A release within the original end date still needs the same edge
        // snap as a changed date, rather than replacing a partial-width ghost.
        await settleResizePreview(current);
        if (session === current) cancel();
        return;
      }
      if (current.operation === "resizeEnd") await prepareResizeCommit(current);
      if (session !== current) return;
      if (!fresh(current) || !available()) {
        if (!fresh(current)) notify(message("dragChanged"));
        cancel();
        return;
      }
      let success = false;
      if (current.operation !== "resizeEnd")
        document.body.classList.add("agenda-is-dropping");
      try {
        success = await save(
          current.candidate,
          current.target,
          current.operation,
        );
      } catch {
        notify(message("saveFailed"));
      }
      if (session !== current) return;
      current.handoff = true;
      if (success && current.operation !== "resizeEnd") {
        await landMove(current);
        if (session !== current) return;
      }
      restorePreviewRows(current, success);
      stopPreviewMotion(current);
      clearMarks();
      document.body.classList.remove(
        "agenda-is-dragging",
        "agenda-is-resizing",
        "agenda-is-dropping",
      );
      if (success) {
        current.ghost?.remove();
        current.hint?.remove();
      } else retire(current, !success);
      await revealResizeLayout(current);
      if (session === current) session = null;
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
