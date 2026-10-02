/* Roll summary and editor preview digits only when their displayed value changes. */
(() => {
  "use strict";
  const previous = new Map(),
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  function update(root) {
    const measurements = [];
    root
      .querySelectorAll(
        ".metric,.target-value,.target-metric,[data-number-motion]",
      )
      .forEach((element) => {
        const textNodes = [...element.childNodes].filter(
            (node) => node.nodeType === Node.TEXT_NODE,
          ),
          raw = textNodes
            .map((node) => node.textContent)
            .join("")
            .trim();
        // An unchanged metric already owns its digit wrapper; leave its remembered value intact.
        if (!textNodes.length) return;
        const key =
          element.id ||
          element.closest(".card")?.querySelector(".card-label")?.textContent;
        if (!key) return;
        const match = element.hasAttribute("data-number-motion")
          ? raw.match(/^(-?\d+(?:\.\d+)?)(\s*(?:h|d|天)?)$/)
          : raw.match(/^(-?\d+(?:\.\d+)?)$/);
        const old = previous.get(key);
        const value = match?.[1] || raw;
        previous.set(key, value);
        if (!match) return;
        const suffix = match[2] || "";
        const oldValue = /^-?\d+(?:\.\d+)?$/.test(old || "") ? old : "0",
          animate = !reduced.matches && oldValue !== value;
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
            : oldValue.length,
          newDot = value.includes(".") ? value.indexOf(".") : value.length;
        const decreasing = Number(value) < Number(oldValue);
        [...value].forEach((digit, index) => {
          if (!/\d/.test(digit)) {
            const punctuation = document.createElement("span");
            punctuation.textContent = digit;
            visual.append(punctuation);
            return;
          }
          const oldIndex =
              index < newDot
                ? oldDot - (newDot - index)
                : oldDot + (index - newDot),
            before = /\d/.test(oldValue[oldIndex] || "")
              ? oldValue[oldIndex]
              : "0";
          const column = document.createElement("span");
          column.className = "summary-number-column";
          const track = document.createElement("span");
          track.className = "summary-number-track";
          const row = (value) => {
            const span = document.createElement("span");
            span.className = "summary-number-digit";
            span.textContent = value;
            return span;
          };
          if (animate && before !== digit) {
            track.classList.add(
              decreasing ? "number-roll-down" : "number-roll-up",
            );
            track.style.setProperty("--number-delay", index * 18 + "ms");
            // Keep the completed strip intact: removing a row changes its baseline and can jump.
            track.append(
              ...(decreasing
                ? [row(digit), row(before)]
                : [row(before), row(digit)]),
            );
          } else track.append(row(digit));
          column.append(track);
          visual.append(column);
        });
        if (suffix) {
          const unit = document.createElement("span");
          unit.textContent = suffix;
          unit.style.whiteSpace = "pre";
          visual.append(unit);
        }
        wrapper.append(accessible, visual);
        textNodes[0]?.replaceWith(wrapper);
        textNodes.slice(1).forEach((node) => node.remove());
        // Layout rounds fractional em heights; animate by that exact used row height.
        const digitRow = visual.querySelector(".summary-number-digit");
        if (digitRow) measurements.push({ visual, digitRow });
      });
    // Build every digit strip before reading layout. Interleaved writes and height
    // reads otherwise force one layout per metric on each update.
    const heights = measurements.map(({ visual, digitRow }) => ({
      visual,
      height: getComputedStyle(digitRow).height,
    }));
    for (const { visual, height } of heights)
      visual.style.setProperty("--number-row-height", height);
    if (document.documentElement.classList.contains("app-loading")) {
      const animations = measurements.flatMap(({ visual }) =>
        [...visual.querySelectorAll(".summary-number-track")].flatMap((track) =>
          track.getAnimations(),
        ),
      );
      for (const animation of animations) animation.pause();
    }
  }
  function reveal(root) {
    root.querySelectorAll(".summary-number-track").forEach((track) =>
      track.getAnimations().forEach((animation) => {
        animation.currentTime = 0;
        animation.play();
      }),
    );
  }
  window.SummaryNumbers = { update, reveal };
})();
