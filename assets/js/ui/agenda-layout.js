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
  const rowSignatures = new WeakMap();
  const contentSignatures = new WeakMap();
  const chipSignatures = new WeakMap();
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
  function render({ animate = true } = {}) {
    if (disposed) return;
    const state = getState();
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
    const groups = rows();
    const geometry = groups.map((cards) => {
      const metrics = cards.map((card) => {
        const style = getComputedStyle(card);
        return {
          left:
            card.offsetLeft + card.clientLeft + parseFloat(style.paddingLeft),
          right:
            card.offsetLeft +
            card.offsetWidth -
            card.clientLeft -
            parseFloat(style.paddingRight),
          rect: card.getBoundingClientRect(),
          borderLeft: parseFloat(style.borderLeftWidth),
          borderRight: parseFloat(style.borderRightWidth),
        };
      });
      const first = cards[0],
        last = cards[6];
      const left =
        first.offsetLeft +
        first.clientLeft +
        parseFloat(getComputedStyle(first).paddingLeft);
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
            parseFloat(getComputedStyle(card).rowGap || "0") +
            4
          );
        }),
      );
      const bottom = Math.min(
        ...cards.map(
          (card) =>
            card.offsetTop +
            card.offsetHeight -
            card.clientTop -
            parseFloat(getComputedStyle(card).paddingBottom),
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
      state.weeks,
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
      const rowSignature = JSON.stringify([
        state.weeks,
        left,
        top,
        width,
        height,
        edges,
        state.items.filter((item) => rules.overlaps(item, dates[0], dates[6])),
        WorkTimeApp.i18n.locale,
      ]);
      const contentSignature = JSON.stringify([
        state.weeks,
        state.items.filter((item) => rules.overlaps(item, dates[0], dates[6])),
        WorkTimeApp.i18n.locale,
      ]);
      const contentChanged =
        contentSignatures.has(row) &&
        contentSignatures.get(row) !== contentSignature;
      if (row.parentElement !== layer) layer.append(row);
      if (rowSignatures.get(row) === rowSignature) continue;
      rowSignatures.set(row, rowSignature);
      contentSignatures.set(row, contentSignature);
      row.className =
        "agenda-week-lane" + (state.weeks ? " is-scrollable" : "");
      row.dataset.dates = dates.join(",");
      row.setAttribute(
        "aria-label",
        WorkTimeApp.i18n.date(dates[0]) +
          " — " +
          WorkTimeApp.i18n.date(dates[6]),
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
      const previousButtons = new Map(
        [...content.children].map((button) => [
          button.dataset.agendaEdit,
          button,
        ]),
      );
      for (const more of row.querySelectorAll(":scope > .agenda-more"))
        more.remove();
      const segments = rules.segments(state.items, dates);
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
        return { ...segment, button };
      });
      for (const button of previousButtons.values()) button.remove();
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
      const measurements = placements.map((segment) => {
        const { button } = segment;
        const bounds = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          segment,
          bounds,
          width: style.width,
          padding: style.padding,
          radius: style.borderRadius,
          borderWidth: style.borderLeftWidth,
          title: button.querySelector(".agenda-chip-title-text"),
          titleLeft: button
            .querySelector(".agenda-chip-title-text")
            ?.getBoundingClientRect().left,
        };
      });
      for (const {
        segment,
        bounds,
        width: chipWidth,
        padding,
        radius,
        borderWidth,
        title,
        titleLeft,
      } of measurements) {
        const { button } = segment;
        heights[segment.lane] = Math.max(
          heights[segment.lane] || 0,
          bounds.height,
        );
        if (segment.end === segment.start) continue;
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
        const addSlice = (start, end, bridge = false) => {
          const slice = document.createElement("span");
          slice.className = "agenda-slice" + (bridge ? " agenda-bridge" : "");
          slice.setAttribute("aria-hidden", "true");
          Object.assign(slice.style, {
            left: start - border + "px",
            width: Math.max(0, end - start) + "px",
          });
          const face = document.createElement("span");
          face.className = "agenda-chip-face";
          Object.assign(face.style, {
            left: -start + "px",
            width: chipWidth,
            padding,
            borderLeftWidth: borderWidth,
            borderRadius: radius,
          });
          slice.append(face);
          button.append(slice);
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
        // Keep the heading in the first visible date of this week segment.
        // The continuation icon consumes space naturally through titleLeft;
        // the status and trailing continuation stay at the far end of the strip.
        if (title && titleLeft !== undefined) {
          const first = metrics[segment.start];
          const available =
            first.right - first.left - (titleLeft - bounds.left) / scaleX;
          title.style.maxWidth = Math.max(0, available) + "px";
        }
        button.classList.add("agenda-sliced");
      }
      const positions = [];
      let total = 0;
      for (const laneHeight of heights) {
        positions.push(total);
        total += laneHeight + 3;
      }
      let limit = heights.length;
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
      content.style.height = (state.weeks ? total : height) + "px";
      if (!state.weeks)
        for (let column = 0; column < 7; column++) {
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
        WorkTimeApp.ui.motion?.play(content, "motion-card-content");
    }
    for (const row of previousRows.values()) row.remove();
    if (focused)
      [...layer.querySelectorAll("[data-agenda-edit]")]
        .find((button) => button.dataset.agendaEdit === focused)
        ?.focus({ preventScroll: true });
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
              6,
              Math.floor(((event.clientX - rect.left) / rect.width) * 7),
            ),
          )
        ];
      if (button?.dataset.agendaEdit)
        edit(
          button.dataset.agendaEdit,
          event.detail ? chosen : button.dataset.agendaSegmentStart,
        );
      else if (button?.dataset.agendaDate) select(button.dataset.agendaDate);
      else if (!button) select(chosen);
    },
    { signal: scope.signal },
  );
  return {
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
