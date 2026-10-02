"use strict";
/** Startup boundary and lifetime cleanup for the explicitly assembled application. */
const WorkBootstrap = (() => {
  async function run(initialize, { document }) {
    let closed = false;
    const cleanups = [];
    function dispose() {
      if (closed) return;
      closed = true;
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch (error) {
          console.error("Cleanup failed", error);
        }
      }
      cleanups.length = 0;
    }
    const lifecycle = {
      get closed() {
        return closed;
      },
      defer(cleanup) {
        if (closed) cleanup();
        else cleanups.push(cleanup);
      },
      dispose,
    };
    document.documentElement.dataset.appState = "initializing";
    document.defaultView.addEventListener("pagehide", dispose, { once: true });
    try {
      await initialize(lifecycle);
      if (closed) return { ok: false, closed: true };
      document.documentElement.dataset.appState = "ready";
      document.dispatchEvent(new Event("worktime:ready"));
      return { ok: true };
    } catch (error) {
      dispose();
      document.documentElement.dataset.appState = "failed";
      for (const element of document.querySelectorAll(
        "button,input,select,textarea",
      ))
        element.disabled = true;
      const notice = document.createElement("div");
      notice.id = "startupFailure";
      notice.className = "notice";
      notice.setAttribute("role", "alert");
      notice.textContent =
        "页面初始化失败：" +
        (error?.message || String(error)) +
        "。请关闭页面后重新打开，并检查项目文件是否完整。";
      (document.querySelector("main") || document.body).prepend(notice);
      document.documentElement.classList.remove("app-loading");
      clearTimeout(document.defaultView.appRevealFallback);
      document.dispatchEvent(new Event("worktime:failed"));
      return { ok: false, error };
    }
  }
  return { run };
})();
