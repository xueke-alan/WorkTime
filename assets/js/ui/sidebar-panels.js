"use strict";
/** Navigate static sidebar views, retaining drafts on nested navigation. */
WorkTimeApp.ui.createSidebarPanels = function ({
  document,
  window,
  leaveBatch,
}) {
  const sidebar = document.querySelector(".summary-sidebar"),
    ids = ["importDialog", "sourceDialog"],
    panes = new Map(ids.map((id) => [id, document.getElementById(id)])),
    overview = [...sidebar.children].filter(
      (element) =>
        !element.matches(
          ".sidebar-header, .summary-divider, .sidebar-oa-workspace",
        ),
    ),
    host = sidebar.querySelector(".sidebar-oa-workspace"),
    stack = [];
  let disposed = false;
  const editor = document.querySelector(".workspace > .editor"),
    editorViews = [editor.querySelector(".editor-content")],
    settings = document.getElementById("settingsDialog");
  const editorTabs = editor.querySelector(".notification-tabs");
  const pageSettingsButton = document.getElementById("pageSettingsOpen"),
    pageSettings = document.getElementById("pageSettingsPane");
  const themeSettings = WorkTimeApp.ui.theme.mount(
    pageSettings.querySelector(".theme-settings-host"),
  );
  function bindSettingsCancel(id, close) {
    const button = document.getElementById(id);
    button.addEventListener("click", close);
    return button;
  }
  const workSettingsCancel = bindSettingsCancel(
    "workSettingsCancel",
    closeSettingsPanel,
  );
  const personalSettingsCancel = bindSettingsCancel(
    "personalSettingsCancel",
    closePageSettings,
  );
  function closePageSettings(focus = true) {
    if (pageSettings.hidden) return;
    pageSettings.hidden = true;
    pageSettings.dispatchEvent(new Event("personal-settings-close"));
    editor.classList.remove("is-page-settings-open");
    pageSettingsButton.classList.remove("primary");
    pageSettingsButton.setAttribute("aria-pressed", "false");
    pageSettingsButton.setAttribute("aria-label", "我的设置");
    pageSettingsButton.title = "我的设置";
    pageSettingsButton
      .querySelector("use")
      .setAttribute("href", "#ms-settings");
    if (focus) pageSettingsButton.focus({ preventScroll: true });
  }
  function togglePageSettings() {
    if (disposed) return;
    if (!pageSettings.hidden) {
      closePageSettings();
      return;
    }
    closeSettingsPanel();
    if (settings.open) return;
    leaveBatch();
    pageSettings.dispatchEvent(new Event("personal-settings-open"));
    pageSettings.hidden = false;
    editor.classList.add("is-page-settings-open");
    pageSettingsButton.classList.add("primary");
    pageSettingsButton.setAttribute("aria-pressed", "true");
    pageSettingsButton.setAttribute("aria-label", "关闭我的设置");
    pageSettingsButton.title = "关闭我的设置";
    pageSettingsButton.querySelector("use").setAttribute("href", "#ms-close");
    WorkTimeApp.ui.motion?.play(pageSettings, "motion-sidebar-forward");
    WorkTimeApp.ui.alignment?.refresh([pageSettings]);
    if (window.matchMedia("(max-width: 1150px)").matches)
      editor.scrollIntoView({ block: "start" });
    pageSettingsButton.focus({ preventScroll: true });
  }
  function leavePageSettings(event) {
    if (
      !pageSettings.hidden &&
      event.target.closest(
        "#batchToggle, #settingsOpen, #setupButton, #restore",
      )
    )
      closePageSettings(false);
  }
  pageSettingsButton.addEventListener("click", togglePageSettings);
  document.addEventListener("click", leavePageSettings, true);
  function leaveSettingsFromTab(event) {
    if (settings.open && event.target.closest(".notification-tab"))
      WorkTimeApp.ui.alignment?.refresh([editor.querySelector(".editor-info")]);
  }
  editorTabs.addEventListener("click", leaveSettingsFromTab);
  function updateSettingsButton(open) {
    const button = document.getElementById("settingsOpen");
    button.classList.toggle("primary", open);
    button.setAttribute("aria-pressed", String(open));
    button.setAttribute(
      "aria-label",
      open ? "关闭工作时间设置" : "工作时间设置",
    );
    button.title = open ? "关闭工作时间设置" : "工作时间设置";
    button
      .querySelector("use")
      .setAttribute("href", open ? "#ms-close" : "#ms-manage-accounts");
  }
  function closeSettings() {
    if (settings.open || !editor.classList.contains("is-settings-open")) return;
    editor.classList.remove("is-settings-open");
    editorViews.forEach((view) =>
      view.classList.remove("settings-view-hidden"),
    );
    updateSettingsButton(false);
    WorkTimeApp.ui.motion?.play(
      document.getElementById("dayForm"),
      "motion-sidebar-back",
    );
    document.getElementById("settingsOpen").focus({ preventScroll: true });
  }
  settings.addEventListener("close", closeSettings);
  function closeSettingsPanel() {
    if (
      settings.open &&
      !settings.dispatchEvent(
        new Event("settings-close-request", { cancelable: true }),
      )
    )
      return;
    if (settings.open) settings.close();
    closeSettings();
  }
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
        button.querySelector(".button-label").textContent =
          active.id === "importDialog" ? "取消" : "返回";
      });
    }
  }
  function open(id) {
    if (id === "settingsDialog" && !disposed) {
      closePageSettings(false);
      const trigger = document.activeElement;
      editor.classList.add("is-settings-open");
      editorViews.forEach((view) => view.classList.add("settings-view-hidden"));
      if (!settings.open) settings.show();
      WorkTimeApp.ui.motion?.play(
        document.getElementById("settingsForm"),
        "motion-sidebar-forward",
      );
      updateSettingsButton(true);
      WorkTimeApp.ui.alignment?.refresh([settings]);
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
    WorkTimeApp.ui.motion?.play(host, "motion-sidebar-forward");
    if (id === "importDialog") pane.dispatchEvent(new Event("sidebar-open"));
    WorkTimeApp.ui.alignment?.refresh([pane]);
    if (window.matchMedia("(max-width: 1150px)").matches)
      sidebar.scrollIntoView({ block: "nearest" });
    (id === "importDialog"
      ? document.getElementById("pasteText")
      : pane.querySelector(
          "#importDetailRawText,[data-detail-step]:not(:disabled)",
        ) || pane.querySelector(".dialog-head [data-close]")
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
    WorkTimeApp.ui.motion?.play(
      previous ? host : document.getElementById("cards"),
      "motion-sidebar-back",
    );
    if (previous) WorkTimeApp.ui.alignment?.refresh([panes.get(previous.id)]);
    const trigger = removed[0].trigger;
    if (trigger?.isConnected && trigger.getClientRects().length)
      trigger.focus({ preventScroll: true });
  }
  function keydown(event) {
    if (
      event.key === "Escape" &&
      !pageSettings.hidden &&
      !document.querySelector("dialog:modal")
    ) {
      event.preventDefault();
      closePageSettings();
      return;
    }
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
    themeSettings.dispose();
    workSettingsCancel.removeEventListener("click", closeSettingsPanel);
    personalSettingsCancel.removeEventListener("click", closePageSettings);
    pageSettingsButton.removeEventListener("click", togglePageSettings);
    document.removeEventListener("click", leavePageSettings, true);
    closePageSettings(false);
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
