/* Explicit animation triggers keep ordinary renders and ticking content still. */
(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const running = new Map();
  let disposed = false;
  function stop(element) {
    const entry = running.get(element);
    if (!entry) return;
    clearTimeout(entry.timer);
    element.classList.remove(entry.name);
    element.style.removeProperty("--motion-delay");
    running.delete(element);
  }
  function play(element, name = "motion-content", delay = 0) {
    if (!element || disposed || document.hidden) return;
    const restarting = running.has(element);
    stop(element);
    if (reduced.matches) return;
    // Only explicit user changes restart an animation; there is no subtree observer.
    if (restarting) void element.offsetWidth;
    element.style.setProperty("--motion-delay", delay + "ms");
    element.classList.add(name);
    running.set(element, { name, timer: setTimeout(() => stop(element), 700) });
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
    reduced.removeEventListener("change", onPreference);
    document.removeEventListener("visibilitychange", onVisibility);
  }
  reduced.addEventListener("change", onPreference);
  document.addEventListener("visibilitychange", onVisibility);
  window.WorkMotion = { play, stop, initial, dispose };
})();
