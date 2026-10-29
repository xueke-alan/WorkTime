"use strict";
/** Keep date strokes above independently moving cross-date agenda ribbons. */
WorkTimeApp.ui.createAgendaEdges = function ({ calendar, enabled }) {
  const layer = document.createElement("div");
  layer.className = "agenda-date-edges";
  layer.setAttribute("aria-hidden", "true");
  const edges = new Map();
  let frame = null;
  let disposed = false;
  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }
  function request() {
    if (!disposed && frame === null && enabled())
      frame = requestAnimationFrame(paint);
  }
  function paint() {
    frame = null;
    if (disposed || !enabled()) {
      layer.remove();
      layer.replaceChildren();
      edges.clear();
      return;
    }
    const bounds = calendar.getBoundingClientRect();
    const calendarStyle = getComputedStyle(calendar);
    // offsetWidth/Height round fractional layout sizes and would introduce a
    // small scale error even when the calendar has no scale transform.
    const sx = bounds.width / parseFloat(calendarStyle.width) || 1;
    const sy = bounds.height / parseFloat(calendarStyle.height) || 1;
    const styles = new Map();
    const styleFor = (node) => {
      if (!styles.has(node)) styles.set(node, getComputedStyle(node));
      return styles.get(node);
    };
    const sources = [
      ...calendar.querySelectorAll(
        ":scope > .day, .agenda-timetable > .timetable-bottom-card, .agenda-weekend-exit > .day",
      ),
    ];
    const wanted = new Set();
    // Read the current native-animation geometry before making paint writes.
    const paints = sources.flatMap((source) => {
      const style = styleFor(source);
      if (style.display === "none" || style.visibility === "hidden") return [];
      const rect = source.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      wanted.add(source);
      let opacity = 1;
      for (
        let parent = source;
        parent && parent !== calendar;
        parent = parent.parentElement
      )
        opacity *= Number(styleFor(parent).opacity);
      return [
        {
          source,
          rect,
          opacity,
          border: style.border,
          radius: style.borderRadius,
          shadow: style.boxShadow,
        },
      ];
    });
    for (const [source, edge] of edges) {
      if (!wanted.has(source)) {
        edge.remove();
        edges.delete(source);
      }
    }
    if (layer.parentElement !== calendar) calendar.append(layer);
    for (const { source, rect, opacity, border, radius, shadow } of paints) {
      let edge = edges.get(source);
      if (!edge) {
        edge = document.createElement("span");
        edge.className = "agenda-date-edge";
        edges.set(source, edge);
        layer.append(edge);
      }
      edge.dataset.edgeDate =
        source.dataset.date ||
        source.dataset.previewDate ||
        source.dataset.timetableDate;
      edge.dataset.kind = source.classList.contains("day") ? "day" : "timed";
      edge.dataset.ghost = String(!!source.closest(".agenda-weekend-exit"));
      Object.assign(edge.style, {
        left:
          (rect.left - bounds.left) / sx -
          calendar.clientLeft +
          calendar.scrollLeft +
          "px",
        top:
          (rect.top - bounds.top) / sy -
          calendar.clientTop +
          calendar.scrollTop +
          "px",
        width: rect.width / sx + "px",
        height: rect.height / sy + "px",
        opacity: String(opacity),
        border,
        borderRadius: radius,
        boxShadow: shadow,
      });
    }
    if (
      calendar
        .getAnimations({ subtree: true })
        .some(
          (animation) =>
            (animation.effect?.target === calendar ||
              styles.has(animation.effect?.target)) &&
            (animation.pending || animation.playState === "running"),
        )
    )
      request();
  }
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) => record.target !== layer && !layer.contains(record.target),
      )
    )
      request();
  });
  observer.observe(calendar, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  const resize = new ResizeObserver(request);
  resize.observe(calendar);
  return {
    refresh() {
      stop();
      paint();
    },
    dispose() {
      disposed = true;
      stop();
      observer.disconnect();
      resize.disconnect();
      layer.remove();
      edges.clear();
    },
  };
};
