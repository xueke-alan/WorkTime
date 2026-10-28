"use strict";
/** Own analysis DOM reconciliation and animation state; the view supplies data and interaction. */
WorkTimeApp.ui.createAnalysisRenderer = function ({
  element: $,
  window,
  onFrame,
}) {
  const motionPreference = WorkTimeApp.ui.animationCompat.preference();
  const feedbackAnimations = new Map();
  function feedback(element, entering = true) {
    feedbackAnimations.get(element)?.cancel();
    feedbackAnimations.delete(element);
    if (!entering || !canAnimate()) return;
    const animation = WorkTimeApp.ui.animationCompat.animate(
      element,
      [
        { opacity: 0, transform: "translateY(3px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 140, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    feedbackAnimations.set(element, animation);
    animation.finished.then(() => {
      if (feedbackAnimations.get(element) === animation)
        feedbackAnimations.delete(element);
    });
  }
  function stopFeedback() {
    for (const animation of feedbackAnimations.values()) animation.cancel();
    feedbackAnimations.clear();
  }
  let frame = 0,
    jobs = [],
    cleanups = [],
    textAnimations = [],
    motionStart = 0,
    animateUpdate = false,
    styleSnapshots = new WeakMap(),
    gridRanges = new WeakMap(),
    dateRanges = new WeakMap();
  const canAnimate = () =>
    !motionPreference.matches &&
    !window.document.hidden &&
    typeof window.Element.prototype.animate === "function";
  function stopMotion(finish = true) {
    window.cancelAnimationFrame(frame);
    frame = 0;
    if (finish) jobs.forEach((job) => job.paint(1));
    if (finish) WorkTimeApp.ui.numbers.settle($("analysisMetrics"));
    jobs = [];
    cleanups.splice(0).forEach((cleanup) => cleanup(finish));
    textAnimations.splice(0).forEach((animation) => animation.cancel());
    delete $("analysisPage").dataset.animating;
  }
  function queue(paint, delay = 100, duration = 400) {
    if (!animateUpdate) {
      paint(1);
      return;
    }
    jobs.push({ paint, delay, duration, progress: 0 });
    paint(0);
  }
  function runMotion() {
    if (!jobs.length) return;
    motionStart = window.performance.now();
    let numbersStarted = false;
    $("analysisPage").dataset.animating = "true";
    const tick = (now) => {
      if (!canAnimate() || $("analysisPage").hidden) {
        stopMotion();
        return;
      }
      if (!numbersStarted) {
        WorkTimeApp.ui.numbers.reveal($("analysisMetrics"));
        numbersStarted = true;
      }
      let complete = true;
      for (const job of jobs) {
        const elapsed = Math.max(
          0,
          Math.min(1, (now - motionStart - job.delay) / job.duration),
        );
        if (elapsed !== job.progress) {
          job.paint(1 - Math.pow(1 - elapsed, 3));
          job.progress = elapsed;
        }
        if (elapsed < 1) complete = false;
      }
      onFrame();
      if (complete) stopMotion();
      else frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
  }
  function fadeText(element, text, delay = 0) {
    if (element.textContent === text) return;
    const before = element.cloneNode(true);
    element.textContent = text;
    if (
      !animateUpdate ||
      !before.textContent ||
      element.namespaceURI === "http://www.w3.org/2000/svg"
    )
      return;
    // Outgoing text is decorative and never changes the containing line box.
    before.removeAttribute("id");
    before.setAttribute("aria-hidden", "true");
    before.classList.add("analysis-text-outgoing");
    element.classList.add("analysis-text-changing");
    const incoming = window.document.createElement("span");
    incoming.className = "analysis-text-incoming";
    incoming.textContent = text;
    element.replaceChildren(incoming, before);
    queue(
      (p) => {
        before.style.opacity = String(1 - p);
        incoming.style.opacity = String(p);
      },
      delay,
      180,
    );
    cleanups.push(() => {
      element.textContent = text;
      element.classList.remove("analysis-text-changing");
    });
  }
  const keyFor = (element, index) =>
    element.tagName +
    ":" +
    (element.dataset.key ||
      element.dataset.minute ||
      element.dataset.lane ||
      (element.dataset.date ? element.dataset.date.slice(8) : index));
  function gridPosition(lane, minute) {
    const cached = gridRanges.get(lane);
    if (cached) {
      const y =
        cached.y0 +
        ((minute - cached.first) / (cached.last - cached.first)) *
          (cached.y1 - cached.y0);
      return y;
    }
    const grids = [
      ...lane.querySelectorAll(":scope > .analysis-grid:not([data-exiting])"),
    ];
    if (grids.length < 2) return null;
    const first = grids[0],
      last = grids.at(-1),
      y0 = Number(first.querySelector("line").getAttribute("y1")),
      y1 = Number(last.querySelector("line").getAttribute("y1")),
      value =
        y0 +
        ((minute - Number(first.dataset.minute)) /
          (Number(last.dataset.minute) - Number(first.dataset.minute))) *
          (y1 - y0);
    gridRanges.set(lane, {
      first: Number(first.dataset.minute),
      last: Number(last.dataset.minute),
      y0,
      y1,
    });
    return value;
  }
  function datePosition(container, index) {
    let range = dateRanges.get(container);
    if (!range) {
      const labels = [...container.children].filter((child) =>
        child.matches(".analysis-date:not([data-exiting])"),
      );
      if (labels.length < 2) return null;
      const first = labels[0],
        last = labels.at(-1),
        ordinal = (label) => Number(label.dataset.key.slice(5)),
        position = (label) => Number(label.getAttribute("x")),
        step =
          (position(last) - position(first)) / (ordinal(last) - ordinal(first));
      range = {
        first: ordinal(first),
        start: position(first),
        step,
        width: step,
      };
      dateRanges.set(container, range);
    }
    return {
      position: range.start + (index - range.first) * range.step,
      width: range.width,
    };
  }
  function moveDateLabel(element, layout, delay, entering) {
    if (!layout) return;
    const index = element.matches(".analysis-day")
        ? Number(element.dataset.date.slice(8)) - 1
        : Number(element.dataset.key.slice(5)),
      position = datePosition(layout, index);
    if (!position) return;
    if (element.matches(".analysis-date")) {
      const x = element.getAttribute("x");
      interpolateAttribute(
        element,
        "x",
        entering ? String(position.position) : x,
        entering ? x : String(position.position),
        delay,
      );
    } else {
      for (const [attribute, value] of [
        ["x", position.position - position.width / 2],
        ["width", position.width],
      ]) {
        const current = element.getAttribute(attribute);
        interpolateAttribute(
          element,
          attribute,
          entering ? String(value) : current,
          entering ? current : String(value),
          delay,
        );
      }
    }
  }

  function interpolateAttribute(element, name, before, after, delay) {
    const pattern = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
    const from = String(before).match(pattern)?.map(Number),
      to = String(after).match(pattern)?.map(Number);
    if (
      !from ||
      !to ||
      from.length !== to.length ||
      String(before).replace(pattern, "#") !==
        String(after).replace(pattern, "#")
    ) {
      element.setAttribute(name, after);
      return;
    }
    queue((p) => {
      let index = 0;
      element.setAttribute(
        name,
        String(after).replace(pattern, () => {
          const n = index++;
          return String(from[n] + (to[n] - from[n]) * p);
        }),
      );
    }, delay);
  }
  function styleTransition(element, property, before, after, delay) {
    if (before === after) {
      element.style.removeProperty(property);
      return;
    }
    if (
      window.CSS.supports("color", before) &&
      window.CSS.supports("color", after)
    ) {
      queue(
        (p) =>
          element.style.setProperty(
            property,
            "color-mix(in oklab, " +
              before +
              " " +
              (1 - p) * 100 +
              "%, " +
              after +
              ")",
          ),
        delay,
      );
    } else if (
      /^-?[\d.]+(?:px)?$/.test(before) &&
      /^-?[\d.]+(?:px)?$/.test(after)
    ) {
      const a = parseFloat(before),
        b = parseFloat(after),
        unit = after.endsWith("px") ? "px" : "";
      queue(
        (p) => element.style.setProperty(property, a + (b - a) * p + unit),
        delay,
      );
    } else return;
    cleanups.push((finish) => {
      if (finish) element.style.removeProperty(property);
    });
  }
  // Sweep across dates while sharing one start time for each day's marks.
  function rangeDelay(element, delay) {
    return element.matches(".analysis-range")
      ? delay + Math.max(0, Number(element.dataset.date.slice(8)) - 1) * 6
      : delay;
  }
  const legendStyles = ["width", "margin-inline-start", "transform", "opacity"];
  function clearLegendStyles(element) {
    legendStyles.forEach((name) => element.style.removeProperty(name));
  }
  function revealFutureLegend(element, entering) {
    const currentWidth = element.getBoundingClientRect().width,
      savedWidth = element.style.width,
      gap =
        parseFloat(window.getComputedStyle(element.parentElement).columnGap) ||
        0,
      fromWidth = entering ? 0 : currentWidth,
      fromMargin = entering
        ? -gap
        : parseFloat(element.style.marginInlineStart) || 0,
      fromOpacity = entering
        ? 0
        : Number(window.getComputedStyle(element).opacity),
      fromX = entering
        ? 18
        : new window.DOMMatrix(window.getComputedStyle(element).transform).m41;
    element.style.removeProperty("width");
    const width = element.getBoundingClientRect().width;
    element.style.width = savedWidth;
    // Grow the occupied space as well as the mark so adjacent legends move with it.
    queue(
      (p) => {
        element.style.width = fromWidth + (width - fromWidth) * p + "px";
        element.style.marginInlineStart = fromMargin * (1 - p) + "px";
        element.style.transform = `translateX(${fromX * (1 - p)}px)`;
        element.style.opacity = String(fromOpacity + (1 - fromOpacity) * p);
      },
      0,
      220,
    );
    cleanups.push((finish) => {
      if (finish) clearLegendStyles(element);
    });
  }
  function syncNode(
    element,
    target,
    delay = 100,
    inheritedStyleChange = false,
  ) {
    if (element.matches?.(".analysis-plot")) datePosition(element, 0);
    const rangeChanged =
      element.matches?.(".analysis-range") && !element.isEqualNode(target);
    delay = rangeDelay(element, delay);
    if (
      animateUpdate &&
      element.matches?.(
        ".analysis-connector, .analysis-point, .analysis-point-alternate, .analysis-halo, .analysis-rest-band",
      ) &&
      (inheritedStyleChange || !element.isEqualNode(target))
    ) {
      const snapshot = styleSnapshots.get(element),
        style = window.getComputedStyle(element),
        properties = ["opacity", "stroke", "fill"],
        beforeStyle = properties.map(
          (name) => snapshot?.[name] ?? style.getPropertyValue(name),
        ),
        before = element.cloneNode(false);
      const applyAttributes = (source) => {
        for (const attribute of [...element.attributes])
          if (
            attribute.name !== "style" &&
            !source.hasAttribute(attribute.name)
          )
            element.removeAttribute(attribute.name);
        for (const attribute of source.attributes)
          if (attribute.name !== "style")
            element.setAttribute(attribute.name, attribute.value);
      };
      const transition = element.style.transition;
      element.style.transition = "none";
      properties.forEach((name) => element.style.removeProperty(name));
      applyAttributes(target);
      const targetStyle = window.getComputedStyle(element),
        afterStyle = properties.map((name) =>
          targetStyle.getPropertyValue(name),
        );
      // Marks and rest-day bands change geometry only while fully hidden.
      queue((p) => {
        const elapsed = 1 - Math.cbrt(1 - p),
          incoming = elapsed >= 0.5,
          visibility = incoming
            ? Math.max(0, (elapsed - 0.55) / 0.45)
            : Math.max(0, 1 - elapsed / 0.45),
          easedVisibility = visibility * visibility * (3 - 2 * visibility),
          values = incoming ? afterStyle : beforeStyle;
        applyAttributes(incoming ? target : before);
        properties.forEach((name, index) =>
          element.style.setProperty(
            name,
            name === "opacity"
              ? String(Number(values[index]) * easedVisibility)
              : values[index],
          ),
        );
      }, delay);
      cleanups.push((finish) => {
        if (transition) element.style.transition = transition;
        else element.style.removeProperty("transition");
        if (finish)
          properties.forEach((name) => element.style.removeProperty(name));
      });
      return;
    }
    if (element.matches?.(".analysis-metric-ratio")) {
      const before = element.getAttribute("aria-label"),
        after = target.getAttribute("aria-label");
      if (
        animateUpdate &&
        before !== after &&
        (before === "—" || after === "—")
      ) {
        WorkTimeApp.ui.numbers.settle(element);
        const incoming = window.document.createElement("span"),
          outgoing = window.document.createElement("span");
        incoming.className = "analysis-ratio-row";
        outgoing.className = "analysis-ratio-row analysis-ratio-outgoing";
        incoming.setAttribute("aria-hidden", "true");
        outgoing.setAttribute("aria-hidden", "true");
        incoming.append(
          ...[...target.children].map((child) => child.cloneNode(true)),
        );
        for (const numeric of incoming.querySelectorAll(
          ".analysis-metric-value",
        )) {
          const value = numeric.textContent;
          WorkTimeApp.ui.numbers.set(numeric, value, {
            animateInitial: false,
            motion: false,
          });
          numeric.dataset.value = value;
        }
        outgoing.append(...element.childNodes);
        element.setAttribute("aria-label", after);
        element.append(incoming, outgoing);
        // One row carries numerator, SVG divider and denominator. Only the
        // incoming row owns layout; the old placeholder cannot widen it.
        // Match numeric metrics: values enter from above when replacing a dash,
        // and the dash enters from below when the values are cleared.
        const direction = before === "—" ? -1 : 1;
        queue((p) => {
          incoming.style.transform = `translateY(${direction * (1 - p) * 100}%)`;
          outgoing.style.transform = `translateY(${-direction * p * 100}%)`;
        }, 0);
        cleanups.push(() => element.replaceChildren(...incoming.childNodes));
        return;
      }
    }
    if (element.matches?.(".analysis-metric-value")) {
      element.hidden = target.hidden;
      const value = target.textContent,
        previous = element.dataset.value;
      const rolling =
        animateUpdate && previous !== undefined && previous !== value;
      WorkTimeApp.ui.numbers.set(element, value, {
        animateInitial: false,
        animateWhole: previous === "—" || value === "—",
        motion: Boolean(rolling),
        deferAnimation: Boolean(rolling),
      });
      element.dataset.value = value;
      if (rolling && previous !== value) queue(() => {}, 0);
      return;
    }
    if (!animateUpdate)
      for (const property of [
        "fill",
        "stroke",
        "opacity",
        "--analysis-marker-scale",
        "background-color",
      ])
        element.style.removeProperty(property);
    const styleChanged =
      inheritedStyleChange ||
      ["class", "data-state", "data-active"].some(
        (name) => element.getAttribute(name) !== target.getAttribute(name),
      );
    const needsStyle =
      animateUpdate &&
      (styleChanged ||
        element.style.opacity ||
        element.style.fill ||
        element.style.stroke ||
        element.style.getPropertyValue("--analysis-marker-scale"));
    const properties = !needsStyle
      ? []
      : element.matches?.(
            ".analysis-point, .analysis-point-alternate, .analysis-halo, .analysis-connector",
          )
        ? ["fill", "stroke"]
        : element.matches?.(".analysis-marker-shape")
          ? ["opacity"]
          : element.matches?.(".analysis-day")
            ? ["opacity"]
            : element.matches?.(".analysis-grid line")
              ? ["opacity"]
              : [];
    if (element.style.opacity && !properties.includes("opacity"))
      properties.push("opacity");
    const snapshot = styleSnapshots.get(element),
      beforeStyle = properties.some(
        (property) => snapshot?.[property] === undefined,
      )
        ? window.getComputedStyle(element)
        : null,
      oldStyles = properties.map(
        (property) =>
          snapshot?.[property] ?? beforeStyle.getPropertyValue(property),
      );
    for (const attribute of [...element.attributes])
      if (
        !target.hasAttribute(attribute.name) &&
        attribute.name !== "style" &&
        attribute.name !== "open"
      )
        element.removeAttribute(attribute.name);
    for (const attribute of target.attributes) {
      const before = element.getAttribute(attribute.name);
      if (before === attribute.value) continue;
      if (
        [
          "x",
          "y",
          "x1",
          "x2",
          "y1",
          "y2",
          "cx",
          "cy",
          "width",
          "height",
          "d",
          "opacity",
        ].includes(attribute.name) &&
        before !== null
      )
        interpolateAttribute(
          element,
          attribute.name,
          before,
          attribute.value,
          delay,
        );
      else element.setAttribute(attribute.name, attribute.value);
    }
    const saved = properties.map((property) =>
      element.style.getPropertyValue(property),
    );
    properties.forEach((property) => element.style.removeProperty(property));
    const targetStyle = properties.length
        ? window.getComputedStyle(element)
        : null,
      newStyles = properties.map((property) =>
        targetStyle.getPropertyValue(property),
      );
    properties.forEach((property, index) => {
      if (saved[index]) element.style.setProperty(property, saved[index]);
      styleTransition(
        element,
        property,
        oldStyles[index],
        newStyles[index],
        delay,
      );
    });
    if (!target.children.length) {
      fadeText(element, target.textContent, delay === 220 ? 220 : 0);
      return;
    }
    const old = new Map(
      [...element.children]
        .filter((child) => !child.hasAttribute("data-exiting"))
        .map((child, index) => [keyFor(child, index), child]),
    );
    [...target.children].forEach((child, index) => {
      const key = keyFor(child, index),
        existing = old.get(key);
      if (existing) {
        old.delete(key);
        if (element.children[index] !== existing)
          element.insertBefore(existing, element.children[index] || null);
        if (
          element.id === "analysisTimelineLegend" &&
          child.dataset.state === "future" &&
          existing.style.width
        ) {
          if (animateUpdate) {
            revealFutureLegend(existing, false);
            return;
          }
          clearLegendStyles(existing);
        }
        syncNode(existing, child, delay, styleChanged || rangeChanged);
      } else {
        const added = child.cloneNode(true);
        const startY = added.matches(".analysis-grid")
          ? gridPosition(element, Number(added.dataset.minute))
          : null;
        element.insertBefore(added, element.children[index] || null);
        if (
          animateUpdate &&
          added.matches(".analysis-date, .analysis-day, .analysis-grid")
        ) {
          added.dataset.entering = "true";
          cleanups.push(() => delete added.dataset.entering);
          if (added.matches(".analysis-date, .analysis-day"))
            moveDateLabel(added, element, delay, true);
        }
        if (animateUpdate && startY !== null)
          for (const part of added.children)
            for (const name of part.tagName === "line" ? ["y1", "y2"] : ["y"])
              interpolateAttribute(
                part,
                name,
                String(startY + (name === "y" ? 4 : 0)),
                part.getAttribute(name),
                delay,
              );
        if (
          animateUpdate &&
          added.tagName === "text" &&
          element.matches(".analysis-grid")
        )
          interpolateAttribute(
            added,
            "y",
            String(
              Number(element.querySelector("line").getAttribute("y1")) + 4,
            ),
            child.getAttribute("y"),
            delay,
          );
        // Initialize numeric layers without an initial count-up.
        for (const numeric of [
          added,
          ...added.querySelectorAll(".analysis-metric-value"),
        ])
          if (numeric.matches(".analysis-metric-value"))
            syncNode(numeric, numeric.cloneNode(true), delay);
        if (animateUpdate) {
          if (
            element.id === "analysisTimelineLegend" &&
            child.dataset.state === "future"
          ) {
            revealFutureLegend(added, true);
            return;
          }
          const opacity = child.hasAttribute("opacity")
            ? Number(child.getAttribute("opacity"))
            : child.matches(".analysis-rest-band")
              ? 0.025
              : child.matches('.analysis-marker-shape[data-active="false"]')
                ? 0
                : child.matches('.analysis-marker-shape[data-state="future"]')
                  ? 0.4
                  : 1;
          queue(
            (p) => {
              added.style.opacity = String(p * opacity);
            },
            added.matches(
              ".analysis-range, .analysis-rest-band, .analysis-longest-band",
            )
              ? rangeDelay(added, delay) + 220
              : delay,
            added.matches(
              ".analysis-range, .analysis-rest-band, .analysis-longest-band",
            )
              ? 180
              : 400,
          );
          cleanups.push((finish) => {
            if (finish) added.style.removeProperty("opacity");
          });
        }
      }
    });
    for (const removed of old.values()) {
      if (
        animateUpdate &&
        element.id === "analysisTimelineLegend" &&
        removed.dataset.state === "future"
      ) {
        const width = removed.getBoundingClientRect().width,
          opacity = Number(window.getComputedStyle(removed).opacity),
          gap = parseFloat(window.getComputedStyle(element).columnGap) || 0;
        removed.dataset.exiting = "true";
        removed.setAttribute("aria-hidden", "true");
        queue(
          (p) => {
            removed.style.opacity = String(opacity * (1 - p));
            removed.style.transform = `translateX(${p * 18}px)`;
            removed.style.width = width * (1 - p) + "px";
            removed.style.marginInlineStart = -gap * p + "px";
          },
          0,
          220,
        );
        cleanups.push(() => removed.remove());
        continue;
      }
      if (
        !animateUpdate ||
        (element.namespaceURI !== "http://www.w3.org/2000/svg" &&
          !removed.matches(".analysis-day"))
      ) {
        removed.remove();
        continue;
      }
      removed.dataset.exiting = "true";
      if (removed.matches(".analysis-date, .analysis-day"))
        moveDateLabel(removed, target, delay, false);
      if (removed.matches(".analysis-grid")) {
        const endY = gridPosition(target, Number(removed.dataset.minute));
        if (endY !== null)
          for (const part of removed.children)
            for (const name of part.tagName === "line" ? ["y1", "y2"] : ["y"])
              interpolateAttribute(
                part,
                name,
                part.getAttribute(name),
                String(endY + (name === "y" ? 4 : 0)),
                delay,
              );
      }
      if (removed.tagName === "text" && element.matches(".analysis-grid"))
        interpolateAttribute(
          removed,
          "y",
          removed.getAttribute("y"),
          String(Number(target.querySelector("line").getAttribute("y1")) + 4),
          delay,
        );
      removed.setAttribute("aria-hidden", "true");
      removed.removeAttribute("tabindex");
      removed.style.pointerEvents = "none";
      const opacity = Number(window.getComputedStyle(removed).opacity);
      queue(
        (p) => {
          removed.style.opacity = String(opacity * (1 - p));
        },
        rangeDelay(removed, delay),
        removed.matches(
          ".analysis-range, .analysis-rest-band, .analysis-longest-band",
        )
          ? 180
          : 400,
      );
      cleanups.push(() => removed.remove());
    }
  }
  function syncMarkup(container, markup, delay = 100) {
    styleSnapshots = new WeakMap();
    gridRanges = new WeakMap();
    dateRanges = new WeakMap();
    if (animateUpdate)
      for (const element of container.querySelectorAll(
        ".analysis-point, .analysis-point-alternate, .analysis-halo, .analysis-connector, .analysis-day, .analysis-marker-shape, .analysis-rest-band, .analysis-longest-band, .analysis-grid line, [style*='opacity']",
      )) {
        const style = window.getComputedStyle(element);
        styleSnapshots.set(
          element,
          Object.fromEntries(
            [
              "fill",
              "stroke",
              "--analysis-marker-scale",
              "background-color",
              "opacity",
            ].map((property) => [property, style.getPropertyValue(property)]),
          ),
        );
      }
    const target = container.cloneNode(false);
    target.innerHTML = markup;
    syncNode(container, target, delay);
  }

  return {
    feedback,
    stopFeedback,
    stopMotion,
    runMotion,
    syncMarkup,
    canAnimate,
    preference: motionPreference,
    set animated(value) {
      animateUpdate = value;
    },
  };
};
