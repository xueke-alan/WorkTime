"use strict";
/** Optional animation APIs must never prevent a view from reaching its final state. */
(() => {
  const system =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : { matches: false };
  const effective = new EventTarget();
  Object.defineProperty(effective, "matches", { get: () => reduced() });
  function mode() {
    return WorkTimeApp.services.preferences.page.state.motionMode || "full";
  }
  function reduced() {
    return mode() === "reduce" || (mode() === "system" && system.matches);
  }
  function preference() {
    return effective;
  }
  function sourceMedia() {
    return reduced() ? "all" : "not all";
  }
  function synchronize() {
    const value = String(reduced());
    const changed = document.documentElement.dataset.reducedMotion !== value;
    document.documentElement.dataset.reducedMotion = value;
    for (const source of document.querySelectorAll(
      "source[data-motion-source]",
    ))
      source.media = sourceMedia();
    if (changed) effective.dispatchEvent(new Event("change"));
    document.dispatchEvent(new Event("worktime:motionchange"));
  }
  listen(system, synchronize);
  WorkTimeApp.services.preferences.page.subscribe(synchronize);
  synchronize();
  function listen(query, callback) {
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", callback);
      return () => query.removeEventListener("change", callback);
    }
    if (typeof query.addListener === "function") {
      query.addListener(callback);
      return () => query.removeListener(callback);
    }
    return () => {};
  }
  // An optional document-timeline timestamp synchronizes independently timed
  // tracks. Existing callers keep the browser's default start behavior.
  function animate(element, frames, options, startTime) {
    let nativeAnimation,
      timer,
      settled = false,
      resolve;
    const finished = new Promise((done) => {
      resolve = done;
    });
    function complete() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Release fill effects as well as animations interrupted by a fallback timeout.
      try {
        nativeAnimation?.cancel();
      } catch {
        /* Optional browser API. */
      }
      resolve();
    }
    try {
      if (typeof element.animate !== "function")
        throw Error("Animation unavailable");
      nativeAnimation = element.animate(frames, options);
      if (Number.isFinite(startTime)) nativeAnimation.startTime = startTime;
      timer = setTimeout(
        complete,
        (options.delay || 0) + options.duration + 100,
      );
      const completion = nativeAnimation.finished;
      if (completion && typeof completion.then === "function")
        completion.then(complete, complete);
    } catch {
      complete();
    }
    return { finished, cancel: complete };
  }
  function decode(image) {
    let timer, resolve;
    const finished = new Promise((done) => {
      resolve = done;
    });
    function complete() {
      clearTimeout(timer);
      resolve();
    }
    try {
      if (typeof image?.decode === "function") {
        timer = setTimeout(complete, 1000);
        Promise.resolve(image.decode()).then(complete, complete);
      } else complete();
    } catch {
      complete();
    }
    return { finished, cancel: complete };
  }
  const workspaceMotion = {
    expandEase: "cubic-bezier(0.22, 1, 0.36, 1)",
    sideEase: "cubic-bezier(0.16, 1, 0.3, 1)",
    open: {
      surface: 380,
      surfaceFade: 90,
      sides: 240,
      center: 160,
      toolbar: 160,
      toolbarDelay: 160,
      content: 200,
      contentDelay: 220,
    },
    close: {
      surface: 360,
      surfaceFade: 260,
      sides: 340,
      center: 300,
      toolbar: 100,
      toolbarDelay: 0,
      content: 120,
      contentDelay: 0,
    },
  };
  WorkTimeApp.ui.animationCompat = {
    preference,
    system,
    sourceMedia,
    listen,
    animate,
    decode,
    workspaceMotion,
  };
})();
