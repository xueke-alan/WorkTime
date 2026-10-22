"use strict";
/** backup controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createBackupController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const {
    core: C,
    element: $,
    application,
    originalStorageText,
    getOriginalStorageText = () => originalStorageText,
    model,
    actions,
    clipboard,
    downloads,
    preferences,
    persistence,
    exportArchive,
  } = options;
  let restoreData = null;
  let pendingTheme = null;
  let disposed = false;
  let generation = 0;
  const download = downloads.download;
  let copyResetTimer = null,
    holdAction = null;
  const BACKUP_MAX_BYTES = WorkTimeApp.services.backup.MAX_BYTES;
  const compressBackupText = WorkTimeApp.services.backup.encode;
  const readBackupText = (text) =>
    WorkTimeApp.services.backup.decode(
      text,
      WorkTimeApp.services.archive.migrate,
    );
  function updateRecovery() {
    const issue = model.loadIssue;
    $("exportCorruptStorage").hidden = getOriginalStorageText() === null;
    $("restoreStorage").hidden = !model.loadCorrupt;
    $("initializeStorage").hidden = issue !== "corrupt";
    $("convertStorage").hidden = issue !== "unsupported";
    $("backupBeforeRestore").querySelector(".button-label").textContent =
      model.loadCorrupt
        ? WorkTimeApp.i18n.t("copy.4b5a44d0fd")
        : WorkTimeApp.i18n.t("copy.02ffd2393f");
    $("backupScopeNote").hidden = !model.loadCorrupt;
  }
  function exportOriginal() {
    const text = getOriginalStorageText();
    if (text !== null && text !== undefined)
      download(
        WorkTimeApp.i18n.t("copy.0f14276a72") + model.today + ".txt",
        text,
        "text/plain;charset=utf-8",
      );
  }
  function finishThemeRestore() {
    WorkTimeApp.services.preferences.page.synchronize();
    pendingTheme = null;
    $("restoreDialog").close();
    actions.toast(WorkTimeApp.i18n.t("copy.8e990e61b4"), "countdown");
  }
  async function backup() {
    try {
      download(
        WorkTimeApp.i18n.t("copy.35c89c4491") + model.today + ".json",
        JSON.stringify(await exportArchive(), null, 2),
        "application/json;charset=utf-8",
      );
      actions.toast(WorkTimeApp.i18n.t("copy.5091362c8b"), "countdown");
    } catch (error) {
      actions.toast(
        WorkTimeApp.i18n.t("copy.d09d00bfdf") +
          WorkTimeApp.i18n.message(error.message),
        "error",
      );
    }
  }
  let backupCopying = false;
  async function copyBackup() {
    const lifetime = generation;
    const button = $("backup");
    if (backupCopying) return;
    backupCopying = true;
    try {
      const raw = JSON.stringify(await exportArchive());
      const text =
        typeof CompressionStream === "function"
          ? await compressBackupText(raw)
          : raw;
      if (disposed || lifetime !== generation) return;
      await clipboard.writeText(text);
      if (disposed || lifetime !== generation) return;
      button.classList.remove("is-copying");
      void button.offsetWidth;
      button.classList.add("is-copying");
      copyResetTimer = setTimeout(
        () => button.classList.remove("is-copying"),
        450,
      );
      actions.toast(WorkTimeApp.i18n.t("copy.1af51f35b9"), "countdown");
    } catch (error) {
      if (disposed || lifetime !== generation) return;
      actions.toast(
        WorkTimeApp.i18n.t("copy.ee57d577cd") +
          (error?.name === "NotAllowedError"
            ? WorkTimeApp.i18n.t("copy.f9a447f192")
            : WorkTimeApp.i18n.message(error?.message) ||
              WorkTimeApp.i18n.t("copy.91aaca6374")),
        "error",
      );
    } finally {
      if (lifetime === generation) backupCopying = false;
    }
  }
  function previewRestore(data, source) {
    if (disposed) return;
    restoreData = data;
    pendingTheme = null;
    $("restoreError").textContent = "";
    $("confirmRestore").disabled = false;
    $("retryRestoreTheme").hidden = true;
    $("restoreSummary").textContent =
      WorkTimeApp.i18n.t("copy.16593aa84d") +
      source +
      WorkTimeApp.i18n.t("copy.d00504a2b1") +
      Object.keys(data.days).length +
      WorkTimeApp.i18n.t("copy.a85bcb6937") +
      data.imports.length +
      WorkTimeApp.i18n.t("copy.aec4ccf1cc") +
      data.timeTemplates.length +
      WorkTimeApp.i18n.t("copy.a59c403e93") +
      data.scheduleRanges.length +
      WorkTimeApp.i18n.t("copy.f0874e5ebf") +
      C.hours(data.settings.standardMinutes) +
      WorkTimeApp.i18n.t("copy.5345ffe2c2") +
      (data.preferences.pageTheme
        ? WorkTimeApp.i18n.t("copy.2b4a7a895b") +
          WorkTimeApp.i18n.message(
            WorkTimeApp.domain.preferences.themes.find(
              (theme) => theme.id === data.preferences.pageTheme,
            ).name,
          ) +
          "。"
        : "");
    actions.open("restoreDialog");
  }
  async function restoreFromClipboard() {
    const lifetime = generation;
    const button = $("restore");
    if (button.disabled) return;
    button.disabled = true;
    restoreData = null;
    try {
      const text = await clipboard.readText();
      if (disposed || lifetime !== generation) return;
      const decoded = await readBackupText(text);
      if (disposed || lifetime !== generation) return;
      previewRestore(decoded, WorkTimeApp.i18n.t("copy.c4eb94d079"));
      actions.toast(WorkTimeApp.i18n.t("copy.32936d1ceb"));
    } catch (error) {
      if (disposed || lifetime !== generation) return;
      if (error.code === "gameOnly") {
        actions.toast(error.message, "error");
        return;
      }
      const detail =
        (error?.name ? error.name + ": " : "") +
        (WorkTimeApp.i18n.message(error?.message) ||
          WorkTimeApp.i18n.t("copy.91aaca6374"));
      actions.toast(
        WorkTimeApp.i18n.t("copy.9f71e85dd5") + "：" + detail,
        "error",
      );
      $("backupFile").click();
    } finally {
      if (lifetime === generation) button.disabled = false;
    }
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    disposed = false;
    generation++;
    updateRecovery();
    events.handler($("recoveryOpen"), "onclick", async () => {
      try {
        const rows = await persistence.snapshots();
        const list = $("snapshotList");
        list.replaceChildren();
        for (const row of rows) {
          const button = document.createElement("button");
          button.className = "ui-button";
          button.textContent =
            (row.type === "daily"
              ? WorkTimeApp.i18n.t("copy.8110f0f8ff")
              : WorkTimeApp.i18n.t("copy.9d53968411")) +
            new Date(row.at).toLocaleString(WorkTimeApp.i18n.locale);
          button.onclick = () => {
            try {
              const data = WorkTimeApp.services.archive.migrate(row.document);
              $("recoveryDialog").close();
              previewRestore(data, WorkTimeApp.i18n.t("copy.7f928d3f63"));
            } catch (error) {
              $("recoveryError").textContent =
                WorkTimeApp.i18n.t("copy.19d1b9b4a4") +
                WorkTimeApp.i18n.message(error.message);
            }
          };
          list.append(button);
        }
        if (!rows.length)
          list.textContent = WorkTimeApp.i18n.t("copy.2901f95580");
        $("recoveryError").textContent = "";
        actions.open("recoveryDialog");
      } catch (error) {
        actions.toast(
          WorkTimeApp.i18n.t("copy.1e79e236e5") +
            WorkTimeApp.i18n.message(error.message),
          "error",
        );
      }
    });
    events.handler($("downloadRecovery"), "onclick", async () => {
      try {
        download(
          WorkTimeApp.i18n.t("copy.3a8bf199c6") + model.today + ".json",
          JSON.stringify(await persistence.recoveryData(), null, 2),
          "application/json;charset=utf-8",
        );
      } catch (error) {
        $("recoveryError").textContent = WorkTimeApp.i18n.message(
          error.message,
        );
      }
    });
    events.handler($("clearSnapshots"), "onclick", () =>
      actions.open("clearSnapshotsDialog"),
    );
    events.handler($("confirmClearSnapshots"), "onclick", async () => {
      try {
        await persistence.clearSnapshots();
        $("clearSnapshotsDialog").close();
        $("snapshotList").textContent = WorkTimeApp.i18n.t("copy.2901f95580");
      } catch (error) {
        actions.toast(
          WorkTimeApp.i18n.t("copy.47a732ee5e") +
            WorkTimeApp.i18n.message(error.message),
          "error",
        );
      }
    });
    events.handler($("restoreLegacy"), "onclick", async () => {
      try {
        const data = await persistence.recoveryData();
        if (!data.legacyText)
          throw Error(WorkTimeApp.i18n.t("copy.fe1afd4a86"));
        previewRestore(
          WorkTimeApp.services.archive.migrate(JSON.parse(data.legacyText)),
          WorkTimeApp.i18n.t("copy.a02ab93291"),
        );
        $("recoveryDialog").close();
      } catch (error) {
        $("recoveryError").textContent = WorkTimeApp.i18n.message(
          error.message,
        );
      }
    });
    events.handler($("exportCorruptStorage"), "onclick", exportOriginal);
    events.handler($("exportBeforeInitialize"), "onclick", exportOriginal);
    events.handler($("restoreStorage"), "onclick", restoreFromClipboard);
    events.handler($("initializeStorage"), "onclick", () => {
      if (model.loadIssue !== "corrupt") return;
      $("initializeError").textContent = "";
      actions.open("initializeDialog");
    });
    events.handler($("confirmInitialize"), "onclick", async () => {
      try {
        const result = await application.initialize(
          preferences.state.pageTheme,
        );
        if (!result.persisted) {
          $("initializeError").textContent =
            WorkTimeApp.i18n.t("copy.d3ca375f67") +
            WorkTimeApp.i18n.message(result.error.message);
          return;
        }
        // A fresh page clears every editor/controller draft and batch selection.
        actions.refreshSettings();
        window.location.reload();
      } catch (error) {
        $("initializeError").textContent = WorkTimeApp.i18n.message(
          error.message,
        );
      }
    });
    events.listen($("restoreDialog"), "close", () => {
      restoreData = null;
      pendingTheme = null;
    });
    events.handler($("retryRestoreTheme"), "onclick", () => {
      if (pendingTheme !== null) finishThemeRestore();
    });
    holdAction = WorkTimeApp.ui.createHoldAction({
      button: $("backup"),
      onShort: copyBackup,
      onLong: backup,
      keys: ["Space", "Enter"],
    });
    events.handler($("backupBeforeRestore"), "onclick", backup);
    events.handler($("restore"), "onclick", restoreFromClipboard);
    events.handler($("backupFile"), "onchange", async (e) => {
      const lifetime = generation;
      const f = e.target.files[0];
      if (!f) return;
      restoreData = null;
      try {
        if (f.size > BACKUP_MAX_BYTES)
          throw Error(WorkTimeApp.i18n.t("copy.c3b5086f19"));
        const decoded = await readBackupText(await f.text());
        if (disposed || lifetime !== generation) return;
        previewRestore(decoded, WorkTimeApp.i18n.t("copy.49deaf7da2"));
        actions.toast(WorkTimeApp.i18n.t("copy.32936d1ceb"));
      } catch (err) {
        if (disposed || lifetime !== generation) return;
        actions.toast(
          WorkTimeApp.i18n.t("copy.08c8ed5980") +
            WorkTimeApp.i18n.message(err.message),
          "error",
        );
      }
      e.target.value = "";
    });
    events.handler($("confirmRestore"), "onclick", async () => {
      if (!restoreData) return;
      const candidate = restoreData;
      $("confirmRestore").disabled = true;
      let result;
      try {
        result = await application.restore(candidate);
      } catch (error) {
        result = { persisted: false, error };
      }
      if (!result.persisted) {
        $("restoreError").textContent =
          WorkTimeApp.i18n.t("copy.3bf46b1e59") +
          WorkTimeApp.i18n.message(result.error.message);
        $("confirmRestore").disabled = false;
        return;
      }
      pendingTheme = candidate.preferences.pageTheme;
      restoreData = null;
      actions.render();
      finishThemeRestore();
    });
  }
  function dispose() {
    generation++;
    backupCopying = false;
    $("restore").disabled = false;
    events.dispose();
    bound = false;
    disposed = true;
    restoreData = null;
    pendingTheme = null;
    holdAction?.dispose();
    clearTimeout(copyResetTimer);
  }
  const hasDraft = () =>
    restoreData !== null || pendingTheme !== null || $("initializeDialog").open;
  return { bind, dispose, hasDraft, updateRecovery };
};
