"use strict";
/** Own storage usage and failure text; never reads or modifies business state. */
WorkTimeApp.ui.createStorageStatus = function ({
  element: $,
  key,
  getStorage,
  window,
}) {
  let mounted = false,
    generation = 0,
    retryButton = null;
  function updateUsage() {
    try {
      const text = getStorage().getItem(key),
        bytes = text === null ? 0 : (key.length + text.length) * 2;
      const size =
        bytes < 1024
          ? bytes + " B"
          : bytes < 1024 * 1024
            ? (bytes / 1024).toFixed(2) + " KB"
            : (bytes / (1024 * 1024)).toFixed(2) + " MB";
      $("storageUsage").textContent = "当前占用：" + size;
    } catch {
      $("storageUsage").textContent = "当前占用：无法读取";
    }
  }
  function storageChanged(event) {
    if (event.key === key || event.key === null) updateUsage();
  }
  function mount({ readError = null, accessError = null } = {}) {
    if (mounted) return;
    mounted = true;
    updateUsage();
    if (readError)
      $("storageNoticeText").textContent =
        "浏览器数据无法读取：" +
        readError.message +
        "。当前数据尚未保存，请先下载备份或恢复有效备份。";
    else if (accessError)
      $("storageNoticeText").textContent =
        "当前页面无法保存：" + accessError.message + "。";
    window.addEventListener("storage", storageChanged);
  }
  return {
    mount,
    bindRetry({ available, corrupt, retry }) {
      retryButton = $("retryStorage");
      retryButton.hidden = corrupt || !available;
      retryButton.onclick = async () => {
        const lifetime = generation,
          button = retryButton;
        button.disabled = true;
        await retry();
        if (mounted && lifetime === generation) button.disabled = false;
      };
    },
    commit(result, failed) {
      updateUsage();
      $("storageNotice").classList.toggle("hidden", !failed);
      if (!result.persisted)
        $("storageNoticeText").textContent =
          "更改未保存：" + result.error.message + "；关闭页面前请备份。";
    },
    recoveryFailed(error) {
      $("storageNoticeText").textContent =
        "重新检查失败：" + error.message + "；当前修改仍保留。";
    },
    accessFailed(error) {
      $("storageNoticeText").textContent =
        "重新检查结果：" +
        error.message +
        (error.code === "LOCK_BUSY"
          ? "。浏览器仍检测到占用保存权限的页面，可能位于后台。"
          : "。当前修改仍保留。");
    },
    dispose() {
      if (!mounted) return;
      mounted = false;
      generation++;
      if (retryButton) retryButton.onclick = null;
      retryButton = null;
      window.removeEventListener("storage", storageChanged);
    },
  };
};
