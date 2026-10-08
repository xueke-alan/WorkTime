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
    clock,
    preferences,
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
    WorkTimeApp.services.backup.decode(text, C.validateBackup);
  function updateRecovery() {
    const issue = model.loadIssue;
    $("exportCorruptStorage").hidden =
      !model.loadCorrupt || getOriginalStorageText() === null;
    $("restoreStorage").hidden = !model.loadCorrupt;
    $("initializeStorage").hidden = issue !== "corrupt";
    $("convertStorage").hidden = issue !== "unsupported";
    $("backupBeforeRestore").querySelector(".button-label").textContent =
      model.loadCorrupt ? "下载当前页面备份" : "下载当前备份";
    $("backupScopeNote").hidden = !model.loadCorrupt;
  }
  function exportOriginal() {
    const text = getOriginalStorageText();
    if (text !== null && text !== undefined)
      download(
        "工作记录原始数据-" + model.today + ".txt",
        text,
        "text/plain;charset=utf-8",
      );
  }
  function finishThemeRestore() {
    const result = preferences.saveTheme(pendingTheme);
    if (!result.persisted) {
      $("restoreError").textContent =
        "记录已恢复，主题未保存：" + result.error.message;
      $("retryRestoreTheme").hidden = false;
      $("confirmRestore").disabled = true;
      actions.toast("记录已恢复，主题未保存，请重试", "error");
      return;
    }
    pendingTheme = null;
    $("restoreDialog").close();
    actions.toast("备份已恢复", "countdown");
  }
  function exportedState() {
    return {
      ...model.state,
      preferences: preferences.state,
      exportedAt: clock.now().toISOString(),
    };
  }
  function backup() {
    download(
      "工作记录备份-" + model.today + ".json",
      JSON.stringify(exportedState(), null, 2),
      "application/json;charset=utf-8",
    );
    actions.toast("备份已下载", "countdown");
  }
  let backupCopying = false;
  async function copyBackup() {
    const lifetime = generation;
    const button = $("backup");
    if (backupCopying) return;
    backupCopying = true;
    try {
      const raw = JSON.stringify(exportedState());
      const text = await compressBackupText(raw);
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
      actions.toast("备份已复制到剪贴板", "countdown");
    } catch (error) {
      if (disposed || lifetime !== generation) return;
      actions.toast(
        "备份复制失败：" +
          (error?.name === "NotAllowedError"
            ? "请允许剪贴板访问"
            : error?.message || "无法访问剪贴板"),
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
      "来自" +
      source +
      "的备份包含 " +
      Object.keys(data.days).length +
      " 个日期、" +
      data.imports.length +
      " 次导入、" +
      data.timeTemplates.length +
      " 个时间模板、" +
      data.scheduleRanges.length +
      " 个作息区间，基础标准日工时 " +
      C.hours(data.settings.standardMinutes) +
      " 小时。" +
      (data.preferences.pageTheme
        ? "页面主题：" +
          WorkTimeApp.domain.preferences.themes.find(
            (theme) => theme.id === data.preferences.pageTheme,
          ).name +
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
      previewRestore(decoded, "剪贴板");
      actions.toast("备份已解析，请确认恢复");
    } catch (error) {
      if (disposed || lifetime !== generation) return;
      actions.toast("剪贴板备份读取失败，请选择文件", "error");
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
    events.handler($("exportCorruptStorage"), "onclick", exportOriginal);
    events.handler($("exportBeforeInitialize"), "onclick", exportOriginal);
    events.handler($("restoreStorage"), "onclick", restoreFromClipboard);
    events.handler($("initializeStorage"), "onclick", () => {
      if (model.loadIssue !== "corrupt") return;
      $("initializeError").textContent = "";
      actions.open("initializeDialog");
    });
    events.handler($("confirmInitialize"), "onclick", () => {
      try {
        const result = application.initialize(preferences.state.pageTheme);
        if (!result.persisted) {
          $("initializeError").textContent =
            "初始化未保存：" + result.error.message;
          return;
        }
        // A fresh page clears every editor/controller draft and batch selection.
        actions.refreshSettings();
        window.location.reload();
      } catch (error) {
        $("initializeError").textContent = error.message;
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
        if (f.size > BACKUP_MAX_BYTES) throw Error("备份超过 30MB。");
        const decoded = await readBackupText(await f.text());
        if (disposed || lifetime !== generation) return;
        previewRestore(decoded, "文件");
        actions.toast("备份已解析，请确认恢复");
      } catch (err) {
        if (disposed || lifetime !== generation) return;
        actions.toast("恢复失败：" + err.message, "error");
      }
      e.target.value = "";
    });
    events.handler($("confirmRestore"), "onclick", () => {
      if (!restoreData) return;
      const result = application.restore(restoreData);
      if (!result.persisted) {
        $("restoreError").textContent = "恢复未保存：" + result.error.message;
        return;
      }
      pendingTheme = restoreData.preferences.pageTheme;
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
