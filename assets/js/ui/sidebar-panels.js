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
    editorViews = [editor.querySelector(".editor-content")],
    settings = document.getElementById("settingsDialog");
  const editorTabs = editor.querySelector(".notification-tabs");
  const pageSettings = document.getElementById("pageSettingsPane");
  const themeSettings = WorkTimeApp.ui.theme.mount(
    pageSettings.querySelector(".theme-settings-host"),
  );
  const pagePanels = [
    {
      button: "pageSettingsOpen",
      pane: "pageSettingsPane",
      cancel: "personalSettingsCancel",
      label: "copy.165118b1d4",
      closeLabel: "copy.e2ae92e1ec",
      icon: "settings",
    },
    {
      button: "personalSettingsOpen",
      pane: "personalSettingsPane",
      cancel: "profileSettingsCancel",
      label: "copy.c241ef1b93",
      closeLabel: "profile.close",
      icon: "article-person",
      personal: true,
    },
  ].map((config) => ({
    ...config,
    button: document.getElementById(config.button),
    pane: document.getElementById(config.pane),
    cancel: document.getElementById(config.cancel),
  }));
  function updatePageButton(panel) {
    const open = !panel.pane.hidden;
    panel.button.classList.toggle("primary", open);
    panel.button.setAttribute("aria-pressed", String(open));
    panel.button.title = WorkTimeApp.i18n.t(
      open ? panel.closeLabel : panel.label,
    );
    panel.button.setAttribute("aria-label", panel.button.title);
    panel.button
      .querySelector("use")
      .setAttribute("href", open ? "#ms-close" : "#ms-" + panel.icon);
  }
  function closePageSettings(focus = true) {
    const active = pagePanels.find((panel) => !panel.pane.hidden);
    if (!active) return;
    WorkTimeApp.ui.motion?.stop(active.pane);
    active.pane.hidden = true;
    if (active.personal)
      active.pane.dispatchEvent(new Event("personal-settings-close"));
    editor.classList.remove("is-page-settings-open");
    updatePageButton(active);
    if (!disposed)
      WorkTimeApp.ui.motion?.play(editorViews[0], "motion-sidebar-back");
    if (focus) active.button.focus({ preventScroll: true });
  }
  function togglePageSettings(panel) {
    if (disposed) return;
    if (!panel.pane.hidden) {
      closePageSettings();
      return;
    }
    closeSettingsPanel();
    if (settings.open) return;
    closePageSettings(false);
    leaveBatch();
    if (panel.personal)
      panel.pane.dispatchEvent(new Event("personal-settings-open"));
    panel.pane.hidden = false;
    WorkTimeApp.ui.motion?.stop(editorViews[0]);
    editor.classList.add("is-page-settings-open");
    updatePageButton(panel);
    WorkTimeApp.ui.motion?.play(panel.pane, "motion-sidebar-forward");
    WorkTimeApp.ui.alignment?.refresh([panel.pane]);
    if (window.matchMedia("(max-width: 1150px)").matches)
      editor.scrollIntoView({ block: "start" });
    panel.button.focus({ preventScroll: true });
  }
  function leavePageSettings(event) {
    if (
      pagePanels.some((panel) => !panel.pane.hidden) &&
      event.target.closest(
        "#batchToggle, #settingsOpen, #setupButton, #restore",
      )
    )
      closePageSettings(false);
  }
  const workSettingsCancel = document.getElementById("workSettingsCancel");
  workSettingsCancel.addEventListener("click", closeSettingsPanel);
  for (const panel of pagePanels) {
    panel.toggle = () => togglePageSettings(panel);
    panel.close = () => closePageSettings();
    panel.button.addEventListener("click", panel.toggle);
    panel.cancel.addEventListener("click", panel.close);
  }
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
      open
        ? WorkTimeApp.i18n.t("copy.d223bd345f")
        : WorkTimeApp.i18n.t("copy.a09e533eed"),
    );
    button.title = open
      ? WorkTimeApp.i18n.t("copy.d223bd345f")
      : WorkTimeApp.i18n.t("copy.a09e533eed");
    button
      .querySelector("use")
      .setAttribute(
        "href",
        open ? "#ms-close" : "#ms-nest-clock-farsight-analog",
      );
  }
  function closeSettings() {
    if (settings.open || !editor.classList.contains("is-settings-open")) return;
    editor.classList.remove("is-settings-open");
    WorkTimeApp.ui.motion?.stop(document.getElementById("settingsForm"));
    editorViews.forEach((view) =>
      view.classList.remove("settings-view-hidden"),
    );
    updateSettingsButton(false);
    WorkTimeApp.ui.motion?.play(editorViews[0], "motion-sidebar-back");
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
      closePageSettings(false);
      const trigger = document.activeElement;
      WorkTimeApp.ui.motion?.stop(editorViews[0]);
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
      pagePanels.some((panel) => !panel.pane.hidden) &&
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
    document.removeEventListener("worktime:languagechange", refreshLanguage);
    if (disposed) return;
    disposed = true;
    themeSettings.dispose();
    workSettingsCancel.removeEventListener("click", closeSettingsPanel);
    for (const panel of pagePanels) {
      panel.button.removeEventListener("click", panel.toggle);
      panel.cancel.removeEventListener("click", panel.close);
    }
    document.removeEventListener("click", leavePageSettings, true);
    closePageSettings(false);
    settings.removeEventListener("close", closeSettings);
    editorTabs.removeEventListener("click", leaveSettingsFromTab);
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
    updateSettingsButton(settings.open);
    pagePanels.forEach(updatePageButton);
  }
  document.addEventListener("worktime:languagechange", refreshLanguage);
  return {
    open,
    dispose,
    closeSettings: closeSettingsPanel,
    finishNavigationMotion,
  };
};
