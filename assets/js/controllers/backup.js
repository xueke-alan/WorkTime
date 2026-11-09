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
    preferences,
    persistence,
    backupSource,
  } = options;
  let restoreData = null;
  let restoreGames = null;
  let pendingTheme = null;
  let disposed = false;
  let generation = 0;
  let restoreRequest = 0;
  const BACKUP_MAX_BYTES = WorkTimeApp.services.backup.MAX_BYTES;
  const FULL_FORMAT = "worktime-full-backup";
  let cache = null,
    backupBusy = false;
  const subscriptions = [];
  async function exportBackup() {
    await actions.prepareAgendaArchive();
    // The backup cache prepares only games that actually have saved data.
    return cache.capture();
  }
  function beginBackup() {
    if (backupBusy || disposed) return false;
    backupBusy = true;
    $("backupBeforeRestore").disabled = true;
    $("backupBeforeRestore").setAttribute("aria-busy", "true");
    actions.toast(WorkTimeApp.i18n.t("backup.preparing"), "countdown");
    return true;
  }
  function endBackup(lifetime) {
    if (lifetime !== generation) return;
    backupBusy = false;
    $("backupBeforeRestore").disabled = false;
    $("backupBeforeRestore").removeAttribute("aria-busy");
  }
  const readBackupText = (text) =>
    WorkTimeApp.services.backup.decode(text, async (value) => {
      if (value?.format !== FULL_FORMAT)
        return {
          work: WorkTimeApp.services.archive.migrate(value),
          games: null,
        };
      if (value.version !== 1)
        throw Error(WorkTimeApp.i18n.t("backup.unsupported"));
      const work = WorkTimeApp.services.archive.migrate(value.work);
      await WorkTimeApp.games.prepareArchive(
        Object.keys(value.games?.games || {}),
      );
      const games = WorkTimeApp.services.gameArchive.validate(value.games);
      return { work, games };
    });
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
  async function exportOriginal() {
    const text = getOriginalStorageText();
    if (text === null || text === undefined || !beginBackup()) return;
    const lifetime = generation;
    try {
      await WorkTimeApp.services.autoBackupFolder.write(
        WorkTimeApp.i18n.t("copy.0f14276a72") + model.today + ".txt",
        text,
        { kind: "manual" },
      );
      actions.toast(
        () =>
          WorkTimeApp.ui.runtimeFolderText("backupSaved", {
            name: "backups/manual/",
          }),
        "countdown",
      );
    } catch (error) {
      await backupFailure(error);
    } finally {
      endBackup(lifetime);
    }
  }
  async function backupFailure(error) {
    if (error.folderCode) {
      await WorkTimeApp.ui.loadAutoBackupFolderSettings().catch(() => {});
      if (error.folderCode === "needsInitialization")
        await WorkTimeApp.ui.onboarding.mount();
    }
    actions.toast(
      WorkTimeApp.i18n.t("copy.d09d00bfdf") +
        (error.folderCode
          ? WorkTimeApp.ui.autoBackupFolderText?.(error.folderCode) ||
            error.message
          : WorkTimeApp.i18n.message(error.message)),
      "error",
    );
  }
  function finishThemeRestore() {
    WorkTimeApp.services.preferences.page.synchronize();
    pendingTheme = null;
    $("restoreDialog").close();
    actions.toast(WorkTimeApp.i18n.t("copy.8e990e61b4"), "countdown");
  }
  async function backup(automatic = false) {
    if (!beginBackup()) return false;
    const lifetime = generation;
    try {
      const text = await exportBackup();
      if (disposed || lifetime !== generation) return false;
      const name =
        WorkTimeApp.i18n.t("copy.35c89c4491") +
        new Date(Date.now() + 8 * 3600000)
          .toISOString()
          .slice(0, 19)
          .replace(/[-:]/g, "")
          .replace("T", "-") +
        ".txt";
      const folder = WorkTimeApp.services.autoBackupFolder;
      await folder.write(name, text, {
        kind: automatic === true ? "automatic" : "manual",
      });
      await WorkTimeApp.ui.loadAutoBackupFolderSettings().catch(() => {});
      actions.toast(
        () =>
          WorkTimeApp.ui.runtimeFolderText("backupSaved", {
            name: automatic === true ? "backups/automatic/" : "backups/manual/",
          }),
        "countdown",
      );
      if (
        !model.loadIssue &&
        !model.storageFailed &&
        persistence.canWrite &&
        persistence.readSucceeded
      ) {
        const saved = await WorkTimeApp.services.preferences.page.saveBackupAt(
          new Date().toISOString(),
        );
        if (!disposed && !saved.persisted)
          actions.toast(WorkTimeApp.i18n.t("autoBackup.timeFailed"), "error");
      }
      return true;
    } catch (error) {
      await backupFailure(error);
      return false;
    } finally {
      endBackup(lifetime);
    }
  }
  let autoBackupChecked = false,
    autoBackupRunning = false;
  async function checkAutoBackup({ retry = false } = {}) {
    if (
      autoBackupRunning ||
      backupBusy ||
      disposed ||
      (autoBackupChecked && !retry)
    )
      return;
    autoBackupRunning = true;
    autoBackupChecked = true;
    try {
      await WorkTimeApp.services.autoBackupFolder.initialize();
      const runtime = WorkTimeApp.services.autoBackupFolder;
      // Scheduled backups wait for migration/import instead of recording a
      // transient busy failure and missing the next backup opportunity.
      if (runtime.state.busy)
        await new Promise((resolve) => {
          const unsubscribe = runtime.subscribe(() => {
            if (!runtime.state.busy) {
              unsubscribe();
              resolve();
            }
          });
        });
      if (disposed) return;
      const pagePreferences = WorkTimeApp.services.preferences.page;
      const lastDate = pagePreferences.state.lastAutoBackupDate;
      const today = WorkTimeApp.domain.time.businessDate(new Date());
      if (
        model.loadIssue ||
        model.storageFailed ||
        !persistence.canWrite ||
        !persistence.readSucceeded ||
        pagePreferences.dirty ||
        !WorkTimeApp.domain.preferences.autoBackupDue(
          pagePreferences.state,
          today,
        )
      )
        return;
      if (!(await backup(true)) || disposed) return;
      // Respect a setting change or restore while preparing the file.
      if (
        !pagePreferences.state.autoBackupDays ||
        pagePreferences.state.lastAutoBackupDate !== lastDate
      )
        return;
      const result = await pagePreferences.saveAutoBackupDate(today);
      if (!disposed && !result.persisted)
        actions.toast(WorkTimeApp.i18n.t("autoBackup.dateFailed"), "error");
    } finally {
      autoBackupRunning = false;
    }
  }
  function previewRestore(data, source, games = null) {
    if (disposed) return;
    restoreData = data;
    restoreGames = games;
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
        : "") +
      WorkTimeApp.i18n.t(games ? "backup.includesGames" : "backup.workOnly", {
        count: Object.keys(games?.games || {}).length,
      });
    $("restoreSummary").textContent +=
      " " +
      WorkTimeApp.i18n.t("agenda.restore", {
        count: (data.agenda || []).length,
      }) +
      " " +
      WorkTimeApp.i18n.t("agenda.memoRestore", {
        count: (data.memo || "").length,
      });
    actions.open("restoreDialog");
  }
  async function restoreFile(file, lifetime, request) {
    if (
      !file ||
      disposed ||
      lifetime !== generation ||
      request !== restoreRequest
    )
      return;
    restoreData = null;
    restoreGames = null;
    try {
      if (file.size > BACKUP_MAX_BYTES)
        throw Error(WorkTimeApp.i18n.t("copy.c3b5086f19"));
      const decoded = await readBackupText(await file.text());
      if (disposed || lifetime !== generation || request !== restoreRequest)
        return;
      previewRestore(
        decoded.work,
        WorkTimeApp.i18n.t("copy.49deaf7da2"),
        decoded.games,
      );
      actions.toast(WorkTimeApp.i18n.t("copy.32936d1ceb"));
    } catch (error) {
      if (disposed || lifetime !== generation || request !== restoreRequest)
        return;
      actions.toast(
        WorkTimeApp.i18n.t("copy.08c8ed5980") +
          WorkTimeApp.i18n.message(error.message),
        "error",
      );
    }
  }
  async function chooseBackupFile() {
    if (disposed || $("restore").disabled) return;
    const input = $("backupFile");
    input.value = "";
    if (typeof window.showOpenFilePicker !== "function") {
      input.click();
      return;
    }
    const lifetime = generation;
    const request = ++restoreRequest;
    $("restore").disabled = true;
    try {
      // Without a picker id, startIn takes precedence over the last used folder.
      const startIn = await WorkTimeApp.services.runtimeFolder
        .getDirectory("backups")
        .catch(() => undefined);
      if (disposed || lifetime !== generation || request !== restoreRequest)
        return;
      const [handle] = await window.showOpenFilePicker({
        ...(startIn ? { startIn } : {}),
        multiple: false,
        types: [
          {
            accept: {
              "application/json": [".json"],
              "text/plain": [".txt"],
            },
          },
        ],
      });
      if (disposed || lifetime !== generation || request !== restoreRequest)
        return;
      await restoreFile(await handle.getFile(), lifetime, request);
    } catch (error) {
      if (disposed || lifetime !== generation || request !== restoreRequest)
        return;
      if (error.name === "AbortError") return;
      // Embedded browsers may expose the API but prohibit native pickers.
      input.click();
    } finally {
      if (lifetime === generation) $("restore").disabled = false;
    }
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    disposed = false;
    generation++;
    updateRecovery();
    cache = WorkTimeApp.services.backupCache.create({ source: backupSource });
    subscriptions.push(
      backupSource.subscribe((changes, reset) =>
        cache.invalidate(changes, reset),
      ),
    );
    subscriptions.push(
      WorkTimeApp.services.preferences.page.subscribe(() =>
        cache.invalidate({ preferences: true }),
      ),
    );
    events.listen(window, "worktime:gamesaved", () => cache.invalidate());
    events.listen(window, "worktime:gamearchive", () => cache.invalidate());
    events.listen(window, "storage", (event) => {
      if (
        event.key === null ||
        Object.values(WorkTimeApp.services.gameArchive.keys).includes(event.key)
      )
        cache.invalidate();
    });
    events.listen(document, "worktime:ready", () => {
      void cache.warm();
      void checkAutoBackup();
    });
    events.listen(document, "worktime:autobackupretry", () => {
      void checkAutoBackup({ retry: true });
    });
    events.handler($("exportCorruptStorage"), "onclick", exportOriginal);
    events.handler($("exportBeforeInitialize"), "onclick", exportOriginal);
    events.handler($("restoreStorage"), "onclick", chooseBackupFile);
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
      restoreRequest++;
      restoreData = null;
      restoreGames = null;
      pendingTheme = null;
    });
    events.handler($("retryRestoreTheme"), "onclick", () => {
      if (pendingTheme !== null) finishThemeRestore();
    });
    events.handler($("backupBeforeRestore"), "onclick", backup);
    events.handler($("restore"), "onclick", chooseBackupFile);
    events.handler($("backupFile"), "onchange", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await restoreFile(file, generation, ++restoreRequest);
      e.target.value = "";
    });
    events.handler($("confirmRestore"), "onclick", async () => {
      if (!restoreData || $("confirmRestore").disabled) return;
      const lifetime = generation,
        request = restoreRequest;
      const candidate = restoreData;
      const games = restoreGames;
      $("confirmRestore").disabled = true;
      let result;
      try {
        result = games
          ? await WorkTimeApp.services.gameArchive.replace(games, () =>
              application.restore(candidate),
            )
          : await application.restore(candidate);
      } catch (error) {
        result = { persisted: false, error };
      }
      if (disposed || lifetime !== generation || request !== restoreRequest)
        return;
      if (!result.persisted) {
        $("restoreError").textContent =
          WorkTimeApp.i18n.t("copy.3bf46b1e59") +
          WorkTimeApp.i18n.message(result.error.message);
        $("confirmRestore").disabled = false;
        return;
      }
      pendingTheme = candidate.preferences.pageTheme;
      restoreData = null;
      restoreGames = null;
      actions.render();
      finishThemeRestore();
    });
  }
  function dispose() {
    generation++;
    backupBusy = false;
    cache?.dispose();
    subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    $("backupBeforeRestore").disabled = false;
    $("backupBeforeRestore").removeAttribute("aria-busy");
    $("restore").disabled = false;
    events.dispose();
    bound = false;
    disposed = true;
    restoreData = null;
    restoreGames = null;
    pendingTheme = null;
  }
  const hasDraft = () =>
    restoreData !== null || pendingTheme !== null || $("initializeDialog").open;
  return { bind, dispose, hasDraft, updateRecovery, checkAutoBackup };
};
