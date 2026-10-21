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
    if (file.size > WorkTimeApp.services.backup.MAX_BYTES) {
      element("status").textContent = WorkTimeApp.i18n.t("copy.9e4f8963f1");
      return;
    }
    try {
      const text = await file.text();
      if (!disposed && request === generation)
        element("backupInput").value = text;
    } catch (error) {
      if (!disposed && request === generation)
        element("status").textContent = WorkTimeApp.i18n.message(error.message);
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
      element("status").textContent = WorkTimeApp.i18n.t("converter.success", {
        count: result.modules.length,
      });
    } catch (error) {
      if (!disposed && request === generation)
        element("status").textContent =
          WorkTimeApp.i18n.t("copy.5793742753") +
          WorkTimeApp.i18n.message(error.message);
    }
  });
  element("download").addEventListener("click", () => {
    if (disposed || element("download").disabled) return;
    downloads.download(
      WorkTimeApp.i18n.t("copy.7a6b07d795"),
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
