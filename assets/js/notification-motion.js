/* Animate newly visible notices and opening the notification panel, not routine text updates. */
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
    panel = document.getElementById("editorInfo");
  const visible = new WeakMap();
  function enter(element) {
    if (
      reduced.matches ||
      document.documentElement.classList.contains("app-loading")
    )
      return;
    element.animate(
      [
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" },
    );
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
  new MutationObserver(sync).observe(panel, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  sync();
  window.NotificationMotion = {
    reveal: () =>
      panel
        .querySelectorAll(
          ".info-notification:not(.hidden):not(.feedback-notice)",
        )
        .forEach(enter),
  };
})();
