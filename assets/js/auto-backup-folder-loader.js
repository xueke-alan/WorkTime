"use strict";
/** Keep the folder settings UI out of the initial calendar payload. */
WorkTimeApp.ui.loadAutoBackupFolderSettings = () =>
  WorkTimeApp.services.assets.script("assets/js/auto-backup-folder.js");
(() => {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
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
    },
    { once: true },
  );
})();
