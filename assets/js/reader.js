"use strict";
/** Paused feature: show a placeholder in the existing auxiliary panel. */
WorkTimeApp.ui.reader = (() => {
  function refresh() {
    const panel = document.getElementById("readerPanel");
    const entry = document.getElementById("readerOpen");
    if (entry) {
      entry.setAttribute("role", "tab");
      entry.setAttribute("aria-controls", "readerPanel");
      entry.removeAttribute("aria-haspopup");
      entry.removeAttribute("aria-expanded");
      const selected = WorkTimeApp.ui.dateInfo?.isActive("reader") || false;
      entry.setAttribute("aria-selected", String(selected));
      entry.tabIndex = selected ? 0 : -1;
    }
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
