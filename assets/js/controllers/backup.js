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
    WorkTimeApp.services.preferences.page.synchronize();
    pendingTheme = null;
    $("restoreDialog").close();
    actions.toast("备份已恢复", "countdown");
  }
  async function backup() {
    try {
      download(
        "工作记录备份-" + model.today + ".json",
        JSON.stringify(await exportArchive(), null, 2),
        "application/json;charset=utf-8",
      );
      actions.toast("备份已下载", "countdown");
    } catch (error) {
      actions.toast("备份失败：" + error.message, "error");
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
    events.handler($("recoveryOpen"), "onclick", async () => {
      try {
        const rows = await persistence.snapshots();
        const list = $("snapshotList");
        list.replaceChildren();
        for (const row of rows) {
          const button = document.createElement("button");
          button.className = "ui-button";
          button.textContent =
            (row.type === "daily" ? "日常快照 " : "操作前快照 ") +
            new Date(row.at).toLocaleString("zh-CN");
          button.onclick = () => {
            try {
              const data = WorkTimeApp.services.archive.migrate(row.document);
              $("recoveryDialog").close();
              previewRestore(data, "历史快照");
            } catch (error) {
              $("recoveryError").textContent =
                "此快照无法直接恢复，请下载恢复资料保留原文：" + error.message;
            }
          };
          list.append(button);
        }
        if (!rows.length) list.textContent = "暂无历史快照。";
        $("recoveryError").textContent = "";
        actions.open("recoveryDialog");
      } catch (error) {
        actions.toast("恢复资料读取失败：" + error.message, "error");
      }
    });
    events.handler($("downloadRecovery"), "onclick", async () => {
      try {
        download(
          "工作记录恢复资料-" + model.today + ".json",
          JSON.stringify(await persistence.recoveryData(), null, 2),
          "application/json;charset=utf-8",
        );
      } catch (error) {
        $("recoveryError").textContent = error.message;
      }
    });
    events.handler($("clearSnapshots"), "onclick", () =>
      actions.open("clearSnapshotsDialog"),
    );
    events.handler($("confirmClearSnapshots"), "onclick", async () => {
      try {
        await persistence.clearSnapshots();
        $("clearSnapshotsDialog").close();
        $("snapshotList").textContent = "暂无历史快照。";
      } catch (error) {
        actions.toast("快照清理失败：" + error.message, "error");
      }
    });
    events.handler($("restoreLegacy"), "onclick", async () => {
      try {
        const data = await persistence.recoveryData();
        if (!data.legacyText) throw Error("没有可读取的旧存档。");
        previewRestore(
          WorkTimeApp.services.archive.migrate(JSON.parse(data.legacyText)),
          "遗留旧存档",
        );
        $("recoveryDialog").close();
      } catch (error) {
        $("recoveryError").textContent = error.message;
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
        if (f.size > BACKUP_MAX_BYTES) throw Error("备份超过 100 MiB。");
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
        $("restoreError").textContent = "恢复未保存：" + result.error.message;
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
