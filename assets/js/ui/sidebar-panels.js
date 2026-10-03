"use strict";
/** Reuse OA dialogs as nonmodal sidebar views, retaining drafts on nested navigation. */
WorkUI.createSidebarPanels = function ({ document, window }) {
  const sidebar = document.querySelector(".summary-sidebar"),
    ids = ["importDialog", "importHistoryDialog", "sourceDialog"],
    panes = new Map(ids.map((id) => [id, document.getElementById(id)])),
    overview = [...sidebar.children].filter(
      (element) => !element.matches(".sidebar-header, .summary-divider"),
    ),
    host = document.createElement("div"),
    stack = [];
  let disposed = false;
  const editor = document.querySelector(".workspace > .editor"),
    editorViews = [editor.querySelector(".editor-content")],
    settings = document.getElementById("settingsDialog");
  const editorTabs = editor.querySelector(".notification-tabs");
  editor.insertBefore(settings, editor.querySelector(".date-info-area"));
  function leaveSettingsFromTab(event) {
    if (settings.open && event.target.closest(".notification-tab"))
      window.UIAlignment?.refresh([editor.querySelector(".editor-info")]);
  }
  editorTabs.addEventListener("click", leaveSettingsFromTab);
  settings.classList.add("settings-sidebar-pane");
  settings.setAttribute("aria-modal", "false");
  settings
    .querySelector(".settings-layout")
    .append(settings.querySelector(".settings-employment"));
  function updateSettingsButton(open) {
    const button = document.getElementById("settingsOpen");
    button.classList.toggle("primary", open);
    button.setAttribute("aria-pressed", String(open));
    button.setAttribute("aria-label", open ? "关闭计算设置" : "计算设置");
    button.title = open ? "关闭计算设置" : "计算设置";
    button
      .querySelector("use")
      .setAttribute("href", open ? "#ms-close" : "#ms-settings");
  }
  function closeSettings() {
    if (settings.open || !editor.classList.contains("is-settings-open")) return;
    editor.classList.remove("is-settings-open");
    editorViews.forEach((view) =>
      view.classList.remove("settings-view-hidden"),
    );
    updateSettingsButton(false);
    window.WorkMotion?.play(
      document.getElementById("dayForm"),
      "motion-sidebar-back",
    );
    document.getElementById("settingsOpen").focus({ preventScroll: true });
  }
  settings.addEventListener("close", closeSettings);
  function closeSettingsPanel() {
    if (settings.open) settings.close();
    closeSettings();
  }
  host.className = "sidebar-oa-workspace";
  host.hidden = true;
  sidebar.append(host);
  for (const pane of panes.values()) {
    pane.classList.add("sidebar-oa-pane");
    pane.setAttribute("aria-modal", "false");
    host.append(pane);
  }
  const importPane = panes.get("importDialog"),
    history = document.createElement("section");
  history.className = "sidebar-import-history";
  history.setAttribute("aria-label", "导入历史");
  history.innerHTML =
    '<div class="sidebar-history-heading"><h3 id="importResultsTitle">导入历史</h3><span id="importHistoryCount" class="muted" aria-live="polite"></span></div><div class="sidebar-history-scroll"></div>';
  history
    .querySelector(".sidebar-history-scroll")
    .append(document.getElementById("importHistoryList"));
  history
    .querySelector(".sidebar-history-scroll")
    .append(document.getElementById("importDetails"));
  importPane.append(history);
  document.getElementById("importHistoryOpen").hidden = true;
  function render() {
    const active = stack.at(-1);
    sidebar.classList.toggle("is-oa-open", !!active);
    const importOpen = document.getElementById("importOpen");
    importOpen.classList.toggle("is-return", !!active);
    importOpen
      .querySelector(".import-clipboard")
      .setAttribute("aria-hidden", String(!!active));
    const returnLabel = stack.length > 1 ? "返回导入" : "返回概览";
    importOpen.querySelector(".import-main > span").textContent = active
      ? returnLabel
      : "OA记录";
    importOpen
      .querySelector(".import-main use")
      .setAttribute("href", active ? "#ms-chevron-left" : "#ms-add");
    importOpen.setAttribute(
      "aria-label",
      active ? returnLabel : "OA记录；右侧从剪贴板直接导入",
    );
    importOpen.title = active ? returnLabel : "打开 OA 导入";
    host.hidden = !active;
    for (const element of overview)
      element.classList.toggle("sidebar-overview-hidden", !!active);
    for (const [id, pane] of panes)
      pane.classList.toggle("sidebar-pane-inactive", id !== active?.id);
    if (active) {
      const pane = panes.get(active.id),
        back = stack.length > 1 ? "返回上一页" : "返回工时概览";
      const close = pane.querySelector(".dialog-head [data-close]");
      if (close) {
        close.setAttribute("aria-label", back);
        close.title = back;
      }
      pane.querySelectorAll(".dialog-foot [data-close]").forEach((button) => {
        button.textContent = active.id === "importDialog" ? "取消" : "返回";
      });
    }
  }
  function open(id) {
    if (id === "settingsDialog" && !disposed) {
      const trigger = document.activeElement;
      editor.classList.add("is-settings-open");
      editorViews.forEach((view) => view.classList.add("settings-view-hidden"));
      if (!settings.open) settings.show();
      window.WorkMotion?.play(
        document.getElementById("settingsForm"),
        "motion-sidebar-forward",
      );
      updateSettingsButton(true);
      window.UIAlignment?.refresh([settings]);
      if (window.matchMedia("(max-width: 1150px)").matches)
        editor.scrollIntoView({ block: "start" });
      trigger?.focus({ preventScroll: true });
      return true;
    }
    if (!panes.has(id) || disposed) return false;
    const index = stack.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      const removed = stack.splice(index + 1);
      for (const entry of removed) panes.get(entry.id).close();
    } else stack.push({ id, trigger: document.activeElement });
    render();
    const pane = panes.get(id);
    if (!pane.open) pane.show();
    window.WorkMotion?.play(host, "motion-sidebar-forward");
    if (id === "importDialog") pane.dispatchEvent(new Event("sidebar-open"));
    window.UIAlignment?.refresh([pane]);
    if (window.matchMedia("(max-width: 1150px)").matches)
      sidebar.scrollIntoView({ block: "nearest" });
    (id === "importDialog"
      ? document.getElementById("pasteText")
      : pane.querySelector("[data-detail-toggle]") ||
        pane.querySelector(".dialog-head [data-close]")
    ).focus({ preventScroll: true });
    return true;
  }
  function closed(event) {
    const index = stack.findIndex((entry) => entry.id === event.target.id);
    if (index < 0 || disposed) return;
    const removed = stack.splice(index);
    for (const entry of removed.slice(1))
      if (panes.get(entry.id).open) panes.get(entry.id).close();
    render();
    const previous = stack.at(-1);
    window.WorkMotion?.play(
      previous ? host : document.getElementById("cards"),
      "motion-sidebar-back",
    );
    if (previous) window.UIAlignment?.refresh([panes.get(previous.id)]);
    const trigger = removed[0].trigger;
    if (trigger?.isConnected && trigger.getClientRects().length)
      trigger.focus({ preventScroll: true });
  }
  function keydown(event) {
    if (
      event.key === "Escape" &&
      settings.open &&
      !document.querySelector("dialog:modal")
    ) {
      event.preventDefault();
      closeSettingsPanel();
      return;
    }
    if (
      event.key === "Escape" &&
      stack.length &&
      !document.querySelector("dialog:modal")
    ) {
      event.preventDefault();
      panes.get(stack.at(-1).id).close();
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    settings.removeEventListener("close", closeSettings);
    editorTabs.removeEventListener("click", leaveSettingsFromTab);
    document.removeEventListener("keydown", keydown);
    document
      .getElementById("importOpen")
      .removeEventListener("click", returnFromHeader);
    for (const pane of panes.values())
      pane.removeEventListener("close", closed);
    stack.length = 0;
  }
  for (const pane of panes.values()) pane.addEventListener("close", closed);
  function returnFromHeader(event) {
    if (!stack.length) return;
    event.stopImmediatePropagation();
    panes.get(stack.at(-1).id).close();
  }
  document
    .getElementById("importOpen")
    .addEventListener("click", returnFromHeader);
  document.addEventListener("keydown", keydown);
  return { open, dispose, closeSettings: closeSettingsPanel };
};
