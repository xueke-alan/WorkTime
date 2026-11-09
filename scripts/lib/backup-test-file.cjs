/** Archive-content tests use a scoped output sink; directory I/O has its own suite. */
async function downloadBackup(page, variable) {
  await page.waitForFunction(
    () => !document.getElementById("backupBeforeRestore").disabled,
  );
  await page.evaluate(() => {
    window.archiveTestWrite = WorkTimeApp.services.autoBackupFolder.write;
    window.archiveTestOutput = null;
    WorkTimeApp.services.autoBackupFolder.write = async (
      name,
      text,
      { kind },
    ) => {
      if (kind !== "manual")
        return window.archiveTestWrite(name, text, { kind });
      window.archiveTestOutput = text;
      return true;
    };
  });
  let text;
  try {
    await page.evaluate(() =>
      document.getElementById("backupBeforeRestore").click(),
    );
    await page.waitForFunction(() => window.archiveTestOutput !== null);
    await page.waitForFunction(
      () => !document.getElementById("backupBeforeRestore").disabled,
    );
    text = await page.evaluate(() => window.archiveTestOutput);
  } finally {
    await page.evaluate(() => {
      WorkTimeApp.services.autoBackupFolder.write = window.archiveTestWrite;
      delete window.archiveTestWrite;
      delete window.archiveTestOutput;
    });
  }
  if (variable)
    await page.evaluate(
      ({ variable, text }) => {
        window[variable] = text;
      },
      { variable, text },
    );
  return text;
}
async function importBackupFile(page, text) {
  await page.locator("#backupFile").setInputFiles({
    name: "backup.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
}
module.exports = { downloadBackup, importBackupFile };

/** Observe successful real directory writes, including writes across reloads. */
async function observeBackupWrites(page) {
  const writes = [],
    waiters = [];
  await page.exposeBinding("recordBackupWrite", (_, value) => {
    writes.push(value);
    waiters.shift()?.(value);
  });
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle(
        "backup-fixture",
        { create: true },
      );
    FileSystemDirectoryHandle.prototype.queryPermission = async () => "granted";
    FileSystemDirectoryHandle.prototype.requestPermission = async () =>
      "granted";
    localStorage.setItem("worktime.onboarding.v1", "dismissed");
    document.addEventListener(
      "worktime:ready",
      async () => {
        const runtime = WorkTimeApp.services.runtimeFolder;
        const write = runtime.write;
        runtime.write = async (...args) => {
          const result = await write(...args);
          await window.recordBackupWrite({
            name: args[0],
            text: args[1],
            kind: args[2].kind,
          });
          return result;
        };
        await runtime.initialize();
        if (runtime.state.status !== "available") await runtime.choose();
        document
          .querySelector("#onboardingDialog [data-onboarding-next]")
          ?.click();
        while (document.getElementById("backupBeforeRestore").disabled)
          await new Promise((resolve) => setTimeout(resolve, 10));
        document.dispatchEvent(new Event("worktime:autobackupretry"));
      },
      { once: true },
    );
  });
  return {
    writes,
    next: () => new Promise((resolve) => waiters.push(resolve)),
  };
}
module.exports.observeBackupWrites = observeBackupWrites;
