"use strict";
WorkTimeApp.ui.vocabulary = (() => {
  let pending,
    loading = false,
    styleReady = false,
    disposed = false;
  const t = (key) => WorkTimeApp.i18n.t("vocabulary." + key);
  let preloadTimer,
    idleHandle,
    preloadEpoch = 0;
  const preloadAbort = new AbortController();
  function cancelScheduled() {
    preloadEpoch++;
    clearTimeout(preloadTimer);
    if (idleHandle !== undefined) window.cancelIdleCallback?.(idleHandle);
    idleHandle = undefined;
  }
  function prepare() {
    if (disposed) return Promise.resolve();
    pending ||= (async () => {
      await Promise.all([
        WorkTimeApp.services.vocabularyIdle.load(),
        WorkTimeApp.services.assets
          .style("assets/css/vocabulary.css")
          .then(() => {
            styleReady = true;
          }),
      ]);
      if (disposed) return;
      await WorkTimeApp.services.assets.scripts([
        "assets/js/ui/vocabulary-runtime.min.js",
      ]);
    })().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  }
  function schedulePreload() {
    cancelScheduled();
    if (
      disposed ||
      pending ||
      document.hidden ||
      document.documentElement.dataset.appState !== "ready"
    )
      return;
    const epoch = preloadEpoch;
    preloadTimer = setTimeout(() => {
      const run = async () => {
        try {
          await WorkTimeApp.services.assets.whenIdle({
            signal: preloadAbort.signal,
          });
          if (!disposed && epoch === preloadEpoch && !document.hidden)
            await prepare();
        } catch {
          /* Background preparation is optional; clicking can retry. */
        }
      };
      if (typeof window.requestIdleCallback === "function")
        idleHandle = window.requestIdleCallback(
          () => {
            void run();
          },
          { timeout: 2000 },
        );
      else void run();
    }, 750);
  }
  function resumePreload() {
    if (!document.hidden) schedulePreload();
  }
  const loader = {
    preload() {
      cancelScheduled();
      return prepare();
    },
    refresh() {
      const panel = document.getElementById("vocabularyPanel");
      if (!panel || panel.hidden || !styleReady || loading) return;
      panel.replaceChildren();
      const heading = document.createElement("h2");
      heading.textContent = t("title");
      const button = document.createElement("button");
      button.className = "ui-button";
      button.textContent = t("start");
      button.onclick = () => loader.open();
      panel.append(heading, button);
    },
    async open() {
      if (disposed || loading) return;
      cancelScheduled();
      loading = true;
      const panel = document.getElementById("vocabularyPanel");
      const entry = document.getElementById("vocabularyOpen");
      entry?.setAttribute("aria-busy", "true");
      try {
        await prepare();
        if (WorkTimeApp.ui.vocabulary === loader)
          throw Error("Vocabulary did not initialize");
        if (
          !disposed &&
          (WorkTimeApp.ui.dateInfo.isActive("tools") ||
            WorkTimeApp.ui.dateInfo.isActive("vocabulary"))
        )
          await WorkTimeApp.ui.vocabulary.open();
      } catch {
        if (disposed) return;
        if (entry) {
          entry.title = t("retry");
          const description = entry.querySelector("span");
          if (description) description.textContent = t("retry");
        }
        if (WorkTimeApp.ui.dateInfo.isActive("vocabulary")) {
          loading = false;
          loader.refresh();
          const button = panel.querySelector("button");
          if (button) button.textContent = t("retry");
        }
      } finally {
        loading = false;
        entry?.removeAttribute("aria-busy");
      }
    },
    dispose() {
      disposed = true;
      cancelScheduled();
      preloadAbort.abort();
      document.removeEventListener("worktime:ready", schedulePreload);
      document.removeEventListener("visibilitychange", resumePreload);
      window.removeEventListener("pagehide", cancelScheduled);
      window.removeEventListener("pageshow", resumePreload);
    },
  };
  if (document.documentElement.dataset.appState === "ready") schedulePreload();
  else
    document.addEventListener("worktime:ready", schedulePreload, {
      once: true,
    });
  document.addEventListener("visibilitychange", resumePreload);
  window.addEventListener("pagehide", cancelScheduled);
  window.addEventListener("pageshow", resumePreload);
  return loader;
})();
