"use strict";
/** backup controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createBackupController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const {
    core: C,
    element: $,
    application,
    originalStorageText,
    model,
    actions,
    clipboard,
    downloads,
    clock,
    preferences,
  } = options;
  let restoreData = null;
  let disposed = false;
  let generation = 0;
  const download = downloads.download;
  let copyResetTimer = null,
    holdAction = null;
  const BACKUP_MAX_BYTES = WorkTimeApp.services.backup.MAX_BYTES;
  const compressBackupText = WorkTimeApp.services.backup.encode;
  const readBackupText = (text) =>
    WorkTimeApp.services.backup.decode(text, C.validateBackup);
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
      actions.toast("剪贴板备份解析成功，请确认恢复");
    } catch (error) {
      if (disposed || lifetime !== generation) return;
      actions.toast("剪贴板读取或解析失败，请选择备份文件", "error");
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
    if (model.loadCorrupt && originalStorageText !== null) {
      const body = $("storageNotice").querySelector(".notification-body"),
        exportOriginal =
          body.querySelector("#exportCorruptStorage") ||
          document.createElement("button");
      exportOriginal.className = "ui-button";
      exportOriginal.id = "exportCorruptStorage";
      exportOriginal.type = "button";
      exportOriginal.innerHTML =
        '<span class="button-label">导出无法读取的原始数据</span>';
      events.handler(exportOriginal, "onclick", () =>
        download(
          "工作记录原始数据-" + model.today + ".txt",
          originalStorageText,
          "text/plain;charset=utf-8",
        ),
      );
      if (!exportOriginal.parentElement) body.append(exportOriginal);
    }
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
        actions.toast("备份文件解析成功，请确认恢复");
      } catch (err) {
        if (disposed || lifetime !== generation) return;
        actions.toast("恢复失败：" + err.message, "error");
      }
      e.target.value = "";
    });
    events.handler($("confirmRestore"), "onclick", () => {
      if (!restoreData) return;
      const saved = application.restore(restoreData).persisted;
      restoreData = null;
      const themeSaved = preferences.saveTheme(
        model.state.preferences.pageTheme,
      ).persisted;
      $("restoreDialog").close();
      actions.render();
      actions.toast(
        saved && themeSaved
          ? "备份已恢复"
          : "备份已读取，但未能完整保存，请查看信息与提醒",
        saved && themeSaved ? "countdown" : "error",
      );
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
    holdAction?.dispose();
    clearTimeout(copyResetTimer);
  }
  const hasDraft = () => restoreData !== null;
  return { bind, dispose, hasDraft };
};
