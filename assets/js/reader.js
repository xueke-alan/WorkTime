"use strict";
/** Paused feature: show a placeholder in the existing auxiliary panel. */
WorkTimeApp.ui.reader = (() => {
  function refresh() {
    const panel = document.getElementById("readerPanel");
    if (!panel) return;
    let placeholder = panel.querySelector(".reader-placeholder");
    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.className = "reader-placeholder";
      placeholder.append(document.createElement("h2"));
      panel.replaceChildren(placeholder);
    }
    placeholder.querySelector("h2").textContent =
      WorkTimeApp.ui.readerText("placeholderTitle");
  }
  function open() {
    WorkTimeApp.ui.dateInfo.showReaderPanel();
  }
  return {
    refresh,
    close() {
      WorkTimeApp.ui.dateInfo.hideReaderPanel();
    },
    get isMini() {
      return true;
    },
    open,
    expand: open,
    minimize() {},
  };
})();
