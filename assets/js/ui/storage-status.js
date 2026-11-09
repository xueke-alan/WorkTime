"use strict";
/** Own storage failure text; never reads or modifies business state. */
WorkTimeApp.ui.createStorageStatus = function ({ element: $, window }) {
  let mounted = false,
    generation = 0,
    retryButton = null,
    recoveryOptions = null;
  let noticeRenderer = null;
  function setNotice(render) {
    noticeRenderer = render;
    $("storageNoticeText").textContent = render();
  }
  function languageChanged() {
    if (noticeRenderer) $("storageNoticeText").textContent = noticeRenderer();
  }
  function updateRecovery() {
    if (!retryButton || !recoveryOptions) return;
    const issue = recoveryOptions.getLoadIssue?.();
    retryButton.hidden =
      !recoveryOptions.available ||
      (recoveryOptions.getLoadIssue
        ? issue === "corrupt" || issue === "unsupported"
        : recoveryOptions.corrupt);
  }
  function mount({
    readError = null,
    accessError = null,
    loadIssue = null,
  } = {}) {
    if (mounted) return;
    mounted = true;
    if (readError)
      setNotice(
        () =>
          WorkTimeApp.i18n.t("copy.d2e1522b40") +
          WorkTimeApp.i18n.message(readError.message) +
          (loadIssue === "unavailable"
            ? WorkTimeApp.i18n.t("copy.72b45c7054")
            : loadIssue === "unsupported"
              ? WorkTimeApp.i18n.t("copy.3320011973")
              : loadIssue === null
                ? WorkTimeApp.i18n.t("copy.c957bee3d1")
                : WorkTimeApp.i18n.t("copy.e758cbee14")),
      );
    else if (accessError)
      setNotice(
        () =>
          WorkTimeApp.i18n.t("copy.f9843c1f65") +
          WorkTimeApp.i18n.message(accessError.message) +
          "。",
      );
    window.document.addEventListener(
      "worktime:languagechange",
      languageChanged,
    );
  }
  return {
    externalUpdate() {
      $("storageNotice").classList.remove("hidden");
      setNotice(() => WorkTimeApp.i18n.t("copy.dfbddf642a"));
    },
    mount,
    updateRecovery,
    bindRetry(options) {
      recoveryOptions = options;
      const { retry } = options;
      retryButton = $("retryStorage");
      updateRecovery();
      retryButton.onclick = async () => {
        const lifetime = generation,
          button = retryButton;
        button.disabled = true;
        await retry();
        if (mounted && lifetime === generation) button.disabled = false;
      };
    },
    commit(result, failed) {
      $("storageNotice").classList.toggle("hidden", !failed);
      if (!result.persisted)
        setNotice(
          () =>
            WorkTimeApp.i18n.t("copy.6b1e0578cf") +
            WorkTimeApp.i18n.message(result.error.message) +
            WorkTimeApp.i18n.t("copy.41781161e3"),
        );
    },
    recoveryFailed(error) {
      setNotice(
        () =>
          WorkTimeApp.i18n.t("copy.1e84e9bf60") +
          WorkTimeApp.i18n.message(error.message) +
          WorkTimeApp.i18n.t("copy.116af10da7"),
      );
    },
    accessFailed(error) {
      setNotice(
        () =>
          WorkTimeApp.i18n.t("copy.1b7a127a55") +
          WorkTimeApp.i18n.message(error.message) +
          (error.code === "LOCK_BUSY"
            ? WorkTimeApp.i18n.t("copy.02569c6fb4")
            : WorkTimeApp.i18n.t("copy.deafa0e2d2")),
      );
    },
    dispose() {
      if (!mounted) return;
      mounted = false;
      generation++;
      if (retryButton) retryButton.onclick = null;
      retryButton = null;
      window.document.removeEventListener(
        "worktime:languagechange",
        languageChanged,
      );
    },
  };
};
