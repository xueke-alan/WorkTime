"use strict";
/** Load bounded classic-script stages in separate tasks, including over file://. */
(() => {
  let closed = false;
  window.addEventListener(
    "pagehide",
    () => {
      closed = true;
    },
    { once: true },
  );
  async function start() {
    for (const stage of ["core", "date", "view", "startup"]) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (closed) return;
      await WorkTimeApp.services.assets.script(
        "assets/js/ui/" + stage + "-runtime.min.js",
      );
      const initialized = {
        core: () =>
          WorkTimeApp.services.bootstrap?.run &&
          WorkTimeApp.services.indexedStorage?.create,
        date: () =>
          WorkTimeApp.services.dateInfo?.getContent && WorkTimeApp.ui.motion,
        view: () =>
          WorkTimeApp.ui.createAgenda &&
          WorkTimeApp.ui.createCalendar &&
          WorkTimeApp.ui.createGamesController,
        startup: () => document.documentElement.dataset.appState,
      };
      if (!initialized[stage]())
        throw Error("Startup stage did not initialize: " + stage);
    }
  }
  void start().catch((error) => {
    if (closed) return;
    document.documentElement.dataset.appState = "failed";
    document.documentElement.classList.remove("app-loading");
    clearTimeout(window.appRevealFallback);
    document.dispatchEvent(new Event("worktime:failed"));
    for (const element of document.querySelectorAll(
      "button,input,select,textarea",
    ))
      element.disabled = true;
    const notice = document.createElement("div");
    notice.id = "startupFailure";
    notice.className = "notice";
    notice.setAttribute("role", "alert");
    const message = document.createElement("p");
    const i18n = typeof WorkTimeApp === "undefined" ? null : WorkTimeApp.i18n;
    message.textContent =
      (i18n?.message("页面初始化失败：") || "页面初始化失败：") + error.message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ui-button";
    retry.textContent = i18n?.t("copy.e2d53a6d3a") || "重试";
    retry.onclick = () => window.location.reload();
    notice.append(message, retry);
    (document.querySelector("main") || document.body).prepend(notice);
  });
})();
