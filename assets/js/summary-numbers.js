/* Numeric views pass values and formatting directly to this component. */
(() => {
  "use strict";
  let previous = new WeakMap();
  const history = new Map(),
    active = new Map();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let disposed = true;
  function finish(track) {
    const entry = active.get(track);
    if (!entry) return;
    track.removeEventListener("animationend", entry.end);
    track.getAnimations().forEach((animation) => animation.cancel());
    track.replaceChildren(entry.finalRow);
    track.classList.remove("number-roll-up", "number-roll-down");
    active.delete(track);
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
    } = {},
  ) {
    if (disposed) return;
    const number =
      value === null
        ? null
        : decimals === null
          ? String(value)
          : value.toFixed(decimals);
    const raw = number === null ? placeholder : number + suffix;
    const old = previous.get(element);
    const signature = JSON.stringify([raw, unit, alignInk]);
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
      const oldDot = oldValue.includes(".")
        ? oldValue.indexOf(".")
        : oldValue.length;
      const newDot = number.includes(".") ? number.indexOf(".") : number.length;
      const decreasing = Number(number) < Number(oldValue);
      const animate = !reduced.matches && oldValue !== number;
      const pending = [];
      for (const [index, digit] of [...number].entries()) {
        if (!/\d/.test(digit)) {
          const punctuation = document.createElement("span");
          punctuation.textContent = digit;
          visual.append(punctuation);
          continue;
        }
        const oldIndex =
          index < newDot
            ? oldDot - (newDot - index)
            : oldDot + (index - newDot);
        const before = /\d/.test(oldValue[oldIndex] || "")
          ? oldValue[oldIndex]
          : "0";
        const column = document.createElement("span");
        column.className = "summary-number-column";
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
          track.style.setProperty("--number-delay", index * 18 + "ms");
          track.append(
            ...(decreasing ? [finalRow, row(before)] : [row(before), finalRow]),
          );
          const end = (event) => {
            if (event.target === track) finish(track);
          };
          track.addEventListener("animationend", end);
          active.set(track, { end, finalRow });
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
      const digitRow = visual.querySelector(".summary-number-digit");
      if (digitRow && pending.length) {
        const height = getComputedStyle(digitRow).height;
        if (parseFloat(height) > 0)
          visual.style.setProperty("--number-row-height", height);
        if (document.documentElement.classList.contains("app-loading"))
          pending.forEach((track) =>
            track.getAnimations().forEach((animation) => animation.pause()),
          );
        for (const track of pending)
          for (const animation of track.getAnimations())
            animation.finished.then(
              () => finish(track),
              () => finish(track),
            );
      }
    }
    if (unit) {
      const label = document.createElement("small");
      label.textContent = unit;
      if (alignInk) label.dataset.numberInk = "";
      element.append(label);
    }
  }
  function reveal() {
    for (const track of active.keys())
      track.getAnimations().forEach((animation) => {
        animation.currentTime = 0;
        animation.play();
      });
  }
  function preferenceChanged() {
    if (reduced.matches) for (const track of [...active.keys()]) finish(track);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const track of [...active.keys()]) finish(track);
    history.clear();
    previous = new WeakMap();
    reduced.removeEventListener("change", preferenceChanged);
  }
  function mount() {
    if (!disposed) return;
    disposed = false;
    reduced.addEventListener("change", preferenceChanged);
  }
  WorkTimeApp.ui.numbers = { set, reveal, mount, dispose };
  mount();
})();
