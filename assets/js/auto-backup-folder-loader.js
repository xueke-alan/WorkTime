"use strict";
/** Keep the folder settings UI out of the initial calendar payload. */
WorkTimeApp.ui.loadAutoBackupFolderSettings = () =>
  WorkTimeApp.services.assets.script("assets/js/auto-backup-folder.js");
(() => {
  function mount() {
    const pane = document.getElementById("settingsPane");
    if (!pane) return;
    const observer = new MutationObserver(() => {
      if (!pane.hidden)
        void WorkTimeApp.ui.loadAutoBackupFolderSettings().catch(() => {});
    });
    observer.observe(pane, { attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("pagehide", () => observer.disconnect(), {
      once: true,
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
