"use strict";
/** One lazy player supplies every footer; mounting a footer never loads audio. */
WorkTimeApp.ui.footerPlayback = (() => {
  const views = new Set();
  let controller = null,
    started = false;
  function refresh() {
    const state = controller?.snapshot();
    if (!state?.tracks.length) started = false;
    if (state?.current && !state.paused) started = true;
    for (const view of views) view.refresh(state, started);
  }
  return {
    connect(player) {
      controller = player;
      started = false;
      const unsubscribe = player.subscribe(refresh);
      refresh();
      return () => {
        unsubscribe();
        if (controller !== player) return;
        controller = null;
        started = false;
        refresh();
      };
    },
    mount(host) {
      const group = document.createElement("span");
      group.className = "site-music-controls";
      group.hidden = true;
      group.setAttribute("role", "group");
      const name = document.createElement("span"),
        track = document.createElement("span"),
        original = document.createElement("span"),
        copy = document.createElement("span");
      name.className = "site-music-name";
      track.className = "site-music-name-track";
      copy.setAttribute("aria-hidden", "true");
      track.append(original, copy);
      name.append(track);
      group.append(name);
      const glyphs = {
        previous: "skip-previous-light",
        play: "play-arrow-light",
        pause: "pause-light",
        next: "skip-next-light",
      };
      const buttons = ["previous", "toggle", "next"].map((action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "site-music-button";
        button.dataset.musicAction = action;
        button.onclick = () => controller?.[action]();
        group.append(button);
        return button;
      });
      const divider = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      divider.setAttribute("class", "site-audio-divider");
      divider.setAttribute("viewBox", "0 0 16 16");
      divider.setAttribute("aria-hidden", "true");
      divider.innerHTML = '<path d="M8 4v8"/>';
      group.append(divider);
      host.prepend(group);
      let title = "",
        signature = "",
        frame = null,
        animation = null;
      function measure() {
        frame = null;
        if (group.hidden || !name.clientWidth) {
          animation?.cancel();
          animation = null;
          signature = "";
          return;
        }
        const scrolling =
          original.getBoundingClientRect().width > name.clientWidth + 1 &&
          document.documentElement.dataset.reducedMotion !== "true";
        const distance = original.getBoundingClientRect().width + 24;
        const next = `${title}|${name.clientWidth}|${distance}|${scrolling}`;
        if (signature === next) return;
        signature = next;
        animation?.cancel();
        animation = null;
        name.classList.remove("is-scrolling");
        if (scrolling && typeof track.animate === "function") {
          const duration = distance / 24 + 1;
          name.classList.add("is-scrolling");
          try {
            animation = track.animate(
              [
                { transform: "translateX(0)", offset: 0 },
                { transform: "translateX(0)", offset: 1 / duration },
                { transform: `translateX(${-distance}px)`, offset: 1 },
              ],
              {
                duration: duration * 1000,
                iterations: Infinity,
                easing: "linear",
              },
            );
          } catch {
            name.classList.remove("is-scrolling");
          }
        }
      }
      function scheduleMeasure() {
        if (frame === null) frame = requestAnimationFrame(measure);
      }
      const observer = new ResizeObserver(scheduleMeasure);
      observer.observe(name);
      document.addEventListener("worktime:motionchange", scheduleMeasure);
      const view = {
        refresh(state, visible) {
          const wasHidden = group.hidden;
          group.hidden = !visible || !state?.current;
          if (group.hidden) {
            animation?.cancel();
            animation = null;
            signature = "";
            return;
          }
          group.setAttribute("aria-label", WorkTimeApp.ui.musicText("title"));
          const nextTitle = state.current.title || state.current.name || "";
          if (title !== nextTitle) {
            title = nextTitle;
            original.textContent = copy.textContent = title;
            name.title = title;
            scheduleMeasure();
          }
          if (wasHidden) {
            signature = "";
            scheduleMeasure();
          }
          buttons.forEach((button, index) => {
            const key = ["previous", state.paused ? "play" : "pause", "next"][
              index
            ];
            if (button.dataset.glyph !== key) {
              button.dataset.glyph = key;
              button.innerHTML =
                '<svg class="ui-icon" aria-hidden="true"><use href="#ms-' +
                glyphs[key] +
                '"/></svg>';
            }
            button.title = WorkTimeApp.ui.musicText(key);
            button.setAttribute("aria-label", button.title);
            button.disabled = !state.tracks.length || state.needsAccess;
          });
        },
      };
      views.add(view);
      document.addEventListener("worktime:languagechange", refresh);
      refresh();
      return () => {
        views.delete(view);
        observer.disconnect();
        animation?.cancel();
        if (frame !== null) cancelAnimationFrame(frame);
        document.removeEventListener("worktime:motionchange", scheduleMeasure);
        document.removeEventListener("worktime:languagechange", refresh);
        group.remove();
      };
    },
  };
})();
/** Shared identity and live activity for the calendar and expanded workspaces. */
WorkTimeApp.ui.createSiteFooter = function (host, expanded = false) {
  const source = document.querySelector(".calendar-footer .site-meta");
  const meta = expanded ? source.cloneNode(true) : source;
  if (expanded) {
    meta.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  }
  const activity = document.createElement("span");
  activity.className = "site-audio-activity";
  activity.hidden = true;
  activity.tabIndex = 0;
  activity.setAttribute("role", "status");
  activity.dataset.hint = "detail";
  activity.innerHTML =
    '<svg class="ui-icon" aria-hidden="true"><use href="#ms-text-to-speech"/></svg><svg class="ui-icon site-audio-spinner" aria-hidden="true"><use href="#ms-progress-activity"/></svg><svg class="site-audio-divider" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v8"/></svg>';
  // The source may already contain the calendar's live indicator.
  meta.querySelector(".site-audio-activity")?.remove();
  meta.prepend(activity);
  const footer = expanded ? document.createElement("footer") : host;
  const status = document.createElement("div");
  status.className = "site-footer-status";
  if (expanded) {
    footer.className = "workspace-footer";
    status.append(meta);
    footer.append(status);
    host.append(footer);
  } else {
    meta.before(status);
    status.append(meta);
  }
  const disposePlayback = WorkTimeApp.ui.footerPlayback.mount(status);
  const idle = WorkTimeApp.services.vocabularyIdle;
  let detailTimer = null,
    pendingPhase = "",
    displayedDetail = "";
  function cancelDetail() {
    clearTimeout(detailTimer);
    detailTimer = null;
    pendingPhase = "";
  }
  function updateLabel(state, detail = displayedDetail) {
    displayedDetail = detail;
    // Preparation runs again between batches; only cache validity determines
    // whether the count is known, independently of the worker lifecycle.
    const progressKnown =
      state.available &&
      state.indexStatus === "ready" &&
      state.progressExact !== false;
    const label =
      detail +
      "\nWorker: " +
      state.poolSize +
      "\n" +
      WorkTimeApp.i18n.t("footer.audioProgress", {
        completed: progressKnown ? state.generatedTotal : "?",
        total: state.audioTotal,
      });
    if (activity.dataset.dateMarkerHint !== label)
      activity.dataset.dateMarkerHint = label;
    if (activity.getAttribute("aria-label") !== label)
      activity.setAttribute("aria-label", label);
  }
  function refresh() {
    const state = idle.state;
    if (
      idle.settings.enabled === false ||
      ["disabled", "paused"].includes(state.audioPhase)
    ) {
      activity.hidden = true;
      activity.classList.remove("is-busy");
      cancelDetail();
      displayedDetail = "";
      return;
    }
    // Consecutive words share one activity session. Hiding here restarts the
    // spinner and closes the tooltip at every synthesis completion.
    if (state.audioPhase === "betweenWords") {
      cancelDetail();
      if (displayedDetail) updateLabel(state);
      return;
    }
    activity.hidden =
      state.audioPhase.startsWith("waiting") || state.audioPhase === "otherTab";
    // Do not replace the open hint with a transient inter-word waiting label.
    if (activity.hidden) {
      cancelDetail();
      displayedDetail = "";
      return;
    }
    // Indexing, cache checks and saving belong to the same activity session;
    // worker-level busy flags may briefly fall between these stages.
    activity.classList.toggle(
      "is-busy",
      !["error", "capacity", "folder", "unsupported", "complete"].includes(
        state.audioPhase,
      ),
    );
    const detail = ["generating", "savingFiles", "savingBrowser"].includes(
      state.audioPhase,
    )
      ? state.currentWord || displayedDetail || "…"
      : WorkTimeApp.i18n.t("footer.audioPhase_" + state.audioPhase);
    const transient = [
      "checkingFolder",
      "loadingAssets",
      "scanningCache",
      "buildingQueue",
      "checkingFiles",
      "checkingBrowser",
      "loadingResources",
      "loadingModel",
      "initializingModel",
      "loading",
      "ready",
    ].includes(state.audioPhase);
    if (transient && displayedDetail && detail !== displayedDetail) {
      if (pendingPhase !== state.audioPhase) {
        cancelDetail();
        pendingPhase = state.audioPhase;
        detailTimer = setTimeout(() => {
          cancelDetail();
          updateLabel(idle.state, detail);
        }, 650);
      }
      updateLabel(state);
    } else {
      cancelDetail();
      updateLabel(state, detail);
    }
  }
  const unsubscribe = idle.subscribe(refresh);
  document.addEventListener("worktime:languagechange", refresh);
  refresh();
  return () => {
    disposePlayback();
    cancelDetail();
    unsubscribe();
    document.removeEventListener("worktime:languagechange", refresh);
    if (expanded) footer.remove();
    else {
      activity.remove();
      status.replaceWith(meta);
    }
  };
};
/** Coordinate owned views and the shared footer boundary; no persistence access. */
WorkTimeApp.ui.createWorkspace = function ({
  model,
  element: $,
  document,
  window,
  sidebarPanels,
  notifications,
  renderStats,
  renderCalendar,
  renderEditor,
  refreshSettings,
  renderAgenda = () => {},
  onDateChanged = () => {},
}) {
  let disposed = false,
    observer = null,
    disposeFooter = null;
  const footer = document.querySelector(".calendar-footer"),
    tabs = document.querySelector(".editor>.notification-tabs");
  function syncFooter(entries) {
    if (disposed) return;
    const entry = entries?.find((item) => item.target === footer);
    const height =
      entry?.borderBoxSize?.[0]?.blockSize ??
      footer.getBoundingClientRect().height;
    const value = height + "px";
    if (tabs.style.height !== value) tabs.style.height = value;
  }
  function render() {
    if (disposed) return;
    notifications.renderOAStaleNotice();
    renderStats();
    renderCalendar();
    renderEditor();
    renderAgenda();
    notifications.updateNotificationEmptyState();
  }
  function leaveBatch() {
    if (disposed || !model.batchMode || model.batchSaving) return;
    model.batchMode = false;
    model.calendarSelected = null;
    model.batchDays.clear();
    model.batchAnchor = null;
    model.batchInput = null;
    model.batchDraft = null;
    model.batchPreview = null;
    renderStats();
    renderCalendar();
    renderEditor();
  }
  return {
    render,
    mount() {
      if (observer) return;
      disposed = false;
      disposeFooter = WorkTimeApp.ui.createSiteFooter(footer);
      observer = new window.ResizeObserver(syncFooter);
      observer.observe(footer);
      render();
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      observer = null;
      disposeFooter?.();
      disposeFooter = null;
    },
    leaveBatch,
    open(id, options) {
      if (
        [
          "importDialog",
          "sourceDialog",
          "restoreDialog",
          "initializeDialog",
        ].includes(id)
      )
        leaveBatch();
      if (disposed || sidebarPanels.open(id, options)) return;
      const dialog = $(id);
      // Let native dialog focusing run while visible. No frame is painted between
      // showModal and preparation; alignment completes before the opening fade.
      dialog.showModal();
      dialog.classList.add("motion-dialog-preparing");
      try {
        WorkTimeApp.ui.alignment?.refresh([dialog]);
      } finally {
        dialog.classList.remove("motion-dialog-preparing");
      }
    },
    saveFeedback(saved, message) {
      if (disposed) return;
      notifications.toast(
        saved ? message : WorkTimeApp.i18n.t("copy.571aab1f15"),
        saved ? "countdown" : "error",
      );
    },
    reload() {
      if (disposed) return;
      leaveBatch();
      if (!$("settingsPane").hidden) refreshSettings();
      render();
      $("importDialog").dispatchEvent(new window.Event("sidebar-open"));
    },
    recoveryDone() {
      if (disposed) return;
      renderStats();
      notifications.updateNotificationEmptyState();
    },
    dateChanged(today) {
      if (disposed) return;
      model.today = today;
      onDateChanged();
      notifications.renderOAStaleNotice();
      renderStats();
      renderCalendar(true);
      renderAgenda();
      notifications.updateNotificationEmptyState();
    },
  };
};
