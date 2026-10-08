/* Animate newly visible notices and opening the notification panel, not routine text updates. */
(() => {
  const reduced = WorkTimeApp.ui.animationCompat.preference(),
    panel = document.getElementById("editorInfo");
  let unlisten;
  let visible = new WeakMap(),
    observer = null;
  const animations = new Set();
  function enter(element) {
    if (
      !observer ||
      document.hidden ||
      reduced.matches ||
      document.documentElement.classList.contains("app-loading")
    )
      return;
    const animation = WorkTimeApp.ui.animationCompat.animate(
      element,
      [
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    animations.add(animation);
    animation.finished.then(() => animations.delete(animation));
  }
  function sync() {
    panel
      .querySelectorAll(".info-notification:not(.feedback-notice)")
      .forEach((element) => {
        const shown = !element.classList.contains("hidden");
        if (shown && !visible.get(element)) enter(element);
        visible.set(element, shown);
      });
    const shown = !panel.classList.contains("hidden");
    if (shown && visible.get(panel) === false) enter(panel);
    visible.set(panel, shown);
  }
  function cancelAnimations() {
    for (const animation of animations) animation.cancel();
    animations.clear();
  }
  function motionPreference() {
    if (reduced.matches) cancelAnimations();
  }
  function visibilityChanged() {
    if (document.hidden) cancelAnimations();
  }
  function mount() {
    if (observer) return;
    visible = new WeakMap();
    observer = new MutationObserver(sync);
    observer.observe(panel, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    unlisten = WorkTimeApp.ui.animationCompat.listen(reduced, motionPreference);
    document.addEventListener("visibilitychange", visibilityChanged);
    sync();
  }
  function dispose() {
    observer?.disconnect();
    observer = null;
    unlisten?.();
    unlisten = null;
    document.removeEventListener("visibilitychange", visibilityChanged);
    cancelAnimations();
  }
  WorkTimeApp.ui.notificationMotion = {
    mount,
    dispose,
    reveal: () =>
      panel
        .querySelectorAll(
          ".info-notification:not(.hidden):not(.feedback-notice)",
        )
        .forEach(enter),
  };
  mount();
})();
