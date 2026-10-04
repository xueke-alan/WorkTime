"use strict";
/** Shared two-second confirmation for backup download and OA-link editing. */
WorkTimeApp.ui.createHoldAction = function ({
  button,
  enabled = () => true,
  onShort,
  onLong,
  keys = ["Space"],
  cancelShortAfterFeedback = false,
}) {
  const events = WorkTimeApp.ui.createEventScope();
  let holding = false,
    completing = false,
    held = false,
    disposed = false;
  let holdTimer, ringTimer, finishTimer, resetAnimation;
  function end() {
    clearTimeout(holdTimer);
    clearTimeout(ringTimer);
    const wasHolding = holding;
    holding = false;
    if (completing || !wasHolding || !button.classList.contains("is-holding"))
      return;
    const ring = button.querySelector(".hold-progress");
    const offset = getComputedStyle(ring).strokeDashoffset;
    button.classList.remove("is-holding");
    button.classList.add("is-resetting");
    resetAnimation = ring.animate(
      [{ strokeDashoffset: offset }, { strokeDashoffset: "100" }],
      {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 300,
        easing: "ease-out",
        fill: "forwards",
      },
    );
    const animation = resetAnimation;
    animation.finished
      .then(() => {
        if (disposed || resetAnimation !== animation) return;
        button.classList.remove("is-resetting");
        animation.cancel();
        resetAnimation = null;
      })
      .catch(() => {});
  }
  function start() {
    if (disposed || holding || completing || button.disabled || !enabled())
      return;
    held = false;
    resetAnimation?.cancel();
    resetAnimation = null;
    button.classList.remove("is-resetting");
    holding = true;
    ringTimer = setTimeout(() => {
      if (holding) button.classList.add("is-holding");
    }, 200);
    holdTimer = setTimeout(() => {
      held = true;
      completing = true;
      end();
      button.classList.add("is-completing");
      finishTimer = setTimeout(() => {
        button.classList.remove("is-holding", "is-completing");
        completing = false;
        if (!disposed) onLong();
      }, 450);
    }, 2000);
  }
  function release() {
    if (cancelShortAfterFeedback && button.classList.contains("is-holding"))
      held = true;
    end();
  }
  function cancel() {
    held = holding || held;
    end();
  }
  events.listen(button, "pointerdown", (event) => {
    if (event.button !== 0) return;
    button.setPointerCapture(event.pointerId);
    start();
  });
  events.listen(button, "pointermove", (event) => {
    if (!holding) return;
    const rect = button.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      cancel();
  });
  events.listen(button, "pointerup", release);
  events.listen(button, "pointercancel", cancel);
  events.listen(button, "lostpointercapture", end);
  events.listen(button, "blur", end);
  events.listen(button, "contextmenu", (event) => event.preventDefault());
  events.listen(button, "keydown", (event) => {
    if (keys.includes(event.code)) {
      event.preventDefault();
      if (!event.repeat) start();
    }
    if (event.key === "Escape") cancel();
  });
  events.listen(button, "keyup", (event) => {
    if (!keys.includes(event.code)) return;
    event.preventDefault();
    release();
    button.click();
  });
  events.handler(button, "onclick", (event) => {
    event.preventDefault();
    if (completing || held) {
      held = false;
      return;
    }
    end();
    if (!disposed) onShort();
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    events.dispose();
    clearTimeout(holdTimer);
    clearTimeout(ringTimer);
    clearTimeout(finishTimer);
    resetAnimation?.cancel();
    button.classList.remove("is-holding", "is-completing", "is-resetting");
  }
  return { cancel, dispose };
};
