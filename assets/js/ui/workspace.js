"use strict";
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
}) {
  let disposed = false,
    observer = null;
  const footer = document.querySelector(".calendar-footer"),
    tabs = document.querySelector(".editor>.notification-tabs");
  function syncFooter() {
    if (!disposed)
      tabs.style.height = footer.getBoundingClientRect().height + "px";
  }
  function render() {
    if (disposed) return;
    notifications.renderOAStaleNotice();
    renderStats();
    renderCalendar();
    renderEditor();
    notifications.updateNotificationEmptyState();
  }
  return {
    render,
    mount() {
      if (observer) return;
      disposed = false;
      observer = new window.ResizeObserver(syncFooter);
      observer.observe(footer);
      render();
      syncFooter();
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      observer = null;
    },
    leaveBatch() {
      if (disposed || !model.batchMode) return;
      model.batchMode = false;
      model.batchDays.clear();
      model.batchAnchor = null;
      renderCalendar();
      renderEditor();
    },
    open(id) {
      if (disposed || sidebarPanels.open(id)) return;
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
        saved ? message : "未能保存，请备份；修改暂留本页",
        saved ? "countdown" : "error",
      );
    },
    reload() {
      if (disposed) return;
      if ($("settingsDialog").open) refreshSettings();
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
      notifications.renderOAStaleNotice();
      renderStats();
      renderCalendar(true);
      notifications.updateNotificationEmptyState();
    },
  };
};
