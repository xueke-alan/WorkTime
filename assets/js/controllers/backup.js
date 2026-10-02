"use strict";
/** backup controller. Instantiate once, then bind after all actions are connected. */
WorkUI.createBackupController = function (options) {
  const {
    core: C,
    element: $,
    persistence,
    model,
    actions,
    clipboard,
    downloads,
    clock,
  } = options;
  let restoreData = null;
  let disposed = false;
  const download = downloads.download;
  let backupFinishTimer = null,
    copyResetTimer = null;
  const BACKUP_MAX_BYTES = WorkBackup.MAX_BYTES;
  const compressBackupText = WorkBackup.encode;
  const readBackupText = (text) => WorkBackup.decode(text, C.validateBackup);
  function backup() {
    download(
      "工作记录备份-" + model.today + ".json",
      JSON.stringify(
        { ...model.state, exportedAt: clock.now().toISOString() },
        null,
        2,
      ),
      "application/json;charset=utf-8",
    );
    actions.toast("备份已下载", "countdown");
  }
  let backupCopying = false;
  async function copyBackup() {
    const button = $("backup");
    if (backupCopying) return;
    backupCopying = true;
    try {
      const raw = JSON.stringify({
        ...model.state,
        exportedAt: clock.now().toISOString(),
      });
      const text = await compressBackupText(raw);
      if (disposed) return;
      await clipboard.writeText(text);
      if (disposed) return;
      button.classList.remove("is-copying");
      void button.offsetWidth;
      button.classList.add("is-copying");
      copyResetTimer = setTimeout(
        () => button.classList.remove("is-copying"),
        450,
      );
      actions.toast("备份已复制到剪贴板", "countdown");
    } catch (error) {
      if (disposed) return;
      actions.toast(
        "备份复制失败：" +
          (error?.name === "NotAllowedError"
            ? "请允许剪贴板访问"
            : error?.message || "无法访问剪贴板"),
        "error",
      );
    } finally {
      backupCopying = false;
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
      " 个时间模板，标准日工时 " +
      C.hours(data.settings.standardMinutes) +
      " 小时。";
    actions.open("restoreDialog");
  }
  async function restoreFromClipboard() {
    const button = $("restore");
    if (button.disabled) return;
    button.disabled = true;
    restoreData = null;
    try {
      const text = await clipboard.readText();
      const decoded = await readBackupText(text);
      if (disposed) return;
      previewRestore(decoded, "剪贴板");
      actions.toast("剪贴板备份解析成功，请确认恢复");
    } catch (error) {
      if (disposed) return;
      actions.toast("剪贴板读取或解析失败，请选择备份文件", "error");
      $("backupFile").click();
    } finally {
      button.disabled = false;
    }
  }
  const backupButton = $("backup");
  let backupHoldTimer = null,
    backupRingTimer = null,
    backupHolding = false,
    backupCompleting = false,
    backupResetAnimation = null,
    backupHeld = false;
  function endBackupHold() {
    clearTimeout(backupHoldTimer);
    clearTimeout(backupRingTimer);
    backupHoldTimer = null;
    backupRingTimer = null;
    const wasHolding = backupHolding;
    backupHolding = false;
    if (backupCompleting || !wasHolding) return;
    if (!backupButton.classList.contains("is-holding")) return;
    const ring = backupButton.querySelector(".hold-progress"),
      offset = getComputedStyle(ring).strokeDashoffset;
    backupButton.classList.remove("is-holding");
    backupButton.classList.add("is-resetting");
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 300;
    backupResetAnimation = ring.animate(
      [{ strokeDashoffset: offset }, { strokeDashoffset: "100" }],
      { duration, easing: "ease-out", fill: "forwards" },
    );
    const animation = backupResetAnimation;
    animation.finished
      .then(() => {
        if (backupResetAnimation !== animation) return;
        backupButton.classList.remove("is-resetting");
        animation.cancel();
        backupResetAnimation = null;
      })
      .catch(() => {});
  }
  function startBackupHold() {
    if (backupHolding || backupCompleting || backupButton.disabled) return;
    backupHeld = false;
    backupResetAnimation?.cancel();
    backupResetAnimation = null;
    backupButton.classList.remove("is-resetting");
    backupHolding = true;
    backupRingTimer = setTimeout(() => {
      if (backupHolding) backupButton.classList.add("is-holding");
    }, 200);
    backupHoldTimer = setTimeout(() => {
      backupHeld = true;
      backupCompleting = true;
      endBackupHold();
      backupButton.classList.add("is-completing");
      backupFinishTimer = setTimeout(() => {
        backupButton.classList.remove("is-holding", "is-completing");
        backupCompleting = false;
        backup();
      }, 450);
    }, 2000);
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    if (model.loadCorrupt && persistence.originalText !== null) {
      const exportOriginal = document.createElement("button");
      exportOriginal.id = "exportCorruptStorage";
      exportOriginal.type = "button";
      exportOriginal.textContent = "导出无法读取的原始数据";
      exportOriginal.onclick = () =>
        download(
          "工作记录原始数据-" + model.today + ".txt",
          persistence.originalText,
          "text/plain;charset=utf-8",
        );
      $("storageNotice")
        .querySelector(".notification-body")
        .append(exportOriginal);
    }
    backupButton.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      backupButton.setPointerCapture(event.pointerId);
      startBackupHold();
    });
    backupButton.addEventListener("pointermove", (event) => {
      if (!backupHolding) return;
      const r = backupButton.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      ) {
        backupHeld = true;
        endBackupHold();
      }
    });
    ["pointerup", "pointercancel", "lostpointercapture", "blur"].forEach(
      (type) => backupButton.addEventListener(type, endBackupHold),
    );
    backupButton.addEventListener("contextmenu", (event) =>
      event.preventDefault(),
    );
    backupButton.addEventListener("keydown", (event) => {
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        if (!event.repeat) startBackupHold();
      }
      if (event.key === "Escape") endBackupHold();
    });
    backupButton.addEventListener("keyup", (event) => {
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        endBackupHold();
        backupButton.click();
      }
    });
    backupButton.onclick = (event) => {
      event.preventDefault();
      if (backupCompleting || backupHeld) {
        backupHeld = false;
        return;
      }
      copyBackup();
    };
    $("backupBeforeRestore").onclick = backup;
    $("restore").onclick = restoreFromClipboard;
    $("backupFile").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      restoreData = null;
      try {
        if (f.size > BACKUP_MAX_BYTES) throw Error("备份超过 30MB。");
        const decoded = await readBackupText(await f.text());
        if (disposed) return;
        previewRestore(decoded, "文件");
        actions.toast("备份文件解析成功，请确认恢复");
      } catch (err) {
        if (disposed) return;
        actions.toast("恢复失败：" + err.message, "error");
      }
      e.target.value = "";
    };
    $("confirmRestore").onclick = () => {
      if (!restoreData) return;
      model.state = restoreData;
      model.state.scheduleDefaultsVersion = 1;
      restoreData = null;
      model.loadCorrupt = false;
      persistence.allowValidatedRestore();
      const saved = actions.save();
      $("restoreDialog").close();
      actions.render();
      actions.toast(
        saved ? "备份已恢复" : "备份已读取，但未能保存，请查看信息与提醒",
        saved ? "countdown" : "error",
      );
    };
  }
  function dispose() {
    disposed = true;
    restoreData = null;
    clearTimeout(backupFinishTimer);
    clearTimeout(copyResetTimer);
    clearTimeout(backupHoldTimer);
    clearTimeout(backupRingTimer);
    backupResetAnimation?.cancel();
  }
  return { bind, dispose };
};
