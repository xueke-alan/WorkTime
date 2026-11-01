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
  function finishNavigationMotion() {
    if (disposed) return;
    WorkTimeApp.ui.motion?.stop(host);
    WorkTimeApp.ui.motion?.stop(document.getElementById("cards"));
    for (const animation of sidebar.getAnimations?.({ subtree: true }) || []) {
      const target = animation.effect?.target;
      if (
        !target?.closest?.(".sidebar-header") ||
        !["transform", "opacity", "visibility"].includes(
          animation.transitionProperty,
        )
      )
        continue;
      try {
        animation.finish();
      } catch {
        /* Navigation remains usable without optional animation APIs. */
      }
    }
  }
  function onVisibility() {
    if (document.hidden) finishNavigationMotion();
  }
  const editor = document.querySelector(".workspace > .editor"),
    settings = document.getElementById("settingsPane"),
    settingsButton = document.getElementById("pageSettingsOpen"),
    settingsCancel = document.getElementById("personalSettingsCancel"),
    tablist = settings.querySelector(".settings-tabs"),
    tabs = [...tablist.querySelectorAll('[role="tab"]')];
  let activeTab = tabs[0];
  const themeSettings = WorkTimeApp.ui.theme.mount(
    settings.querySelector(".theme-settings-host"),
  );
  function updateSettingsButton() {
    const open = !settings.hidden;
    settingsButton.classList.toggle("primary", open);
    settingsButton.setAttribute("aria-pressed", String(open));
    settingsButton.setAttribute("aria-expanded", String(open));
    settingsButton.title = WorkTimeApp.i18n.t(
      open ? "copy.e2ae92e1ec" : "copy.165118b1d4",
    );
    settingsButton.setAttribute("aria-label", settingsButton.title);
    settingsButton
      .querySelector("use")
      .setAttribute("href", open ? "#ms-close" : "#ms-settings");
  }
  function hidePopovers() {
    settings.dispatchEvent(new Event("settings-tab-leave", { bubbles: true }));
    document
      .getElementById("personalSettingsPane")
      .dispatchEvent(new Event("personal-settings-close"));
  }
  function selectTab(tab, focus = false, animate = true) {
    const direction = tabs.indexOf(tab) - tabs.indexOf(activeTab);
    if (tab !== activeTab) {
      hidePopovers();
      WorkTimeApp.ui.motion?.stop(
        document.getElementById(activeTab.getAttribute("aria-controls")),
      );
    }
    activeTab = tab;
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden =
        !selected;
    }
    WorkTimeApp.ui.alignment?.refresh([settings]);
    if (animate && direction && !settings.hidden)
      WorkTimeApp.ui.motion?.play(
        document.getElementById(tab.getAttribute("aria-controls")),
        direction > 0 ? "motion-sidebar-forward" : "motion-sidebar-back",
      );
    if (focus) tab.focus({ preventScroll: true });
  }
  function closeSettingsPanel() {
    if (settings.hidden) return;
    if (
      !settings.dispatchEvent(
        new Event("settings-close-request", { cancelable: true }),
      )
    )
      return;
    hidePopovers();
    WorkTimeApp.ui.motion?.stop(settings);
    settings.hidden = true;
    editor.classList.remove("is-page-settings-open", "is-settings-open");
    settings.dispatchEvent(new Event("settings-closed"));
    updateSettingsButton();
    if (!disposed) {
      const content = editor.closest(".agenda-mode")
        ? document.getElementById("agendaEditor")
        : editor.querySelector(".editor-content");
      WorkTimeApp.ui.motion?.play(content, "motion-sidebar-back");
      settingsButton.focus({ preventScroll: true });
    }
  }
  function openSettings(tab = activeTab) {
    if (disposed) return;
    const opening = settings.hidden;
    if (opening) {
      leaveBatch();
      settings.dispatchEvent(new Event("settings-open"));
      document
        .getElementById("personalSettingsPane")
        .dispatchEvent(new Event("personal-settings-open"));
      settings.hidden = false;
      settings.dispatchEvent(new Event("settings-opened"));
      editor.classList.add("is-page-settings-open", "is-settings-open");
      updateSettingsButton();
      WorkTimeApp.ui.motion?.stop(editor.querySelector(".editor-content"));
      WorkTimeApp.ui.motion?.stop(document.getElementById("agendaEditor"));
      WorkTimeApp.ui.motion?.play(settings, "motion-sidebar-forward");
      if (window.matchMedia("(max-width: 1150px)").matches)
        editor.scrollIntoView({ block: "start" });
    }
    selectTab(tab, false, !opening);
  }
  function toggleSettings() {
    if (settings.hidden) openSettings();
    else closeSettingsPanel();
  }
  function tabClick(event) {
    const tab = event.target.closest('[role="tab"]');
    if (tabs.includes(tab)) selectTab(tab);
  }
  function tabKeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(activeTab);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    selectTab(tabs[next], true);
  }
  settingsButton.addEventListener("click", toggleSettings);
  settingsCancel.addEventListener("click", closeSettingsPanel);
  tablist.addEventListener("click", tabClick);
  tablist.addEventListener("keydown", tabKeydown);
  selectTab(activeTab);
  function render() {
    const active = stack.at(-1);
    sidebar.classList.toggle("is-oa-open", !!active);
    const importOpen = document.getElementById("importOpen");
    importOpen.classList.toggle("is-return", !!active);
    const secondaryActions = document.querySelector(
      ".import-secondary-actions",
    );
    secondaryActions.inert = !!active;
    secondaryActions.setAttribute("aria-hidden", String(!!active));
    const returnLabel =
      stack.length > 1
        ? WorkTimeApp.i18n.t("copy.e1fa5c7224")
        : WorkTimeApp.i18n.t("copy.13e491d46e");
    importOpen.querySelector(".import-main > span").textContent = active
      ? returnLabel
      : WorkTimeApp.i18n.t("copy.f80695ff47");
    importOpen
      .querySelector(".import-main use")
      .setAttribute("href", active ? "#ms-chevron-left" : "#ms-add");
    importOpen.setAttribute(
      "aria-label",
      active ? returnLabel : WorkTimeApp.i18n.t("copy.f80695ff47"),
    );
    importOpen.title = active
      ? returnLabel
      : WorkTimeApp.i18n.t("copy.ed282645c7");
    host.hidden = !active;
    for (const element of overview)
      element.classList.toggle("sidebar-overview-hidden", !!active);
    for (const [id, pane] of panes)
      pane.classList.toggle("sidebar-pane-inactive", id !== active?.id);
    if (active) {
      const pane = panes.get(active.id),
        back =
          stack.length > 1
            ? WorkTimeApp.i18n.t("copy.b14f0fab76")
            : WorkTimeApp.i18n.t("copy.07fcc4d5f6");
      const close = pane.querySelector(".dialog-head [data-close]");
      if (close) {
        close.setAttribute("aria-label", back);
        close.title = back;
      }
      pane.querySelectorAll(".dialog-foot [data-close]").forEach((button) => {
        button.querySelector(".button-label").textContent =
          active.id === "importDialog"
            ? WorkTimeApp.i18n.t("copy.4d0b4688c7")
            : WorkTimeApp.i18n.t("copy.11d0241540");
      });
    }
  }
  function open(id, { motionDuration } = {}) {
    if (id === "settingsDialog" && !disposed) {
      openSettings(document.getElementById("settingsWorkTab"));
      return true;
    }
    if (!panes.has(id) || disposed) return false;
    const navigating = stack.at(-1)?.id !== id;
    const instant = motionDuration === 0;
    if (instant) {
      finishNavigationMotion();
      sidebar.classList.add("sidebar-navigation-instant");
      // Apply zero timing before changing the view, including an interrupted return.
      void sidebar.offsetWidth;
    }
    try {
      const index = stack.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        const removed = stack.splice(index + 1);
        for (const entry of removed) panes.get(entry.id).close();
      } else stack.push({ id, trigger: document.activeElement });
      render();
      const pane = panes.get(id);
      if (!pane.open) pane.show();
      if (navigating && !instant)
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
      if (instant) {
        // Commit the final zero-duration state in the click handler before opening OA.
        void sidebar.offsetWidth;
        finishNavigationMotion();
      }
      return true;
    } finally {
      if (instant) {
        sidebar.classList.remove("sidebar-navigation-instant");
        void sidebar.offsetWidth;
      }
    }
  }
  function closeImport() {
    if (disposed || !stack.length) return;
    const removed = stack.splice(0);
    for (const entry of removed) {
      const pane = panes.get(entry.id);
      WorkTimeApp.ui.motion?.stop(pane);
      if (pane.open) pane.close();
    }
    render();
    finishNavigationMotion();
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
    if (event.defaultPrevented) return;
    if (
      event.key === "Escape" &&
      !settings.hidden &&
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
    document.removeEventListener("worktime:languagechange", refreshLanguage);
    if (disposed) return;
    disposed = true;
    themeSettings.dispose();
    settingsButton.removeEventListener("click", toggleSettings);
    settingsCancel.removeEventListener("click", closeSettingsPanel);
    tablist.removeEventListener("click", tabClick);
    tablist.removeEventListener("keydown", tabKeydown);
    WorkTimeApp.ui.motion?.stop(editor);
    hidePopovers();
    settings.hidden = true;
    editor.classList.remove("is-page-settings-open", "is-settings-open");
    updateSettingsButton();
    document.removeEventListener("keydown", keydown);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", finishNavigationMotion);
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
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", finishNavigationMotion);
  function refreshLanguage() {
    render();
    updateSettingsButton();
  }
  document.addEventListener("worktime:languagechange", refreshLanguage);
  return {
    open,
    closeImport,
    dispose,
    closeSettings: closeSettingsPanel,
    finishNavigationMotion,
  };
};
