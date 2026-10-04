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
      if (!disposed && !sidebarPanels.open(id)) $(id).showModal();
    },
    saveFeedback(saved, message) {
      if (disposed) return;
      notifications.toast(
        saved ? message : "更改保留在当前页面，但未能保存，请查看提醒并备份",
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
