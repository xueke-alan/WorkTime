"use strict";
(() => {
  const element = (id) => document.getElementById(id);
  let generation = 0,
    disposed = false;
  const downloads = WorkTimeApp.services.downloads.create({
    document,
    URL,
    Blob,
  });
  function reset() {
    generation++;
    element("backupOutput").value = "";
    element("download").disabled = true;
    element("status").textContent = "";
  }
  element("backupInput").addEventListener("input", reset);
  element("backupInputFile").addEventListener("change", async (event) => {
    reset();
    const file = event.target.files[0],
      request = generation;
    if (!file) return;
    if (file.size > WorkTimeApp.services.backup.MAX_BYTES * 1.4) {
      element("status").textContent = "文件超过备份大小限制。";
      return;
    }
    try {
      const text = await file.text();
      if (!disposed && request === generation)
        element("backupInput").value = text;
    } catch (error) {
      if (!disposed && request === generation)
        element("status").textContent = error.message;
    }
  });
  element("convert").addEventListener("click", async () => {
    reset();
    const request = generation;
    try {
      const result = await WorkTimeApp.services.backup.decode(
        element("backupInput").value,
        WorkBackupConversion.convert,
      );
      if (disposed || request !== generation) return;
      element("backupOutput").value = JSON.stringify(result, null, 2);
      element("download").disabled = false;
      element("status").textContent =
        `转换成功：${Object.keys(result.days).length} 个日期，${result.imports.length} 次导入，${result.scheduleRanges.length} 个排班区间。`;
    } catch (error) {
      if (!disposed && request === generation)
        element("status").textContent = "转换失败：" + error.message;
    }
  });
  element("download").addEventListener("click", () => {
    if (disposed || element("download").disabled) return;
    downloads.download(
      "工作记录备份-v3.json",
      element("backupOutput").value,
      "application/json;charset=utf-8",
    );
  });
  addEventListener(
    "pagehide",
    () => {
      disposed = true;
      generation++;
      downloads.dispose();
    },
    { once: true },
  );
})();
