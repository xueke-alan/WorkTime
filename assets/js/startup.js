/* Reveal a complete first layout; subsequent user actions retain their animations. */
(() => {
  "use strict";
  let disposed = false;
  let frame = 0;
  let numberTimer = null;
  let finishWaiting = null;
  function schedule(callback) {
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!disposed) callback();
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(numberTimer);
    numberTimer = null;
    clearTimeout(window.appRevealFallback);
    document.removeEventListener("DOMContentLoaded", ready);
    document.removeEventListener("worktime:failed", dispose);
    removeEventListener("pagehide", dispose);
    finishWaiting?.();
  }
  const reveal = () => {
    window.UIAlignment?.refresh();
    schedule(() => {
      document
        .querySelectorAll(".workspace>.panel,main.wrap>footer")
        .forEach((element, index) =>
          window.WorkMotion?.play(element, "motion-startup", index * 45),
        );
      document.documentElement.classList.remove("app-loading");
      numberTimer = setTimeout(() => {
        numberTimer = null;
        if (!disposed) window.SummaryNumbers?.reveal(document);
      }, 200);
      window.NotificationMotion?.reveal();
      clearTimeout(window.appRevealFallback);
    });
  };
  async function ready() {
    await document.fonts.ready;
    if (disposed) return;
    if (document.documentElement.dataset.appState === "initializing") {
      await new Promise((resolve) => {
        const done = () => {
          document.removeEventListener("worktime:ready", done);
          document.removeEventListener("worktime:failed", done);
          finishWaiting = null;
          resolve();
        };
        finishWaiting = done;
        document.addEventListener("worktime:ready", done);
        document.addEventListener("worktime:failed", done);
      });
    }
    if (disposed || document.documentElement.dataset.appState === "failed")
      return;
    schedule(reveal);
  }
  addEventListener("pagehide", dispose);
  document.addEventListener("worktime:failed", dispose);
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
})();
