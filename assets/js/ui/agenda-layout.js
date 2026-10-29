"use strict";
/** Continuous week lanes above the existing, independently painted day surfaces. */
WorkTimeApp.ui.createAgendaLayout = function ({
  calendar,
  getState,
  chip,
  takeChip = () => null,
  updateCompletion = () => false,
  edit,
  select,
  moreLabel,
}) {
  const rules = WorkTimeApp.domain.agenda;
  const scope = new AbortController();
  const layer = document.createElement("div");
  layer.className = "agenda-week-layers";
  let frame = null,
    signature = "",
    disposed = false;
  const scrolls = new Map();
  let packedLayouts = new WeakMap();
  // Text follows explicit date selection, independently of the editor's date.
  let textDate = null;
  let textInitialized = false;
  let animateText = false;
  let rowSignatures = new WeakMap();
  let layoutSignatures = new WeakMap();
  const contentSignatures = new WeakMap();
  const chipSignatures = new WeakMap();
  let selectionLayouts = new WeakMap();
  const watched = new Set();
  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }
  function rows() {
    const cards = [...calendar.querySelectorAll(":scope > .day")].filter(
      (card) => getComputedStyle(card).display !== "none",
    );
    const result = [];
    if (getState().weeks) {
      const groups = new Map();
      for (const card of cards) {
        const key = card.dataset.agendaRow || "1";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(card);
      }
      return [...groups.values()];
    }
    for (let index = 0; index < cards.length; index += 7)
      result.push(cards.slice(index, index + 7));
    return result.filter((row) => row.length === 7);
  }
  function date(card) {
    return card.dataset.date || card.dataset.previewDate;
  }
  function capture() {
    return [...layer.children].map((row) => ({
      dates: row.dataset.dates.split(","),
      rect: row.getBoundingClientRect(),
    }));
  }
  function paintDatePieces(measurements, metrics, edges, dates) {
    const heights = [];
    for (const {
      segment,
      bounds,
      width: chipWidth,
      padding,
      radius,
      borderWidth,
      title,
      rightTextEdge,
      titleLeft,
      contentInset,
      textInsets,
    } of measurements) {
      const { button } = segment;
      heights[segment.lane] = Math.max(
        heights[segment.lane] || 0,
        bounds.height,
      );
      if (segment.end === segment.start) {
        button.dataset.agendaTextDate = dates[segment.start];
        button.style.removeProperty("--agenda-text-offset");
        button.style.removeProperty("--agenda-text-width");
        for (const { node } of textInsets)
          node.style.removeProperty("--agenda-text-offset");
        continue;
      }
      const scaleX = bounds.width / parseFloat(chipWidth);
      const border = parseFloat(borderWidth);
      // Each ordinary overflow container paints only inside one date. The
      // original button remains the single focus, drag and resize target.
      const pixelRatio = window.devicePixelRatio || 1;
      const localEdge = (screen, inward) =>
        ((inward
          ? Math.ceil(screen * pixelRatio)
          : Math.floor(screen * pixelRatio)) /
          pixelRatio -
          bounds.left) /
        scaleX;
      const slices = [...button.querySelectorAll(":scope > .agenda-slice")];
      let sliceIndex = 0;
      const addSlice = (start, end, bridge = false) => {
        const slice = slices[sliceIndex++] || document.createElement("span");
        slice.className = "agenda-slice" + (bridge ? " agenda-bridge" : "");
        slice.setAttribute("aria-hidden", "true");
        Object.assign(slice.style, {
          left: start - border + "px",
          width: Math.max(0, end - start) + "px",
        });
        const face = slice.firstElementChild || document.createElement("span");
        face.className = "agenda-chip-face";
        Object.assign(face.style, {
          left: -start + "px",
          width: chipWidth,
          padding,
          borderLeftWidth: borderWidth,
          borderRadius: radius,
        });
        if (face.parentElement !== slice) slice.append(face);
        if (slice.parentElement !== button) button.append(slice);
      };
      for (let column = segment.start; column <= segment.end; column++) {
        const card = metrics[column];
        const start =
          column === segment.start
            ? 0
            : localEdge(
                card.rect.left +
                  (card.borderLeft + (edges[column] ? 1 : 0)) * scaleX,
                true,
              );
        const end =
          column === segment.end
            ? bounds.width / scaleX
            : localEdge(
                card.rect.right -
                  (card.borderRight + (edges[column] ? 1 : 0)) * scaleX,
                false,
              );
        addSlice(start, end);
        if (column < segment.end) {
          // Use the same fill in the gutter and meet the exact date edges.
          // Extra rounding/clearance creates visible white strips at seams.
          addSlice(
            localEdge(card.rect.right, true),
            localEdge(metrics[column + 1].rect.left, false),
            true,
          );
        }
      }
      for (const slice of slices.slice(sliceIndex)) slice.remove();
      const selectedColumn = dates.indexOf(textDate);
      const targetColumn =
        selectedColumn >= segment.start && selectedColumn <= segment.end
          ? selectedColumn
          : segment.start;
      const gridOffset =
        metrics[targetColumn].left - metrics[segment.start].left;
      const moved = targetColumn !== segment.start;
      // Continuation arrows stay at the ribbon endpoints. Their reserved space
      // must not follow the text into an ordinary date in the middle.
      for (const { node, inset } of textInsets) {
        const offset = gridOffset - (moved ? inset - contentInset : 0);
        node.style.setProperty("--agenda-text-offset", offset + "px");
      }
      button.dataset.agendaTextDate = dates[targetColumn];
      button.style.removeProperty("--agenda-text-offset");
      if (title && titleLeft !== undefined) {
        const target = metrics[targetColumn];
        const inset = (titleLeft - bounds.left) / scaleX;
        const offset = gridOffset - (moved ? inset - contentInset : 0);
        const available = Math.min(
          target.right - target.left - (moved ? contentInset : inset),
          (rightTextEdge - titleLeft) / scaleX - offset,
        );
        title.style.maxWidth = Math.max(0, available) + "px";
        button.style.setProperty(
          "--agenda-text-width",
          Math.max(0, available) + "px",
        );
      }
      button.classList.add("agenda-sliced");
    }
    return heights;
  }
  function measurePlacement(segment) {
    const { button } = segment;
    const bounds = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const title = button.querySelector(".agenda-chip-title-text");
    const textShift = title
      ? parseFloat(getComputedStyle(title).translate) || 0
      : 0;
    return {
      segment,
      bounds,
      width: style.width,
      padding: style.padding,
      radius: style.borderRadius,
      borderWidth: style.borderLeftWidth,
      title,
      contentInset:
        parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      textInsets: [
        ...button.querySelectorAll(
          ".agenda-chip-title-text, :scope > .agenda-chip-time, :scope > .agenda-chip-note",
        ),
      ].map((node) => ({
        node,
        inset:
          ((node.getBoundingClientRect().left - bounds.left) *
            parseFloat(style.width)) /
            bounds.width -
          (parseFloat(getComputedStyle(node).translate) || 0),
      })),
      rightTextEdge: Math.min(
        Infinity,
        ...[
          ...button.querySelectorAll(
            ":scope > .agenda-chip-title > .agenda-chip-status, :scope > .agenda-chip-title > .agenda-chip-continuation:last-child",
          ),
        ].map(
          (icon) =>
            icon.getBoundingClientRect().left -
            ((parseFloat(getComputedStyle(icon.parentElement).columnGap) || 0) *
              bounds.width) /
              parseFloat(style.width),
        ),
      ),
      titleLeft: title
        ? title.getBoundingClientRect().left -
          (textShift * bounds.width) / parseFloat(style.width)
        : undefined,
    };
  }
  function render({ animate = true } = {}) {
    if (disposed) return;
    const state = getState();
    if (!state.active) textInitialized = false;
    else if (!textInitialized) {
      textDate = state.selectedDate || null;
      textInitialized = true;
    }
    // Single-day month cards retain their existing compact content animation.
    const enabled =
      state.active &&
      (state.weeks > 0 ||
        state.items.some((item) => rules.lastDate(item) > item.date));
    calendar.classList.toggle("agenda-lane-view", enabled);
    if (!enabled) {
      layer.remove();
      layer.replaceChildren();
      signature = "";
      return;
    }
    if (state.transitioning) return;
    const leftExtension =
      parseFloat(
        getComputedStyle(calendar).getPropertyValue(
          "--agenda-card-left-extension",
        ),
      ) || 0;
    const groups = rows();
    const geometry = groups.map((cards) => {
      const metrics = cards.map((card) => {
        const style = getComputedStyle(card);
        const rect = card.getBoundingClientRect();
        return {
          left:
            card.offsetLeft +
            card.clientLeft +
            parseFloat(style.paddingLeft) -
            leftExtension,
          rect,
          borderLeft: parseFloat(style.borderLeftWidth),
          borderRight: parseFloat(style.borderRightWidth),
          selected: card.classList.contains("selected"),
          holiday: card.hasAttribute("data-holiday"),
          right:
            card.offsetLeft +
            card.offsetWidth -
            card.clientLeft -
            parseFloat(style.paddingRight),
        };
      });
      const first = cards[0],
        last = cards[cards.length - 1];
      const left =
        first.offsetLeft +
        first.clientLeft +
        parseFloat(getComputedStyle(first).paddingLeft) -
        leftExtension;
      const right =
        last.offsetLeft +
        last.offsetWidth -
        last.clientLeft -
        parseFloat(getComputedStyle(last).paddingRight);
      const top = Math.max(
        ...cards.map((card) => {
          const head = card.querySelector(".daytop");
          return (
            card.offsetTop +
            head.offsetTop +
            head.offsetHeight +
            parseFloat(getComputedStyle(card).rowGap || "0") -
            1
          );
        }),
      );
      const bottom = Math.min(
        ...cards.map(
          (card) =>
            card.offsetTop +
            card.offsetHeight -
            card.clientTop -
            // Month overflow sits close to the card edge to leave another
            // compact agenda row visible above the count.
            (state.weeks
              ? parseFloat(getComputedStyle(card).paddingBottom)
              : 2),
        ),
      );
      return {
        cards,
        metrics,
        edges: cards.map((card) => card.classList.contains("selected")),
        dates: cards.map(date),
        left,
        top,
        width: right - left,
        height: Math.max(0, bottom - top),
      };
    });
    const current = new Set(
      groups.flatMap((cards) =>
        cards.flatMap((card) => [card, card.querySelector(".daytop")]),
      ),
    );
    for (const node of watched)
      if (!current.has(node)) {
        observer.unobserve(node);
        watched.delete(node);
      }
    for (const node of current)
      if (node && !watched.has(node)) {
        observer.observe(node);
        watched.add(node);
      }
    const nextSignature = JSON.stringify([
      textDate,
      state.weeks,
      state.maxLanes,
      state.items,
      geometry.map(({ dates, left, top, width, height, edges }) => [
        dates,
        left,
        top,
        width,
        height,
        edges,
      ]),
      WorkTimeApp.i18n.locale,
    ]);
    if (nextSignature === signature && layer.parentElement === calendar) return;
    const changed = signature !== "";
    signature = nextSignature;
    const focused = layer.contains(document.activeElement)
      ? document.activeElement.dataset.agendaEdit
      : null;
    for (const row of layer.children)
      scrolls.set(row.dataset.dates.split(",")[0], row.scrollTop);
    const previousRows = new Map(
      [...layer.children].map((row) => [row.dataset.dates, row]),
    );
    if (layer.parentElement !== calendar) calendar.append(layer);
    for (const group of geometry) {
      const { dates, metrics, left, top, width, height, edges } = group;
      const key = dates.join(",");
      const row = previousRows.get(key) || document.createElement("div");
      previousRows.delete(key);
      const layoutKind = state.weeks >= 2 ? "packed" : "lanes";
      if (row.dataset.agendaLayout !== layoutKind) {
        row.dataset.agendaLayout = layoutKind;
        selectionLayouts.delete(row);
        layoutSignatures.delete(row);
        contentSignatures.delete(row);
        rowSignatures.delete(row);
        packedLayouts.delete(row);
      }
      const rowItems = state.items.filter((item) =>
        dates.some((date) => rules.overlaps(item, date, date)),
      );
      const rowSignature = JSON.stringify([
        textDate,
        state.weeks,
        state.maxLanes,
        left,
        top,
        width,
        height,
        edges,
        rowItems,
        WorkTimeApp.i18n.locale,
      ]);
      const contentSignature = JSON.stringify([
        state.weeks,
        state.maxLanes,
        rowItems.map(
          ({
            status: _status,
            completed: _completed,
            updatedAt: _updatedAt,
            ...content
          }) => content,
        ),
        WorkTimeApp.i18n.locale,
      ]);
      const layoutSignature = JSON.stringify([
        left,
        top,
        width,
        height,
        edges,
        contentSignature,
      ]);
      const contentChanged =
        contentSignatures.has(row) &&
        contentSignatures.get(row) !== contentSignature;
      if (row.parentElement !== layer) layer.append(row);
      if (rowSignatures.get(row) === rowSignature) continue;
      rowSignatures.set(row, rowSignature);
      row.classList.toggle(
        "agenda-text-shifting",
        animateText && !state.switching,
      );
      if (state.weeks >= 2) {
        renderPackedRow(row, group, rowItems, animate);
        continue;
      }
      // Date selection changes seam clearance and the text anchor.
      // Reuse measured geometry and existing paint nodes instead of rebuilding
      // templates and refreshing every text alignment on the animation's first frame.
      const selectionKey = JSON.stringify([
        state.weeks,
        state.maxLanes,
        dates,
        left,
        top,
        width,
        height,
        rowItems,
        WorkTimeApp.i18n.locale,
        metrics.map(({ rect }) => [
          rect.left,
          rect.top,
          rect.width,
          rect.height,
        ]),
      ]);
      const cached = selectionLayouts.get(row);
      if (cached?.key === selectionKey) {
        paintDatePieces(cached.measurements, metrics, edges, dates);
        continue;
      }

      // A status change cannot affect lane placement, clipping or overflow.
      // Patch existing chips without replaying entrances.
      if (layoutSignatures.get(row) === layoutSignature) {
        // A later undo may restore the exact item data of a cached selection.
        // Its measurements must not bypass repainting the current status.
        selectionLayouts.delete(row);
        const itemsById = new Map(rowItems.map((item) => [item.id, item]));
        for (const button of row.querySelectorAll(".agenda-chip")) {
          const item = itemsById.get(button.dataset.agendaEdit);
          if (!item) continue;
          const template = document.createElement("template");
          const html = chip(item);
          template.innerHTML = html;
          const candidate = template.content.firstElementChild;
          for (const name of ["continues-before", "continues-after"])
            candidate.classList.toggle(name, button.classList.contains(name));
          if (button.classList.contains("continues-after"))
            candidate.querySelector(".agenda-resize-handle")?.remove();
          updateCompletion(button, candidate);
          chipSignatures.set(
            button,
            JSON.stringify([
              html,
              button.classList.contains("continues-before"),
              button.classList.contains("continues-after"),
            ]),
          );
        }
        continue;
      }
      layoutSignatures.set(row, layoutSignature);
      contentSignatures.set(row, contentSignature);
      row.className =
        "agenda-week-lane" +
        (state.weeks && !state.maxLanes ? " is-scrollable" : "");
      row.dataset.dates = dates.join(",");
      row.setAttribute(
        "aria-label",
        WorkTimeApp.i18n.date(dates[0]) +
          " — " +
          WorkTimeApp.i18n.date(dates[dates.length - 1]),
      );
      if (state.weeks) row.tabIndex = 0;
      Object.assign(row.style, {
        left: left + "px",
        top: top + "px",
        width: width + "px",
        height: height + "px",
      });
      const content =
        row.querySelector(".agenda-lane-content") ||
        document.createElement("div");
      content.className = "agenda-lane-content";
      // Date columns define the horizontal grid. Neither an animated lane width
      // nor a transient vertical scrollbar may resize its percentage positions.
      content.style.width = width + "px";
      if (content.parentElement !== row) row.append(content);
      const previousButtons = new Map();
      for (const button of [...content.children]) {
        const id = button.dataset.agendaEdit;
        if (!id || previousButtons.has(id)) {
          button.remove();
          continue;
        }
        previousButtons.set(id, button);
        // Packed runs can split one event and set a measured height. Restore
        // natural sizing before measuring the month and single-week lanes.
        button.style.removeProperty("height");
        button.style.removeProperty("visibility");
        delete button.dataset.packedKey;
      }
      for (const more of row.querySelectorAll(":scope > .agenda-more"))
        more.remove();
      const segments = rules.segments(rowItems, dates).map((segment) => ({
        ...segment,
        continuesBefore: segment.item.date < dates[segment.start],
        continuesAfter: rules.lastDate(segment.item) > dates[segment.end],
      }));
      const heights = [];
      const placements = segments.map((segment, index) => {
        const template = document.createElement("template");
        const html = chip(segment.item);
        template.innerHTML = html;
        const chipSignature = JSON.stringify([
          html,
          segment.continuesBefore,
          segment.continuesAfter,
        ]);
        let button = template.content.firstElementChild;
        const x = metrics[segment.start].left - left;
        const right = metrics[segment.end].right - left;
        Object.assign(button.style, {
          left: (x / width) * 100 + "%",
          width: ((right - x) / width) * 100 + "%",
        });
        button.dataset.agendaSegmentStart = dates[segment.start];
        button.dataset.agendaSegmentEnd = dates[segment.end];
        button.classList.toggle("continues-before", segment.continuesBefore);
        button.classList.toggle("continues-after", segment.continuesAfter);
        if (segment.continuesAfter)
          button.querySelector(".agenda-resize-handle")?.remove();
        const title = button.querySelector(".agenda-chip-title");
        const continuation = (direction) => {
          const icon = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          icon.classList.add("agenda-chip-continuation");
          icon.setAttribute("aria-hidden", "true");
          const use = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "use",
          );
          use.setAttribute("href", "#ms-chevron-" + direction);
          icon.append(use);
          return icon;
        };
        if (segment.continuesBefore) title.prepend(continuation("left"));
        if (segment.continuesAfter) title.append(continuation("right"));
        const borrowed =
          !segment.continuesBefore && !segment.continuesAfter
            ? takeChip(segment.item)
            : null;
        const previous = previousButtons.get(segment.item.id) || borrowed;
        const added = !previous;
        if (
          previous &&
          (chipSignatures.get(previous) === chipSignature ||
            previous === borrowed ||
            updateCompletion(previous, button))
        ) {
          previous.title = button.title;
          previous.classList.toggle(
            "continues-before",
            segment.continuesBefore,
          );
          previous.classList.toggle("continues-after", segment.continuesAfter);
          previous.style.left = button.style.left;
          previous.style.width = button.style.width;
          previous.dataset.agendaSegmentStart =
            button.dataset.agendaSegmentStart;
          previous.dataset.agendaSegmentEnd = button.dataset.agendaSegmentEnd;
          button = previous;
        }
        chipSignatures.set(button, chipSignature);
        if (previous && previous !== button) previous.remove();
        previousButtons.delete(segment.item.id);
        button.hidden = false;
        if (content.children[index] !== button)
          content.insertBefore(button, content.children[index] || null);
        return { ...segment, button, added };
      });
      for (const button of previousButtons.values()) button.remove();
      // Keep native date strokes visible between background-only ribbon pieces.
      // Content remains a single accessible button; selected ribbons paint whole.
      // Ink alignment changes title/time line heights. Settle them before lane
      // placement and note animation endpoints are measured, so releasing the
      // animated height returns to the exact same natural card geometry.
      // Insert all chips before measuring any of them. The cost now scales with
      // calendar rows, rather than forcing layout once for every agenda item.
      for (const { button } of placements) {
        button.classList.remove("agenda-sliced");
        for (const slice of button.querySelectorAll(":scope > .agenda-slice"))
          slice.remove();
        button
          .querySelector(".agenda-chip-title-text")
          ?.style.removeProperty("max-width");
      }
      WorkTimeApp.ui.alignment?.refresh([content]);
      // Batch geometry reads before adding decorative pieces.
      // A dense week must not force layout separately for each painted slice.
      const measurements = placements.map(measurePlacement);
      heights.push(...paintDatePieces(measurements, metrics, edges, dates));
      selectionLayouts.set(row, { key: selectionKey, measurements });
      const positions = [];
      let total = 0;
      for (const laneHeight of heights) {
        positions.push(total);
        total += laneHeight + 3;
      }
      let limit = Math.min(heights.length, state.maxLanes ?? Infinity);
      if (!state.weeks && total > height) {
        limit = 0;
        while (
          limit < heights.length &&
          positions[limit] + heights[limit] <= height - 19
        )
          limit++;
      }
      for (const placement of placements) {
        placement.button.style.top = positions[placement.lane] + "px";
        placement.button.hidden = placement.lane >= limit;
      }
      content.style.height =
        (state.weeks && !state.maxLanes ? total : height) + "px";
      if (!state.weeks || state.maxLanes)
        for (let column = 0; column < dates.length; column++) {
          const count = placements.filter(
            (placement) =>
              placement.lane >= limit &&
              placement.start <= column &&
              placement.end >= column,
          ).length;
          if (!count) continue;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "agenda-more";
          button.dataset.agendaDate = dates[column];
          button.textContent = WorkTimeApp.i18n.number(count) + "+";
          button.setAttribute("aria-label", moreLabel(count));
          Object.assign(button.style, {
            left: metrics[column].left - left + "px",
            bottom: "0",
            width: metrics[column].right - metrics[column].left + "px",
          });
          row.append(button);
        }
      row.scrollTop = scrolls.get(dates[0]) || 0;
      if (
        animate &&
        changed &&
        contentChanged &&
        !state.switching &&
        !state.moving &&
        !state.completing
      )
        for (const { button, added } of placements)
          if (added && !button.hidden)
            WorkTimeApp.ui.motion?.play(button, "motion-card-content");
    }
    for (const row of previousRows.values()) row.remove();
    animateText = false;
    if (focused)
      [...layer.querySelectorAll("[data-agenda-edit]")]
        .find((button) => button.dataset.agendaEdit === focused)
        ?.focus({ preventScroll: true });
  }
  function renderPackedRow(
    row,
    { dates, metrics, edges, left, top, width, height },
    items,
    animate,
  ) {
    row.classList.add("agenda-week-lane", "agenda-packed-row");
    row.classList.remove("is-scrollable");
    row.dataset.dates = dates.join(",");
    row.tabIndex = 0;
    Object.assign(row.style, {
      left: left + "px",
      top: top + "px",
      width: width + "px",
      height: height + "px",
    });
    const key = JSON.stringify([
      dates,
      items.map(
        ({
          status: _status,
          completed: _completed,
          updatedAt: _updatedAt,
          ...item
        }) => item,
      ),
      left,
      top,
      width,
      height,
      WorkTimeApp.i18n.locale,
    ]);
    const cached = packedLayouts.get(row);
    if (cached?.key === key) {
      const byId = new Map(items.map((item) => [item.id, item]));
      for (const button of row.querySelectorAll(".agenda-chip")) {
        const item = byId.get(button.dataset.agendaEdit);
        if (!item) continue;
        const html = chip(item);
        if (chipSignatures.get(button) === html) continue;
        const template = document.createElement("template");
        template.innerHTML = html;
        const candidate = template.content.firstElementChild;
        for (const name of ["continues-before", "continues-after"])
          candidate.classList.toggle(name, button.classList.contains(name));
        if (!button.querySelector(".agenda-resize-handle"))
          candidate.querySelector(".agenda-resize-handle")?.remove();
        if (updateCompletion(button, candidate))
          chipSignatures.set(button, html);
      }
      paintDatePieces(cached.measurements, metrics, edges, dates);
      return;
    }
    // Measurement temporarily changes continuation endpoints and sliced faces.
    // Those states must not start border/shadow transitions on retained chips.
    row.classList.add("agenda-measuring");
    let content = row.querySelector(".agenda-lane-content");
    if (!content) {
      content = document.createElement("div");
      content.className = "agenda-lane-content";
      row.append(content);
    }
    content.style.width = width + "px";
    content.style.height = height + "px";
    for (const more of row.querySelectorAll(":scope > .agenda-more"))
      more.remove();
    const previous = new Map(
      [...content.children].map((node) => [node.dataset.packedKey, node]),
    );
    const previousIds = new Set(
      [...content.children].map((node) => node.dataset.agendaEdit),
    );
    const slots = dates.flatMap((date, column) =>
      rules.forDate(items, date).map((item) => {
        const template = document.createElement("template");
        const html = chip(item);
        template.innerHTML = html;
        let button = previous.get(item.id + ":" + date);
        const wantedHandle = template.content.firstElementChild.querySelector(
          ".agenda-resize-handle",
        );
        if (button) {
          // Continuation edges belong to the compacted run, not to the item
          // markup used for a status/selection-only reuse check.
          button.classList.remove("continues-before", "continues-after");
          const currentHandle = button.querySelector(".agenda-resize-handle");
          if (wantedHandle && !currentHandle)
            button.append(wantedHandle.cloneNode(true));
          else if (!wantedHandle && currentHandle) currentHandle.remove();
        }
        if (
          !button ||
          (chipSignatures.get(button) !== html &&
            !updateCompletion(button, template.content.firstElementChild))
        )
          button = template.content.firstElementChild;
        chipSignatures.set(button, html);
        if (!button.querySelector(".agenda-resize-handle")) {
          const handle = template.content.firstElementChild.querySelector(
            ".agenda-resize-handle",
          );
          if (handle) button.append(handle.cloneNode(true));
        }
        button.dataset.packedKey = item.id + ":" + date;
        button.classList.remove(
          "agenda-sliced",
          "continues-before",
          "continues-after",
        );
        for (const node of button.querySelectorAll(
          ":scope > .agenda-slice, .agenda-chip-continuation",
        ))
          node.remove();
        decoratePacked(button, item, column, column, dates);
        for (const node of button.querySelectorAll(
          ".agenda-chip-title-text, :scope > .agenda-chip-time, :scope > .agenda-chip-note",
        )) {
          node.style.removeProperty("--agenda-text-offset");
          node.style.removeProperty("max-width");
        }
        button.style.removeProperty("--agenda-text-width");
        button.hidden = false;
        Object.assign(button.style, {
          left: metrics[column].left - left + "px",
          top: "0px",
          width: metrics[column].right - metrics[column].left + "px",
          height: "auto",
          visibility: "hidden",
        });
        content.append(button);
        return {
          item,
          button,
          start: column,
          end: column,
          lane: 0,
          top: 0,
          height: 0,
        };
      }),
    );
    const used = new Set(slots.map((s) => s.button));
    for (const node of [...content.children])
      if (!used.has(node)) node.remove();
    WorkTimeApp.ui.alignment?.refresh([content]);
    for (const slot of slots)
      slot.height = slot.button.getBoundingClientRect().height;
    // A cross-date event is one ribbon. Lay out its entire span together;
    // independently compacting each date changes its row when another event
    // ends, or when a narrow endpoint wraps a note to a different height.
    const ribbons = new Map();
    for (const slot of slots) {
      if (!ribbons.has(slot.item.id)) ribbons.set(slot.item.id, []);
      ribbons.get(slot.item.id).push(slot);
    }
    const creationOrder = new Map(items.map((item, index) => [item.id, index]));
    const ordered = [...ribbons.values()].sort(
      ([a], [b]) =>
        Number(b.item.allDay) - Number(a.item.allDay) ||
        a.item.start.localeCompare(b.item.start) ||
        a.item.createdAt.localeCompare(b.item.createdAt) ||
        creationOrder.get(a.item.id) - creationOrder.get(b.item.id),
    );
    const bottoms = Array(dates.length).fill(0);
    for (const ribbon of ordered) {
      const y = Math.max(...ribbon.map((slot) => bottoms[slot.start]));
      const ribbonHeight = Math.max(...ribbon.map((slot) => slot.height));
      for (const slot of ribbon) {
        slot.top = y;
        slot.height = ribbonHeight;
        bottoms[slot.start] = y + ribbonHeight + 3;
      }
    }
    const limits = bottoms.map((bottom) =>
      bottom - 3 > height ? height - 19 : height,
    );
    const overflow = new Map();
    for (const ribbon of ordered) {
      const hidden = ribbon.some(
        (slot) => slot.top + slot.height > limits[slot.start],
      );
      for (const slot of ribbon) {
        slot.button.hidden = hidden;
        if (hidden)
          overflow.set(slot.start, (overflow.get(slot.start) || 0) + 1);
      }
    }
    const groups = [];
    for (const slot of slots
      .filter((s) => !s.button.hidden)
      .sort(
        (a, b) => a.item.id.localeCompare(b.item.id) || a.start - b.start,
      )) {
      const last = groups[groups.length - 1];
      if (
        last &&
        last.item.id === slot.item.id &&
        last.end + 1 === slot.start &&
        Math.abs(last.top - slot.top) < 0.5 &&
        Math.abs(last.height - slot.height) < 0.5
      ) {
        last.end = slot.end;
        slot.button.remove();
      } else groups.push({ ...slot });
    }
    for (const group of groups) {
      const { button, item, start, end } = group;
      group.continuesBefore = item.date < dates[start];
      group.continuesAfter = rules.lastDate(item) > dates[end];
      button.dataset.agendaSegmentStart = dates[start];
      button.dataset.agendaSegmentEnd = dates[end];
      decoratePacked(button, item, start, end, dates);
      if (group.continuesAfter)
        button.querySelector(".agenda-resize-handle")?.remove();
      Object.assign(button.style, {
        left: metrics[start].left - left + "px",
        top: group.top + "px",
        width: metrics[end].right - metrics[start].left + "px",
        height: group.height + "px",
        visibility: "",
      });
    }
    for (const slot of slots.filter((s) => s.button.hidden))
      slot.button.style.visibility = "";
    const measurements = groups.map(measurePlacement);
    paintDatePieces(measurements, metrics, edges, dates);
    // Resolve the final ribbon styles with transitions still disabled, then
    // restore ordinary selection/hover feedback before the next painted frame.
    void content.offsetHeight;
    row.classList.remove("agenda-measuring");
    packedLayouts.set(row, { key, measurements });
    const state = getState();
    if (
      cached &&
      animate &&
      !state.transitioning &&
      !state.switching &&
      !state.moving &&
      !state.completing
    )
      for (const { button, item } of groups)
        if (!previousIds.has(item.id))
          WorkTimeApp.ui.motion?.play(button, "motion-card-content");
    for (const [column, count] of overflow) {
      if (!count) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "agenda-more";
      button.dataset.agendaDate = dates[column];
      button.textContent = WorkTimeApp.i18n.number(count) + "+";
      button.setAttribute("aria-label", moreLabel(count));
      Object.assign(button.style, {
        left: metrics[column].left - left + "px",
        bottom: "0px",
        width: metrics[column].right - metrics[column].left + "px",
      });
      row.append(button);
    }
    row.scrollTop = 0;
  }
  function decoratePacked(button, item, start, end, dates) {
    const before = item.date < dates[start],
      after = rules.lastDate(item) > dates[end];
    button.classList.toggle("continues-before", before);
    button.classList.toggle("continues-after", after);
    for (const icon of button.querySelectorAll(".agenda-chip-continuation"))
      icon.remove();
    const title = button.querySelector(".agenda-chip-title");
    for (const [show, direction] of [
      [before, "left"],
      [after, "right"],
    ]) {
      if (!show) continue;
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      icon.classList.add("agenda-chip-continuation");
      icon.setAttribute("aria-hidden", "true");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#ms-chevron-" + direction);
      icon.append(use);
      if (direction === "left") title.prepend(icon);
      else title.append(icon);
    }
  }
  function schedule() {
    if (frame !== null || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      render();
    });
  }
  const observer = new ResizeObserver(schedule);
  observer.observe(calendar);
  const invalidate = () => {
    // A font can change chip height without changing any date-card geometry.
    // Clear every layout shortcut so the next render actually remeasures it.
    rowSignatures = new WeakMap();
    layoutSignatures = new WeakMap();
    selectionLayouts = new WeakMap();
    packedLayouts = new WeakMap();
    signature = "";
    schedule();
  };
  document.fonts?.ready.then(invalidate);
  document.fonts?.addEventListener("loadingdone", invalidate, {
    signal: scope.signal,
  });
  layer.addEventListener(
    "click",
    (event) => {
      const state = getState();
      if (state.busy) return;
      const button = event.target.closest("button");
      const row = event.target.closest(".agenda-week-lane");
      if (!row) return;
      const dates = row.dataset.dates.split(",");
      const rect = row.getBoundingClientRect();
      const chosen =
        dates[
          Math.max(
            0,
            Math.min(
              dates.length - 1,
              Math.floor(
                ((event.clientX - rect.left) / rect.width) * dates.length,
              ),
            ),
          )
        ];
      if (button?.dataset.agendaEdit) edit(button.dataset.agendaEdit, true);
      else if (button?.dataset.agendaDate) select(button.dataset.agendaDate);
      else if (!button) select(chosen);
    },
    { signal: scope.signal },
  );
  return {
    selectTextDate(date) {
      animateText = textInitialized && textDate !== date;
      textDate = date;
      textInitialized = true;
    },
    settleText() {
      animateText = false;
      for (const row of layer.children)
        row.classList.remove("agenda-text-shifting");
    },
    render,
    capture,
    stop,
    planAnimation(before, expandNotes = false, dayMotions = new Map()) {
      stop();
      const plans = [];
      const plan = (element, frames, options) => ({ element, frames, options });
      const timing = WorkTimeApp.ui.motion.calendar;
      if (
        WorkTimeApp.ui.animationCompat.preference().matches ||
        document.hidden
      )
        return [];
      for (const row of layer.children) {
        const old = before.find((entry) =>
          entry.dates.some((day) => row.dataset.dates.split(",").includes(day)),
        );
        const rect = row.getBoundingClientRect();
        // Overlay lanes live outside the day nodes. Reuse the owning day's
        // exact trajectory and clock, including compact-month -> new week lanes.
        const source = row.dataset.dates
          .split(",")
          .map((day) => dayMotions.get(day))
          .find(Boolean);
        let frames = source
          ? source.frames.map((frame) => {
              const value = { ...frame };
              const final = source.frames[source.frames.length - 1];
              if (frame.height && final.height)
                value.height =
                  Math.max(
                    0,
                    rect.height +
                      parseFloat(frame.height) -
                      parseFloat(final.height),
                  ) + "px";
              delete value.width;
              return value;
            })
          : [
              {
                opacity: 0.4,
                transform: old
                  ? `translateY(${old.rect.top - rect.top}px)`
                  : "translateY(6px)",
              },
              { opacity: 1, transform: "none" },
            ];
        if (frames.some((frame) => frame.opacity !== undefined)) {
          plans.push(
            plan(
              row,
              frames.map(({ opacity }) => ({ opacity })),
              {
                duration: source?.options.duration || timing.duration,
                easing: "ease-out",
                fill: "both",
              },
            ),
          );
          frames = frames.map(({ opacity: _opacity, ...frame }) => frame);
        }
        plans.push(
          plan(
            row,
            frames,
            source?.options || {
              duration: timing.duration,
              easing: timing.easing,
              fill: "both",
            },
          ),
        );
        if (source) {
          const x = (frame) =>
            new DOMMatrix(
              frame.transform === "none" ? undefined : frame.transform,
            ).m41;
          const rowStartX = x(source.frames[0]);
          for (const button of row.querySelectorAll(".agenda-chip")) {
            const owner = dayMotions.get(button.dataset.agendaSegmentStart);
            if (!owner) continue;
            const offset = x(owner.frames[0]) - rowStartX;
            if (Math.abs(offset) < 0.01) continue;
            plans.push(
              plan(
                button,
                [
                  { transform: `translateX(${offset}px)` },
                  { transform: "translateX(0)" },
                ],
                source.options,
              ),
            );
          }
        }
        if (expandNotes)
          for (const note of row.querySelectorAll(
            ".agenda-chip > .agenda-chip-note",
          )) {
            if (!note.getClientRects().length) continue;
            const button = note.closest(".agenda-chip");
            const height = button.getBoundingClientRect().height;
            const compact =
              height -
              note.getBoundingClientRect().height -
              parseFloat(getComputedStyle(note).marginTop);
            // Clip expanding notes vertically without hiding the continuation
            // borders and resize handles painted outside the chip edges.
            plans.push(
              plan(
                button,
                [
                  {
                    height: Math.max(16, compact) + "px",
                    clipPath: "inset(0 -7px 0 -2px)",
                  },
                  { height: height + "px", clipPath: "inset(0 -7px 0 -2px)" },
                ],
                {
                  duration: timing.duration,
                  easing: timing.easing,
                  fill: "both",
                },
              ),
              plan(note, [{ opacity: 0 }, { opacity: 1 }], {
                duration: timing.duration,
                easing: timing.easing,
                fill: "both",
              }),
            );
          }
      }
      return plans;
    },
    dispose() {
      disposed = true;
      stop();
      observer.disconnect();
      scope.abort();
      if (frame !== null) cancelAnimationFrame(frame);
      layer.remove();
      calendar.classList.remove("agenda-lane-view");
    },
  };
};
