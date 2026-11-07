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
    backupSource,
  } = options;
  let restoreData = null;
  let restoreGames = null;
  let pendingTheme = null;
  let disposed = false;
  let generation = 0;
  const download = downloads.download;
  let copyResetTimer = null,
    holdAction = null;
  const BACKUP_MAX_BYTES = WorkTimeApp.services.backup.MAX_BYTES;
  const FULL_FORMAT = "worktime-full-backup";
  let cache = null,
    backupBusy = false;
  const subscriptions = [];
  async function exportBackup() {
    await actions.prepareAgendaArchive();
    await WorkTimeApp.games.prepareArchive();
    return cache.capture();
  }
  function beginBackup() {
    if (backupBusy || disposed) return false;
    backupBusy = true;
    $("backup").disabled = true;
    $("backup").setAttribute("aria-busy", "true");
    actions.toast(WorkTimeApp.i18n.t("backup.preparing"), "countdown");
    return true;
  }
  function endBackup(lifetime) {
    if (lifetime !== generation) return;
    backupBusy = false;
    $("backup").disabled = false;
    $("backup").removeAttribute("aria-busy");
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
      await WorkTimeApp.games.prepareArchive();
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
      const written = automatic === true && (await folder.write(name, text));
      if (!written) download(name, text, "text/plain;charset=utf-8");
      if (written)
        await WorkTimeApp.ui.loadAutoBackupFolderSettings().catch(() => {});
      actions.toast(
        written
          ? WorkTimeApp.ui.autoBackupFolderText?.("saved") || name
          : WorkTimeApp.i18n.t("copy.5091362c8b"),
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
      if (error.folderCode)
        await WorkTimeApp.ui.loadAutoBackupFolderSettings().catch(() => {});
      actions.toast(
        WorkTimeApp.i18n.t("copy.d09d00bfdf") +
          (error.folderCode
            ? WorkTimeApp.ui.autoBackupFolderText?.(error.folderCode) ||
              error.message
            : WorkTimeApp.i18n.message(error.message)),
        "error",
      );
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
  async function copyBackup() {
    const lifetime = generation;
    const button = $("backup");
    if (!beginBackup()) return;
    try {
      const text = await exportBackup();
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
      endBackup(lifetime);
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
  async function restoreFromClipboard() {
    const lifetime = generation;
    const button = $("restore");
    if (button.disabled) return;
    button.disabled = true;
    restoreData = null;
    restoreGames = null;
    try {
      const text = await clipboard.readText();
      if (disposed || lifetime !== generation) return;
      const decoded = await readBackupText(text);
      if (disposed || lifetime !== generation) return;
      previewRestore(
        decoded.work,
        WorkTimeApp.i18n.t("copy.c4eb94d079"),
        decoded.games,
      );
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
      restoreGames = null;
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
      restoreGames = null;
      try {
        if (f.size > BACKUP_MAX_BYTES)
          throw Error(WorkTimeApp.i18n.t("copy.c3b5086f19"));
        const decoded = await readBackupText(await f.text());
        if (disposed || lifetime !== generation) return;
        previewRestore(
          decoded.work,
          WorkTimeApp.i18n.t("copy.49deaf7da2"),
          decoded.games,
        );
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
    $("backup").disabled = false;
    $("backup").removeAttribute("aria-busy");
    $("restore").disabled = false;
    events.dispose();
    bound = false;
    disposed = true;
    restoreData = null;
    restoreGames = null;
    pendingTheme = null;
    holdAction?.dispose();
    clearTimeout(copyResetTimer);
  }
  const hasDraft = () =>
    restoreData !== null || pendingTheme !== null || $("initializeDialog").open;
  return { bind, dispose, hasDraft, updateRecovery, checkAutoBackup };
};
