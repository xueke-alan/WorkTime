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
    usageGeneration = 0,
    retryButton = null,
    recoveryOptions = null;
  function updateRecovery() {
    if (!retryButton || !recoveryOptions) return;
    const issue = recoveryOptions.getLoadIssue?.();
    retryButton.hidden =
      !recoveryOptions.available ||
      (recoveryOptions.getLoadIssue
        ? issue === "corrupt" || issue === "unsupported"
        : recoveryOptions.corrupt);
  }
  function updateUsage() {
    const requestVersion = ++usageGeneration;
    if (typeof window.navigator.storage?.estimate !== "function") {
      $("storageUsage").textContent = "当前占用：浏览器不提供估算";
      return;
    }
    void window.navigator.storage
      .estimate()
      .then(({ usage: bytes }) => {
        if (requestVersion !== usageGeneration) return;
        const size =
          bytes < 1024
            ? bytes + " B"
            : bytes < 1024 * 1024
              ? (bytes / 1024).toFixed(2) + " KB"
              : (bytes / (1024 * 1024)).toFixed(2) + " MB";
        $("storageUsage").textContent = "浏览器存储估算：" + size;
      })
      .catch(() => {
        if (requestVersion !== usageGeneration) return;
        $("storageUsage").textContent = "当前占用：无法读取";
      });
  }
  function storageChanged(event) {
    if (event.key === key || event.key === null) updateUsage();
  }
  function mount({
    readError = null,
    accessError = null,
    loadIssue = null,
  } = {}) {
    if (mounted) return;
    mounted = true;
    updateUsage();
    if (readError)
      $("storageNoticeText").textContent =
        "浏览器数据无法读取：" +
        readError.message +
        (loadIssue === "unavailable"
          ? "。请允许浏览器存储访问后重新检查；当前页面显示临时数据。"
          : loadIssue === "unsupported"
            ? "。请使用支持此存档版本的新版本应用；可先导出原始数据。"
            : loadIssue === null
              ? "。已保留当前存档，可导出恢复资料并选择恢复。"
              : "。当前页面显示临时默认数据；可导出原始数据、恢复有效备份或初始化存档。");
    else if (accessError)
      $("storageNoticeText").textContent =
        "当前页面无法保存：" + accessError.message + "。";
    window.addEventListener("storage", storageChanged);
  }
  return {
    saving() {
      usageGeneration++;
      $("storageUsage").textContent = "正在保存…";
    },
    externalUpdate() {
      $("storageNotice").classList.remove("hidden");
      $("storageNoticeText").textContent =
        "其他页面已更新存档，请保留本页草稿并重新检查。";
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
