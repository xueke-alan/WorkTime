"use strict";
/** Agenda rendering helpers with explicit dependencies; no persistence or view state. */
WorkTimeApp.ui.createAgendaChipMotion = function ({ calendar, document }) {
  function captureAgendaEdge(node) {
    const face =
      (!node.classList.contains("is-selected") &&
        node.querySelector(".agenda-chip-face")) ||
      node;
    const style = getComputedStyle(face);
    return {
      paint: Object.fromEntries(
        [
          "boxShadow",
          "borderLeftColor",
          "borderTopLeftRadius",
          "borderBottomLeftRadius",
          "borderTopRightRadius",
          "borderBottomRightRadius",
        ].map((key) => [key, style[key]]),
      ),
      ends: ["::before", "::after"].map((pseudo) => {
        const edge = getComputedStyle(face, pseudo);
        return { opacity: edge.opacity, width: edge.width };
      }),
    };
  }
  function agendaEdgePlans(old, node, timing) {
    if (!old.edge) return [];
    const faces = [...node.querySelectorAll(".agenda-chip-face")];
    const targets =
      faces.length && !node.classList.contains("is-selected") ? faces : [node];
    const plans = [];
    for (const target of targets) {
      const style = getComputedStyle(target);
      const paint = Object.fromEntries(
        Object.keys(old.edge.paint).map((key) => [key, style[key]]),
      );
      plans.push({
        element: target,
        frames: [old.edge.paint, paint],
        options: timing,
      });
      for (const [index, pseudo] of ["::before", "::after"].entries()) {
        const edge = getComputedStyle(target, pseudo);
        plans.push({
          element: target,
          frames: [
            old.edge.ends[index],
            { opacity: edge.opacity, width: edge.width },
          ],
          options: { ...timing, pseudoElement: pseudo },
        });
      }
    }
    return plans;
  }
  function weekendChipPlans(before, timing, transition) {
    const plans = [];
    for (const node of calendar.querySelectorAll(
      ".agenda-week-lane .agenda-chip[data-agenda-edit]:not([hidden]), .timetable-column .timetable-event[data-agenda-edit]",
    )) {
      const date =
        node.dataset.agendaSegmentStart || node.dataset.timetableDate;
      const endDate = node.dataset.agendaSegmentEnd || date;
      const old = before.find(
        (item) =>
          item.id === node.dataset.agendaEdit &&
          item.date <= endDate &&
          item.end >= date,
      );
      const rect = node.getBoundingClientRect();
      if (!old) {
        if (!node.classList.contains("timetable-event"))
          plans.push({
            element: node,
            frames: [{ opacity: 0 }, { opacity: 1 }],
            options: timing,
          });
        continue;
      }
      plans.push(...agendaEdgePlans(old, node, timing));
      const dx = old.rect.left - rect.left,
        dy = old.rect.top - rect.top;
      if (node.classList.contains("timetable-event")) {
        const style = getComputedStyle(node);
        plans.push({
          element: node,
          frames: [
            {
              left: old.rect.left - old.parentRect.left + "px",
              top: old.rect.top - old.parentRect.top + "px",
              width: old.rect.width + "px",
              height: old.rect.height + "px",
            },
            {
              left: style.left,
              top: style.top,
              width: style.width,
              height: style.height,
            },
          ],
          options: timing,
        });
      } else
        plans.push({
          element: node,
          frames: [
            {
              transform: `translate(${dx}px, ${dy}px)`,
              width: old.rect.width + "px",
              height: old.rect.height + "px",
            },
            {
              transform: "none",
              width: rect.width + "px",
              height: rect.height + "px",
            },
          ],
          options: timing,
        });
      const previous = new Map(
        (old.parts || []).map((part) => [part.key, part]),
      );
      for (const part of node.querySelectorAll(
        ".agenda-chip-title-text, .agenda-chip-time, .agenda-chip-note, .agenda-chip-status, .agenda-chip-continuation",
      )) {
        if (!part.getClientRects().length) continue;
        // The status indicator is right-anchored inside the animated card.
        // Its native anchor already follows width changes; an extra FLIP
        // translation would apply the same horizontal movement twice.
        if (part.classList.contains("agenda-chip-status")) continue;
        const key = part.classList.contains("agenda-chip-continuation")
          ? "arrow:" + part.querySelector("use")?.getAttribute("href")
          : part.classList[0];
        const source = previous.get(key),
          target = part.getBoundingClientRect(),
          style = getComputedStyle(part);
        const translate =
          style.translate === "none"
            ? [0, 0]
            : style.translate.split(" ").map((value) => parseFloat(value) || 0);
        if (source) {
          previous.delete(key);
          const clip = style.maxWidth.endsWith("px");
          plans.push({
            element: part,
            frames: [
              {
                translate: `${translate[0] + source.rect.left - target.left - dx}px ${(translate[1] || 0) + source.rect.top - target.top - dy}px`,
                ...(clip ? { maxWidth: source.rect.width + "px" } : {}),
              },
              {
                translate: style.translate,
                ...(clip ? { maxWidth: style.maxWidth } : {}),
              },
            ],
            options: timing,
          });
        } else if (key.startsWith("arrow:"))
          plans.push({
            element: part,
            frames: [
              { opacity: 0, translate: "8px 0px" },
              { opacity: 1, translate: "0px 0px" },
            ],
            options: timing,
          });
      }
      for (const [key, source] of previous) {
        if (!key.startsWith("arrow:")) continue;
        const ghost = source.clone;
        ghost.classList.add("agenda-arrow-exit");
        ghost.setAttribute("aria-hidden", "true");
        Object.assign(ghost.style, {
          position: "absolute",
          left: source.rect.left - old.rect.left + "px",
          top: source.rect.top - old.rect.top + "px",
          width: source.rect.width + "px",
          height: source.rect.height + "px",
          opacity: "0",
          pointerEvents: "none",
        });
        node.append(ghost);
        transition.exits.push(ghost);
        plans.push({
          element: ghost,
          frames: [
            { opacity: 1, translate: "0px 0px" },
            { opacity: 0, translate: "8px 0px" },
          ],
          options: timing,
        });
      }
    }
    return plans;
  }
  function weekToFortnightChipPlans(before, dayMotions, timing, transition) {
    const plans = [];
    const bounds = calendar.getBoundingClientRect();
    const rows = [...calendar.querySelectorAll(".agenda-week-lane")];
    const destinations = rows.flatMap((row) => {
      const content = row.querySelector(".agenda-lane-content");
      const origin = content.getBoundingClientRect();
      return [...content.querySelectorAll(".agenda-chip")].map((node) => ({
        node,
        id: node.dataset.agendaEdit,
        date: node.dataset.agendaSegmentStart,
        end: node.dataset.agendaSegmentEnd,
        rect: node.hidden
          ? {
              left: origin.left + parseFloat(node.style.left),
              top: origin.top + parseFloat(node.style.top),
              width: parseFloat(node.style.width),
              height: parseFloat(node.style.height),
            }
          : node.getBoundingClientRect(),
      }));
    });
    const overlaps = (a, b) =>
      a.id === b.id && a.date <= b.end && a.end >= b.date;
    const used = new Set();
    for (const row of rows) {
      transition.styles.set(row, row.getAttribute("style"));
      row.style.overflow = "visible";
    }
    for (const target of destinations.filter(({ node }) => !node.hidden)) {
      const { node, rect } = target;
      const candidates = before.filter((old) => overlaps(old, target));
      const old =
        candidates.find((item) => item.date === target.date) || candidates[0];
      if (old) {
        used.add(old);
        plans.push(...agendaEdgePlans(old, node, timing));
      }
      const owner = dayMotions.get(target.date);
      const entry = owner?.frames[0];
      const offset = entry
        ? new DOMMatrix(
            entry.transform === "none" ? undefined : entry.transform,
          )
        : null;
      const source = old?.rect || {
        left: rect.left + (offset?.m41 || 0),
        top: rect.top + (offset?.m42 || 0),
        width: rect.width,
        height: rect.height,
      };
      const dx = source.left - rect.left;
      const dy = source.top - rect.top;
      const paint = Object.fromEntries(
        [
          "paddingTop",
          "paddingBottom",
          "paddingLeft",
          "paddingRight",
          "borderLeftWidth",
        ].map((key) => [key, getComputedStyle(node)[key]]),
      );
      transition.styles.set(node, node.getAttribute("style"));
      node.style.clipPath = "inset(0)";
      plans.push({
        element: node,
        frames: [
          {
            transform: `translate(${dx}px, ${dy}px)`,
            width: source.width + "px",
            height: source.height + "px",
            opacity: old ? 1 : 0,
            ...(old?.paint || paint),
          },
          {
            transform: "none",
            width: rect.width + "px",
            height: rect.height + "px",
            opacity: 1,
            ...paint,
          },
        ],
        options: timing,
      });
      // Preserve the source ink position as a time block becomes a ribbon.
      for (const part of node.querySelectorAll(
        ".agenda-chip-title-text, .agenda-chip-time, .agenda-chip-note, .agenda-chip-status",
      )) {
        const previous = old?.parts.find(
          (item) => item.key === part.classList[0],
        );
        if (!previous || !part.getClientRects().length) continue;
        const targetPart = part.getBoundingClientRect();
        const style = getComputedStyle(part);
        const translate =
          style.translate === "none"
            ? [0, 0]
            : style.translate.split(" ").map(parseFloat);
        plans.push({
          element: part,
          frames: [
            {
              translate: `${translate[0] + previous.rect.left - targetPart.left - dx}px ${(translate[1] || 0) + previous.rect.top - targetPart.top - dy}px`,
            },
            { translate: style.translate },
          ],
          options: timing,
        });
      }
    }
    const outgoing = before.filter((old) => !used.has(old) && old.exit);
    if (outgoing.length) {
      const layer = document.createElement("div");
      layer.className =
        "agenda-timetable agenda-week-lane agenda-chip-view-exits";
      layer.inert = true;
      layer.setAttribute("aria-hidden", "true");
      Object.assign(layer.style, {
        inset: "0",
        overflow: "visible",
        zIndex: "6",
      });
      calendar.append(layer);
      (transition.exits ||= []).push(layer);
      for (const old of outgoing) {
        const target = destinations.find((entry) => overlaps(old, entry));
        const owner = dayMotions.get(old.date);
        const final = owner?.frames.at(-1);
        const first = owner?.frames[0];
        const startOffset = first
          ? new DOMMatrix(
              first.transform === "none" ? undefined : first.transform,
            )
          : null;
        const endOffset = final
          ? new DOMMatrix(
              final.transform === "none" ? undefined : final.transform,
            )
          : null;
        const destination = target?.rect || {
          ...old.rect.toJSON(),
          left: old.rect.left + (endOffset?.m41 || 0) - (startOffset?.m41 || 0),
          top: old.rect.top + (endOffset?.m42 || 0) - (startOffset?.m42 || 0),
        };
        const ghost = old.exit;
        ghost.classList.add("agenda-chip-view-exit");
        ghost.dataset.exitId = old.id;
        ghost.dataset.exitDate = old.date;
        for (const node of [
          ghost,
          ...ghost.querySelectorAll("[id], [data-agenda-edit]"),
        ]) {
          node.removeAttribute("id");
          node.removeAttribute("data-agenda-edit");
        }
        Object.assign(ghost.style, {
          left: old.rect.left - bounds.left - calendar.clientLeft + "px",
          top:
            old.rect.top -
            bounds.top -
            calendar.clientTop +
            calendar.scrollTop +
            "px",
          width: old.rect.width + "px",
          height: old.rect.height + "px",
          margin: "0",
          pointerEvents: "none",
          transition: "none",
          opacity: "0",
        });
        layer.append(ghost);
        plans.push({
          element: ghost,
          frames: [
            {
              transform: "none",
              width: old.rect.width + "px",
              height: old.rect.height + "px",
              opacity: 1,
            },
            {
              transform: `translate(${destination.left - old.rect.left}px, ${destination.top - old.rect.top}px)`,
              width: destination.width + "px",
              height: destination.height + "px",
              opacity: 0,
            },
          ],
          options: timing,
        });
      }
    }
    return plans;
  }
  return { captureAgendaEdge, weekendChipPlans, weekToFortnightChipPlans };
};
