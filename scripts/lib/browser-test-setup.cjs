"use strict";
/** Isolate unrelated feature tests from mandatory first-run setup.
 * Folder/onboarding tests do not load this fixture. Backup tests keep their
 * scheduled backups enabled; other tests disable them in their fresh profile.
 */
const { chromium } = require("playwright");
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...options) => {
    const context = await newContext(...options);
    await context.addInitScript((testClipboard) => {
      const show = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function (...args) {
        const result = show.apply(this, args);
        if (
          this.id === "onboardingDialog" ||
          (this.id === "startupPermissionsDialog" &&
            !this.classList.contains("has-both-permissions") &&
            this.querySelector("#startupFolderPermission").hidden &&
            !testClipboard)
        )
          this.close();
        return result;
      };
    }, process.env.WORKTIME_TEST_CLIPBOARD === "1");
    if (process.env.WORKTIME_TEST_DISABLE_AUTO_BACKUP === "1")
      await context.addInitScript(() => {
        document.addEventListener(
          "worktime:ready",
          () => {
            void WorkTimeApp.services.preferences.page.saveAutoBackupDays(0);
          },
          { once: true },
        );
      });
    return context;
  };
  return browser;
};
