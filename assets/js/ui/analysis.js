"use strict";
/** A shared date axis links two independent clock-time scales. */
WorkTimeApp.ui.createAnalysis = function ({
  element: $,
  escape: esc,
  getState,
  getView,
  window,
}) {
  const t = (key, values) => WorkTimeApp.i18n.t("analysis." + key, values),
    events = WorkTimeApp.ui.createEventScope(),
    plot = $("analysisPlot");
  let currentData = null,
    lastSize = "",
    selectedDate = null;
  const number = (value) => WorkTimeApp.i18n.number(value);
  const date = (value) =>
    WorkTimeApp.i18n.date(value, {
      year: undefined,
      month: "numeric",
      day: "numeric",
    });
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
    wasVisible = false,
    lastLanguage = "",
    lastSignature = "",
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
      positionTooltip();
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
        child.matches(
          ".analysis-date:not([data-exiting]), .analysis-day:not([data-exiting])",
        ),
      );
      if (labels.length < 2) return null;
      const first = labels[0],
        last = labels.at(-1),
        ordinal = (label) =>
          label.matches(".analysis-day")
            ? Number(label.dataset.date.slice(8)) - 1
            : Number(label.dataset.key.slice(5)),
        position = (label) =>
          label.matches(".analysis-day")
            ? parseFloat(label.style.left)
            : Number(label.getAttribute("x"));
      range = {
        first: ordinal(first),
        start: position(first),
        step:
          (position(last) - position(first)) / (ordinal(last) - ordinal(first)),
        width: parseFloat(first.style.width),
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
      for (const [property, value] of [
        ["left", position.position],
        ["width", position.width],
      ]) {
        const current = parseFloat(element.style[property]),
          from = entering ? value : current,
          to = entering ? current : value;
        queue((p) => {
          element.style[property] = from + (to - from) * p + "%";
        }, delay);
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
  function syncNode(
    element,
    target,
    delay = 100,
    inheritedStyleChange = false,
  ) {
    if (element.matches?.(".analysis-plot, .analysis-streak-dates"))
      datePosition(element, 0);
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
          ? ["opacity", "--analysis-marker-scale"]
          : element.matches?.(".analysis-day")
            ? ["background-color", "opacity"]
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
      else if (
        attribute.name === "style" &&
        element.matches(".analysis-day, .analysis-longest-band")
      ) {
        for (const property of ["left", "width"]) {
          const a = parseFloat(element.style[property]),
            b = parseFloat(target.style[property]);
          queue((p) => {
            element.style[property] = a + (b - a) * p + "%";
          }, delay);
        }
      } else element.setAttribute(attribute.name, attribute.value);
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
          const opacity = child.hasAttribute("opacity")
            ? Number(child.getAttribute("opacity"))
            : child.matches(".analysis-rest-band")
              ? 0.025
              : child.matches('.analysis-day[data-state="future"]')
                ? 0.4
                : child.matches(".analysis-date.is-future")
                  ? 0.45
                  : child.matches('.analysis-marker-shape[data-active="false"]')
                    ? 0
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
  function clock(minutes) {
    if (minutes === null) return "—";
    const rounded = Math.round(minutes),
      value = rounded % 1440;
    return (
      (rounded >= 1440 ? t("nextDay") + " " : "") +
      String(Math.floor(value / 60)).padStart(2, "0") +
      ":" +
      String(value % 60).padStart(2, "0")
    );
  }
  function metric(label, value, context, dates = []) {
    const nextDay = t("nextDay") + " ",
      extended = value.startsWith(nextDay);
    const ratio = value.split(" / "),
      empty = value === "—";
    const valueMarkup =
      label === "overtimeDays"
        ? '<span class="analysis-metric-ratio" data-key="ratio" role="img" aria-label="' +
          esc(value) +
          '">' +
          '<span class="analysis-metric-value" data-key="numerator" aria-hidden="true">' +
          esc(ratio[0]) +
          "</span>" +
          '<svg class="analysis-ratio-divider" viewBox="0 0 12 24" aria-hidden="true" focusable="false"' +
          (empty ? " hidden" : "") +
          '><path d="M9 4 3 20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>' +
          '<span class="analysis-metric-value" data-key="denominator" aria-hidden="true"' +
          (empty ? " hidden" : "") +
          ">" +
          esc(ratio[1] || "—") +
          "</span></span>"
        : '<span class="analysis-metric-value" data-key="value">' +
          esc(extended ? value.slice(nextDay.length) : value) +
          "</span>";
    return (
      '<div class="analysis-metric" data-key="' +
      label +
      '"><span>' +
      esc(t(label)) +
      '</span><strong><span class="analysis-metric-next">' +
      (extended ? esc(t("nextDay")) : "") +
      "</span>" +
      valueMarkup +
      '</strong><div class="analysis-metric-footer"><small>' +
      esc(context) +
      "</small>" +
      (dates.length > 1
        ? '<details><summary aria-label="' +
          esc(t("allDates", { count: dates.length })) +
          '">+' +
          esc(number(dates.length)) +
          "</summary><p>" +
          dates.map((item) => esc(date(item))).join(" · ") +
          "</p></details>"
        : "") +
      "</div></div>"
    );
  }
  function positionTooltip() {
    const tooltip = $("analysisHover"),
      point = plot.querySelector(
        '.analysis-range.is-selected [data-lane="start"]',
      );
    if (tooltip.hidden || !point) return;
    const chartBox = $("analysisChart").getBoundingClientRect(),
      pointBox = point.getBoundingClientRect(),
      tooltipBox = tooltip.getBoundingClientRect(),
      pageBox = $("analysisPage").getBoundingClientRect(),
      center = pointBox.left + pointBox.width / 2 - chartBox.left,
      left = Math.max(
        8,
        Math.min(
          center - tooltipBox.width / 2,
          chartBox.width - tooltipBox.width - 8,
        ),
      );
    tooltip.style.left = left + "px";
    tooltip.style.top =
      Math.max(
        pageBox.top - chartBox.top + 8,
        pointBox.top - chartBox.top - tooltipBox.height - 12,
      ) + "px";
  }
  function selectDate(value) {
    const day = currentData?.days.find((item) => item.date === value);
    const next = day?.date || null;
    if (next === selectedDate && $("analysisHover").childElementCount) return;
    const appearing = Boolean(day && $("analysisHover").hidden);
    selectedDate = next;
    for (const group of plot.querySelectorAll(".analysis-range"))
      group.classList.toggle("is-selected", group.dataset.date === next);
    $("analysisHover").hidden = !day;
    $("analysisHover").innerHTML = day
      ? '<div class="analysis-tooltip"><strong>' +
        esc(
          date(day.date) +
            " · " +
            WorkTimeApp.i18n.weekday(day.date) +
            (!day.work ? " · " + t("restOvertime") : "") +
            (day.manual ? " · " + t("manualRecord") : ""),
        ) +
        "</strong>" +
        [
          ["start", clock(day.start)],
          ["end", clock(day.end)],
          ["overtime", WorkTimeApp.i18n.duration(day.overtime)],
        ]
          .map(
            ([key, value]) =>
              "<span>" + esc(t(key)) + "<b>" + esc(value) + "</b></span>",
          )
          .join("") +
        "</div>"
      : "";
    positionTooltip();
    if (appearing || !day) feedback($("analysisHover"), appearing);
  }
  // Event delegation survives resizing and language changes without new listeners.
  const groupFrom = (target) => {
    const group = target?.closest?.(".analysis-range");
    return group?.hasAttribute("data-exiting") ? null : group;
  };
  events.listen(
    $("analysisMetrics"),
    "toggle",
    (event) => {
      if (event.target.matches("details")) {
        const popup = event.target.querySelector("p");
        if (popup) feedback(popup, event.target.open);
      }
    },
    true,
  );
  events.listen(plot, "scroll", positionTooltip);
  events.listen(plot, "pointerover", (event) => {
    const group = groupFrom(event.target);
    selectDate(
      group?.dataset.date ||
        groupFrom(window.document.activeElement)?.dataset.date,
    );
  });
  events.listen(plot, "pointerleave", () =>
    selectDate(groupFrom(window.document.activeElement)?.dataset.date),
  );
  events.listen(plot, "focusin", (event) =>
    selectDate(groupFrom(event.target)?.dataset.date),
  );
  events.listen(plot, "focusout", (event) => {
    if (!plot.contains(event.relatedTarget)) selectDate(null);
  });
  events.listen(plot, "pointerdown", (event) => {
    const group = groupFrom(event.target);
    if (!group) return;
    // Pointer clicks must not create a focus selection that survives hover.
    event.preventDefault();
    groupFrom(window.document.activeElement)?.blur();
    selectDate(event.pointerType === "touch" ? null : group.dataset.date);
  });
  events.listen(plot, "keydown", (event) => {
    const group = groupFrom(event.target);
    if (!group) return;
    const groups = [
        ...plot.querySelectorAll(".analysis-range:not([data-exiting])"),
      ],
      index = groups.indexOf(group);
    const next = {
      ArrowLeft: Math.max(0, index - 1),
      ArrowRight: Math.min(groups.length - 1, index + 1),
      Home: 0,
      End: groups.length - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      groups[next].focus();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      $("analysisChart").focus({ preventScroll: true });
    }
  });
  function scale(values, top, bottom, minimumSpan) {
    let low = Math.min(...values),
      high = Math.max(...values);
    const center = (low + high) / 2;
    if (high - low < minimumSpan) {
      low = center - minimumSpan / 2;
      high = center + minimumSpan / 2;
    }
    const step = 15;
    low = Math.max(0, Math.floor(low / step) * step);
    high = Math.ceil(high / step) * step;
    const ticks = [];
    for (let tick = low; tick <= high; tick += 15) ticks.push(tick);
    const labelStep =
      [30, 60, 120, 180, 240, 360, 720, 1440].find(
        (interval) => ((bottom - top) * interval) / (high - low) >= 22,
      ) || 1440;
    return {
      ticks,
      labelStep,
      y: (value) => top + ((value - low) / (high - low)) * (bottom - top),
    };
  }
  function chart(data, width, height) {
    const right = width,
      top = 18,
      bottom = height - 31,
      startHeight = (bottom - top - 64) * 0.36,
      lanes = [
        {
          key: "start",
          references: [data.referenceStart, data.referenceStart + 60],
          top,
          bottom: top + startHeight,
        },
        {
          key: "end",
          references: [data.referenceEnd, data.referenceEnd + 180],
          top: top + startHeight + 64,
          bottom,
        },
      ];
    for (const lane of lanes) {
      const values = [
        ...lane.references,
        ...data.days.map((day) => day[lane.key]),
      ];
      lane.scale = scale(
        values,
        lane.top,
        lane.bottom,
        lane.key === "start" ? 60 : 180,
      );
      lane.scale.ticks = [
        ...new Set([...lane.scale.ticks, ...lane.references]),
      ].sort((a, b) => a - b);
      // Reserve label positions for the four requested reference times first.
      lane.labels = new Set(lane.references);
      for (const tick of lane.scale.ticks)
        if (
          tick % lane.scale.labelStep === 0 &&
          [...lane.labels].every(
            (label) => Math.abs(lane.scale.y(label) - lane.scale.y(tick)) >= 22,
          )
        )
          lane.labels.add(tick);
    }
    const context = window.document.createElement("canvas").getContext("2d");
    if (context)
      context.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    // Keep the axis gutter stable when a month gains or loses next-day records.
    const labelWidths = [0, 1440].map((tick) =>
      context ? context.measureText(clock(tick)).width : clock(tick).length * 7,
    );
    const left = Math.max(44, Math.ceil(Math.max(...labelWidths)) + 18),
      step = (right - left) / data.calendarDays.length,
      x = (index) => left + (index + 0.5) * step;
    let svg =
      '<svg class="analysis-plot" viewBox="0 0 ' +
      width +
      " " +
      height +
      '" role="group" aria-label="' +
      esc(t("dailyDescription")) +
      '">';
    for (const lane of lanes) {
      const y = lane.scale.y;
      svg +=
        '<g class="analysis-lane" data-lane="' +
        lane.key +
        '" role="group" aria-label="' +
        esc(t(lane.key)) +
        '">';
      for (const tick of lane.scale.ticks)
        svg +=
          '<g class="analysis-grid' +
          (lane.references.includes(tick)
            ? " analysis-grid-reference"
            : lane.labels.has(tick)
              ? ""
              : " analysis-grid-minor") +
          '" data-minute="' +
          tick +
          '"><line x1="' +
          left +
          '" x2="' +
          right +
          '" y1="' +
          y(tick) +
          '" y2="' +
          y(tick) +
          '"/>' +
          (lane.labels.has(tick)
            ? '<text x="2" y="' +
              (y(tick) + 4) +
              '" text-anchor="start">' +
              esc(clock(tick)) +
              "</text>"
            : "") +
          "</g>";
      for (const [index, day] of data.calendarDays.entries()) {
        if (!day.work)
          svg +=
            '<rect class="analysis-rest-band" data-key="rest-' +
            index +
            '" x="' +
            (left + index * step) +
            '" y="' +
            lane.top +
            '" width="' +
            step +
            '" height="' +
            (lane.bottom - lane.top) +
            '"/>';
      }
      svg += "</g>";
    }
    // One accessible target per observed date links both tracks and the detail strip.
    for (const day of data.days) {
      const cx = x(Number(day.date.slice(8)) - 1),
        startY = lanes[0].scale.y(day.start),
        endY = lanes[1].scale.y(day.end),
        late = day.end > 1260,
        label =
          date(day.date) +
          " · " +
          t("start") +
          " " +
          clock(day.start) +
          " · " +
          t("end") +
          " " +
          clock(day.end) +
          " · " +
          t("overtime") +
          " " +
          WorkTimeApp.i18n.duration(day.overtime) +
          (!day.work ? " · " + t("restOvertime") : "") +
          (day.manual ? " · " + t("manualRecord") : "");
      svg +=
        '<g class="analysis-range' +
        (day.manual ? " is-manual" : "") +
        (!day.work ? " is-rest-overtime" : "") +
        '" tabindex="0" role="img" data-date="' +
        day.date +
        '" aria-label="' +
        esc(label) +
        '"><rect class="analysis-hit" x="' +
        (cx - step / 2) +
        '" y="' +
        (top - 7) +
        '" width="' +
        step +
        '" height="' +
        (bottom - top + 14) +
        '"/><line class="analysis-connector" x1="' +
        cx +
        '" x2="' +
        cx +
        '" y1="' +
        startY +
        '" y2="' +
        endY +
        '"/><circle class="analysis-halo" cx="' +
        cx +
        '" cy="' +
        startY +
        '" r="10"/><circle class="analysis-halo' +
        (late ? " is-late" : "") +
        '" cx="' +
        cx +
        '" cy="' +
        endY +
        '" r="10"/><circle class="analysis-point" data-lane="start" cx="' +
        cx +
        '" cy="' +
        startY +
        '" r="5.5"/>';
      svg +=
        '<circle data-key="end-circle" class="' +
        (late ? "analysis-point-alternate" : "analysis-point") +
        '" ' +
        (late ? "" : 'data-lane="end" ') +
        'opacity="' +
        (late ? 0 : 1) +
        '" cx="' +
        cx +
        '" cy="' +
        endY +
        '" r="5.5"/>' +
        '<path data-key="end-diamond" class="' +
        (late ? "analysis-point is-late" : "analysis-point-alternate is-late") +
        '" ' +
        (late ? 'data-lane="end" ' : "") +
        'opacity="' +
        (late ? 1 : 0) +
        '" d="M' +
        cx +
        " " +
        (endY - 6.5) +
        'l6.5 6.5 -6.5 6.5 -6.5 -6.5Z"/>';
      svg += "</g>";
    }
    for (const [index, day] of data.calendarDays.entries())
      svg +=
        '<text data-key="date-' +
        index +
        '" class="analysis-date' +
        (day.date > data.asOf ? " is-future" : "") +
        (day.date === data.asOf ? " is-today" : "") +
        '" x="' +
        x(index) +
        '" y="' +
        (height - 8) +
        '" text-anchor="middle">' +
        esc(number(index + 1)) +
        "</text>";
    return svg + "</svg>";
  }
  function drawChart() {
    if (!currentData || !getView().analysisMode) return;
    const desktop = window.matchMedia("(min-width: 1151px)").matches,
      bounds = plot.getBoundingClientRect(),
      width = desktop ? Math.round(bounds.width) : 760,
      height = desktop ? Math.round(bounds.height) : 420,
      size = width + ":" + height;
    if (width < 1 || height < 1 || size === lastSize) return;
    const focused = groupFrom(window.document.activeElement)?.dataset.date;
    lastSize = size;
    syncMarkup(plot, chart(currentData, width, height));
    const previous = selectedDate;
    selectedDate = null;
    selectDate(previous);
    if (focused) {
      const nextFocus = plot.querySelector(
        '[data-date="' + focused + '"]:not([data-exiting])',
      );
      (nextFocus || $("analysisChart")).focus({ preventScroll: true });
    }
  }
  const resize = new window.ResizeObserver(() => {
    const bounds = plot.getBoundingClientRect();
    const size = window.matchMedia("(min-width: 1151px)").matches
      ? Math.round(bounds.width) + ":" + Math.round(bounds.height)
      : "760:420";
    if (size === lastSize) return;
    stopMotion();
    animateUpdate = false;
    drawChart();
  });
  resize.observe(plot);
  function timeline(data) {
    const records = new Map(data.days.map((day) => [day.date, day])),
      longest = new Set(data.longest.dates);
    return (
      '<div class="analysis-streak-dates" style="--analysis-month-days:' +
      data.calendarDays.length +
      '"><span class="analysis-longest-band" data-key="longest-band" aria-hidden="true" style="left:' +
      (data.longest.start
        ? ((Number(data.longest.start.slice(8)) - 1) * 100) /
          data.calendarDays.length
        : 0) +
      "%;width:" +
      (data.longest.count * 100) / data.calendarDays.length +
      '%"></span>' +
      data.calendarDays
        .map((day, index) => {
          const record = records.get(day.date),
            status =
              day.date > data.asOf
                ? "future"
                : !record
                  ? "missing"
                  : record.overtime > 0
                    ? day.work
                      ? "workedOvertime"
                      : "restOvertime"
                    : "recorded",
            label =
              date(day.date) +
              " · " +
              t(status) +
              (longest.has(day.date) ? " · " + t("longest") : "");
          return (
            '<span style="left:' +
            (index * 100) / data.calendarDays.length +
            "%;width:" +
            100 / data.calendarDays.length +
            '%" class="analysis-day' +
            (longest.has(day.date) ? " is-longest" : "") +
            '" data-date="' +
            day.date +
            '" data-state="' +
            status +
            '" tabindex="0" title="' +
            esc(label) +
            '" aria-label="' +
            esc(label) +
            '"><span>' +
            esc(number(index + 1)) +
            '</span><span class="analysis-marker" aria-hidden="true">' +
            ["workedOvertime", "restOvertime", "recorded", "missing", "future"]
              .map(
                (shape) =>
                  '<i class="analysis-marker-shape" data-key="' +
                  shape +
                  '" data-state="' +
                  shape +
                  '" data-active="' +
                  (shape === status) +
                  '"></i>',
              )
              .join("") +
            "</span></span>"
          );
        })
        .join("") +
      "</div>"
    );
  }
  function timelineLegend() {
    return ["workedOvertime", "restOvertime", "recorded", "missing", "future"]
      .map(
        (status) =>
          '<span data-state="' +
          status +
          '"><i aria-hidden="true"></i>' +
          '<span class="analysis-legend-label">' +
          esc(t(status)) +
          "</span></span>",
      )
      .join("");
  }

  function render() {
    const view = getView(),
      state = getState(),
      schedule = WorkTimeApp.domain.schedule.scheduleForDate(
        state,
        view.selected,
      ),
      data = {
        ...WorkTimeApp.domain.statistics.monthlyAnalysis(
          state,
          view.month,
          view.today,
          view.analysisIncludeManual,
        ),
        referenceStart: WorkTimeApp.domain.time.timeMin(schedule.workStart),
        referenceEnd: WorkTimeApp.domain.time.timeMin(schedule.workEnd),
        workdayMetrics: WorkTimeApp.domain.statistics.monthlyAnalysis(
          state,
          view.month,
          view.today,
          view.analysisIncludeManual,
          { workdaysOnly: true },
        ),
      };
    const language = WorkTimeApp.i18n.language,
      signature = JSON.stringify(data),
      changed = signature !== lastSignature,
      sameMonth = currentData?.first === data.first,
      focused = window.document.activeElement?.closest?.(
        ".analysis-range, .analysis-day",
      )?.dataset.date,
      focusKind = window.document.activeElement?.closest?.(".analysis-range")
        ? ".analysis-range"
        : ".analysis-day",
      previousSelection = selectedDate;
    if (
      !changed &&
      lastLanguage === language &&
      wasVisible &&
      view.analysisMode
    )
      return;
    stopMotion(false);
    animateUpdate = Boolean(
      wasVisible &&
      lastLanguage === language &&
      changed &&
      canAnimate() &&
      !WorkTimeApp.i18n.changing,
    );
    wasVisible = view.analysisMode;
    lastLanguage = language;
    lastSignature = signature;
    $("analysisManual").checked = view.analysisIncludeManual;
    const metrics = data.workdayMetrics,
      earliest = metrics.earliest,
      latest = metrics.latest,
      range = metrics.longest.count
        ? date(metrics.longest.start) + " – " + date(metrics.longest.end)
        : "—";
    const extremeMetric = (label, extreme) =>
      metric(
        label,
        extreme ? clock(extreme.minutes) : "—",
        extreme ? date(extreme.dates[0]) : "—",
        extreme?.dates,
      );
    const metricsMarkup =
      '<div class="analysis-metric-group">' +
      extremeMetric("earliest", earliest) +
      extremeMetric("latestStart", metrics.latestStart) +
      metric("averageStart", clock(metrics.averageStart), "") +
      '</div><div class="analysis-metric-group">' +
      extremeMetric("earliestEnd", metrics.earliestEnd) +
      extremeMetric("latest", latest) +
      metric("averageEnd", clock(metrics.averageEnd), "") +
      '</div><div class="analysis-metric-group analysis-metric-group-overtime">' +
      metric(
        "overtimeDays",
        metrics.count
          ? number(metrics.overtimeDays) + " / " + number(metrics.count)
          : "—",
        metrics.count
          ? t("ratio", {
              value: WorkTimeApp.i18n.number(
                metrics.overtimeDays / metrics.count,
                {
                  style: "percent",
                  maximumFractionDigits: 0,
                },
              ),
            })
          : "—",
      ) +
      metric(
        "longest",
        metrics.count ? number(metrics.longest.count) : "—",
        range,
      ) +
      "</div>";
    syncMarkup($("analysisMetrics"), metricsMarkup, 0);
    $("analysisDetails").hidden = false;
    currentData = data;
    lastSize = "";
    selectedDate = null;
    $("analysisHover").replaceChildren();
    $("analysisHover").hidden = true;
    syncMarkup($("analysisTimelineLegend"), timelineLegend(), 220);
    syncMarkup($("analysisStreak"), timeline(data), 220);
    drawChart();
    if (sameMonth) {
      selectedDate = null;
      selectDate(previousSelection);
    }
    if (focused) {
      const retained = $("analysisPage").querySelector(
        focusKind + '[data-date="' + focused + '"]:not([data-exiting])',
      );
      (retained || $("analysisChart")).focus({ preventScroll: true });
    }
    runMotion();
  }
  const unlistenMotion = WorkTimeApp.ui.animationCompat.listen(
    motionPreference,
    () => {
      if (motionPreference.matches) {
        stopMotion();
        stopFeedback();
      }
    },
  );
  events.listen(window.document, "visibilitychange", () => {
    if (window.document.hidden) {
      stopMotion();
      stopFeedback();
    }
  });
  const visibility = new window.MutationObserver(() => {
    if ($("analysisPage").hidden) {
      stopMotion();
      stopFeedback();
      wasVisible = false;
    }
  });
  visibility.observe($("analysisPage"), {
    attributes: true,
    attributeFilter: ["hidden"],
  });
  return {
    render,
    dispose() {
      stopMotion();
      stopFeedback();
      visibility.disconnect();
      unlistenMotion();
      resize.disconnect();
      events.dispose();
      currentData = null;
    },
  };
};
