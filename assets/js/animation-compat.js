"use strict";
/** Optional animation APIs must never prevent a view from reaching its final state. */
(() => {
  function preference() {
    return typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : { matches: false };
  }
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
  function animate(element, frames, options) {
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
  WorkTimeApp.ui.animationCompat = { preference, listen, animate, decode };
})();
