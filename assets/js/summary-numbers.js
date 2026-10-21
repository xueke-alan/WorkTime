/* Numeric views pass values and formatting directly to this component. */
(() => {
  "use strict";
  let previous = new WeakMap();
  const history = new Map(),
    active = new Map();
  const reduced = WorkTimeApp.ui.animationCompat.preference();
  let unlisten;
  let disposed = true;
  function finish(track) {
    const entry = active.get(track);
    if (!entry) return;
    track.removeEventListener("animationend", entry.end);
    track.removeEventListener("animationcancel", entry.end);
    clearTimeout(entry.timer);
    track.style.removeProperty("animation-play-state");
    // The final digit always occupies its resting line. Only the absolutely
    // positioned outgoing digit is removed; layout and paint origin stay fixed.
    entry.outgoing.remove();
    track.classList.remove("number-roll-up", "number-roll-down");
    active.delete(track);
  }
  function start(track) {
    const entry = active.get(track);
    if (!entry || entry.timer !== null) return;
    track.style.animationPlayState = "running";
    entry.timer = setTimeout(() => finish(track), entry.duration + 100);
  }
  function set(
    element,
    value,
    {
      decimals = null,
      suffix = "",
      unit = "",
      placeholder = "—",
      key,
      alignInk = false,
      animateInitial = true,
      animateWhole = false,
      motion = true,
      deferAnimation = false,
    } = {},
  ) {
    if (disposed) return;
    element.classList.toggle("summary-number-value", Boolean(unit));
    const number =
      value === null
        ? null
        : decimals === null
          ? typeof value === "number"
            ? WorkTimeApp.i18n.number(value, {
                useGrouping: false,
                maximumFractionDigits: 20,
              })
            : String(value)
          : WorkTimeApp.i18n.number(value, {
              useGrouping: false,
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            });
    const raw = number === null ? placeholder : number + suffix;
    const old = previous.get(element);
    const signature = JSON.stringify([raw, unit, alignInk, animateWhole]);
    if (old?.signature === signature) return;
    for (const track of element.querySelectorAll(".summary-number-track"))
      finish(track);
    const oldValue =
      old?.number ?? (key === undefined ? undefined : history.get(key)) ?? "0";
    previous.set(element, { signature, number });
    if (key !== undefined) history.set(key, number);
    if (number === null && alignInk) {
      const label = document.createElement("span");
      label.dataset.numberInk = "";
      label.textContent = placeholder;
      element.replaceChildren(label);
    } else if (number === null) element.textContent = placeholder;
    else {
      const wrapper = document.createElement("span");
      wrapper.className = "summary-number";
      const accessible = document.createElement("span");
      accessible.className = "summary-number-accessible";
      accessible.textContent = raw;
      const visual = document.createElement("span");
      visual.className = "summary-number-visual";
      visual.setAttribute("aria-hidden", "true");
      const decimal = WorkTimeApp.i18n.decimalSeparator;
      const oldDot = oldValue.includes(decimal)
        ? oldValue.indexOf(decimal)
        : oldValue.length;
      const newDot = number.includes(decimal)
        ? number.indexOf(decimal)
        : number.length;
      // ISO dates sort chronologically as strings; ordinary values sort numerically.
      const decreasing =
        Number.isNaN(Number(number.replace(decimal, "."))) ||
        Number.isNaN(Number(oldValue.replace(decimal, ".")))
          ? number < oldValue
          : Number(number.replace(decimal, ".")) <
            Number(oldValue.replace(decimal, "."));
      const animate =
        motion &&
        !reduced.matches &&
        !WorkTimeApp.i18n.changing &&
        !document.hidden &&
        (animateInitial || old?.number != null) &&
        oldValue !== number;
      const pending = [];
      for (const [index, digit] of (animateWhole
        ? [number]
        : [...number]
      ).entries()) {
        if (!animateWhole && !/\d/.test(digit)) {
          const punctuation = document.createElement("span");
          punctuation.textContent = digit === " " ? "\u00a0" : digit;
          visual.append(punctuation);
          continue;
        }
        const oldIndex =
          index < newDot
            ? oldDot - (newDot - index)
            : oldDot + (index - newDot);
        const before = animateWhole
          ? oldValue
          : /\d/.test(oldValue[oldIndex] || "")
            ? oldValue[oldIndex]
            : "0";
        const column = document.createElement("span");
        column.className = "summary-number-column";
        if (animateWhole) column.classList.add("summary-number-word");
        const track = document.createElement("span");
        track.className = "summary-number-track";
        const row = (text) => {
          const item = document.createElement("span");
          item.className = "summary-number-digit";
          item.textContent = text;
          return item;
        };
        const finalRow = row(digit);
        if (animate && before !== digit) {
          track.classList.add(
            decreasing ? "number-roll-down" : "number-roll-up",
          );
          const delay = Math.min(pending.length * 12, 48);
          track.style.setProperty("--number-delay", delay + "ms");
          const outgoing = row(before);
          outgoing.classList.add("summary-number-outgoing");
          track.append(finalRow, outgoing);
          const end = (event) => {
            if (event.target === track) finish(track);
          };
          track.addEventListener("animationend", end);
          track.addEventListener("animationcancel", end);
          track.style.animationPlayState = "paused";
          active.set(track, {
            end,
            outgoing,
            timer: null,
            duration: 400 + delay,
          });
          pending.push(track);
        } else track.append(finalRow);
        column.append(track);
        visual.append(column);
      }
      if (suffix) {
        const label = document.createElement("span");
        label.textContent = suffix;
        label.style.whiteSpace = "pre";
        visual.append(label);
      }
      wrapper.append(accessible, visual);
      element.replaceChildren(wrapper);
      // The final row owns layout; the outgoing row never contributes geometry.
      if (
        !deferAnimation &&
        !document.documentElement.classList.contains("app-loading")
      )
        pending.forEach(start);
    }
    if (unit) {
      const label = document.createElement("small");
      label.textContent = unit;
      element.append(label);
    }
  }
  function reveal(root) {
    if (document.hidden || reduced.matches) return settle();
    for (const track of active.keys())
      if (!(root instanceof Element) || root.contains(track)) start(track);
  }
  function settle(root) {
    for (const track of [...active.keys()])
      if (!(root instanceof Element) || root.contains(track)) finish(track);
  }
  function visibilityChanged() {
    if (document.hidden) settle();
  }
  function preferenceChanged() {
    if (reduced.matches) settle();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    settle();
    history.clear();
    previous = new WeakMap();
    unlisten?.();
    unlisten = null;
    document.removeEventListener("visibilitychange", visibilityChanged);
  }
  function mount() {
    if (!disposed) return;
    disposed = false;
    unlisten = WorkTimeApp.ui.animationCompat.listen(
      reduced,
      preferenceChanged,
    );
    document.addEventListener("visibilitychange", visibilityChanged);
  }
  WorkTimeApp.ui.numbers = { set, reveal, settle, mount, dispose };
  mount();
})();
