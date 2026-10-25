/* Explicit animation triggers keep ordinary renders and ticking content still. */
(() => {
  "use strict";
  const reduced = WorkTimeApp.ui.animationCompat.preference();
  const running = new Map();
  // Date surfaces share one rhythm across navigation, layout and content changes.
  const calendar = Object.freeze({
    duration: 520,
    leaveDuration: 400,
    navigationDuration: 320,
    contentDuration: 300,
    contentLeaveDuration: 200,
    analysisEnterDuration: 280,
    analysisLeaveDuration: 180,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });
  function animateCalendar(plans) {
    // All geometry must be read before this write-only phase. Pending native
    // animations resolve together on the next frame, without backdating their
    // clocks to the document-timeline timestamp from before a costly render.
    return plans.map(({ element, frames, options }) =>
      WorkTimeApp.ui.animationCompat.animate(element, frames, options),
    );
  }
  const contentMotions = new Set([
    "motion-content",
    "motion-card-content",
    "motion-sidebar-forward",
    "motion-sidebar-back",
    "motion-calendar-view",
    "motion-calendar-year",
  ]);
  let disposed = true,
    unlisten;
  function stop(element) {
    const entry = running.get(element);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.animation?.cancel();
    element.classList.remove(entry.name);
    element.style.removeProperty("--motion-delay");
    running.delete(element);
  }
  function play(element, name = "motion-content", delay = 0) {
    if (!element || disposed || document.hidden) return;
    const restarting = running.has(element);
    // Continue from the painted state when a user changes tabs mid-transition.
    const current = running.get(element)?.animation
      ? getComputedStyle(element)
      : null;
    const start = current && {
      opacity: current.opacity,
      transform: current.transform,
    };
    stop(element);
    if (reduced.matches || WorkTimeApp.i18n.changing) return;
    if (contentMotions.has(name)) {
      // A single surface owns the reveal; nested panes should not fade twice.
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (running.get(parent)?.animation) return;
      for (const child of running.keys())
        if (element.contains(child)) stop(child);
      const distance =
        name === "motion-calendar-year" &&
        getComputedStyle(element)
          .getPropertyValue("--motion-direction")
          .trim()
          .startsWith("-")
          ? "-6px"
          : "6px";
      const transform =
        name === "motion-card-content"
          ? "translateX(-6px)"
          : name === "motion-sidebar-forward"
            ? "translateX(6px)"
            : name === "motion-sidebar-back"
              ? "translateX(-6px)"
              : name === "motion-calendar-year"
                ? `translateX(${distance})`
                : "translateY(4px)";
      const animation = WorkTimeApp.ui.animationCompat.animate(
        element,
        [
          start || { opacity: 0.4, transform },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: name.startsWith("motion-calendar")
            ? calendar.navigationDuration
            : name === "motion-card-content"
              ? calendar.contentDuration
              : 240,
          easing:
            name.startsWith("motion-calendar") || name === "motion-card-content"
              ? calendar.easing
              : "cubic-bezier(0.2, 0.65, 0.3, 1)",
          fill: "backwards",
        },
      );
      const entry = { name, animation };
      running.set(element, entry);
      animation.finished.then(() => {
        if (running.get(element) === entry) stop(element);
      });
      return;
    }
    // Only explicit user changes restart an animation; there is no subtree observer.
    if (restarting) void element.offsetWidth;
    element.style.setProperty("--motion-delay", delay + "ms");
    element.classList.add(name);
    running.set(element, { name, timer: setTimeout(() => stop(element), 700) });
  }
  function isAnimating(element) {
    for (let node = element; node; node = node.parentElement)
      if (running.has(node)) return true;
    return false;
  }
  function initial() {
    document
      .querySelectorAll(".workspace>.panel")
      .forEach((element, i) => play(element, "motion-enter", i * 60));
    document
      .querySelectorAll("#cards>.card")
      .forEach((element, i) => play(element, "motion-enter", 80 + i * 35));
    play(document.querySelector(".target-panel"), "motion-enter", 180);
    play(document.querySelector("footer"), "motion-enter", 220);
  }
  function onPreference() {
    if (reduced.matches) [...running.keys()].forEach(stop);
  }
  function onVisibility() {
    if (document.hidden) [...running.keys()].forEach(stop);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    [...running.keys()].forEach(stop);
    unlisten?.();
    unlisten = null;
    document.removeEventListener("visibilitychange", onVisibility);
  }
  function mount() {
    if (!disposed) return;
    disposed = false;
    unlisten = WorkTimeApp.ui.animationCompat.listen(reduced, onPreference);
    document.addEventListener("visibilitychange", onVisibility);
  }
  WorkTimeApp.ui.motion = {
    calendar,
    animateCalendar,
    play,
    stop,
    isAnimating,
    initial,
    mount,
    dispose,
  };
  mount();
})();
