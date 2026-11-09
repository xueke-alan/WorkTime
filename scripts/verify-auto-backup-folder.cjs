"use strict";
/** Real IndexedDB and OPFS handles; only picker/permissions/failures are simulated. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { clickSettingsControl } = require("./settings-test-helpers.cjs");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
async function main() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(
      root,
      "." + new URL(req.url, "http://localhost").pathname,
    );
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({
      locale: "zh-CN",
      acceptDownloads: true,
    });
    await context.addInitScript(() => {
      localStorage.setItem("worktime.onboarding.v1", "dismissed");
      window.folderTest = {
        permission: "granted",
        failWrite: false,
        failSave: false,
        cancel: false,
        folder: "archive-A",
      };
      window.showDirectoryPicker = async () => {
        if (window.folderTest.cancel)
          throw new DOMException("Cancelled", "AbortError");
        if (!navigator.userActivation.isActive)
          throw Error("Picker lost click gesture");
        return (await navigator.storage.getDirectory()).getDirectoryHandle(
          window.folderTest.folder,
          { create: true },
        );
      };
      FileSystemDirectoryHandle.prototype.queryPermission = async () =>
        window.folderTest.permission;
      FileSystemDirectoryHandle.prototype.requestPermission = async () => {
        if (!navigator.userActivation.isActive)
          throw Error("Permission lost click gesture");
        window.folderTest.permission = "granted";
        return "granted";
      };
      const create = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = function (...args) {
        if (window.folderTest.failWrite)
          throw new DOMException("Disk unavailable", "NotFoundError");
        return create.apply(this, args);
      };
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, ...args) {
        if (
          name === "worktime-backup-folder" &&
          localStorage.getItem("folder-read-fail")
        )
          throw Error("Test: folder settings cannot be read");
        return open.call(this, name, ...args);
      };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (
          this.transaction.db.name === "worktime-backup-folder" &&
          window.folderTest.failSave
        )
          throw new DOMException("Full", "QuotaExceededError");
        return put.apply(this, args);
      };
    });
    const page = await context.newPage();
    const errors = [],
      downloads = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("download", (download) => downloads.push(download));
    await page.route(/https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const ready = () =>
      page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          WorkTimeApp.services.autoBackupFolder.state.status !== "loading",
      );
    const saved = () =>
      page.waitForFunction(
        () =>
          WorkTimeApp.services.preferences.page.state.lastAutoBackupDate ===
            WorkTimeApp.domain.time.businessDate(new Date()) &&
          !WorkTimeApp.services.preferences.page.dirty,
      );
    const due = () =>
      page.evaluate(() =>
        WorkTimeApp.services.preferences.page.saveAutoBackupDate("2020-01-01"),
      );
    const status = (value) =>
      page.waitForFunction(
        (value) =>
          WorkTimeApp.services.autoBackupFolder.state.status === value &&
          !WorkTimeApp.services.autoBackupFolder.state.busy,
        value,
      );
    const files = () =>
      page.evaluate(async () => {
        const dir = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle("archive-A");
        const backupDir = await dir.getDirectoryHandle("backups");
        const result = [];
        async function collect(directory, prefix = "") {
          for await (const [name, file] of directory.entries()) {
            if (file.kind === "directory")
              await collect(file, prefix + name + "/");
            else if (name.endsWith(".txt"))
              result.push({
                name: prefix + name,
                text: await (await file.getFile()).text(),
              });
          }
        }
        await collect(backupDir);
        return result;
      });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await ready();
    await page.locator("#onboardingDialog[open]").waitFor();
    assert.equal(downloads.length, 0, "missing root never downloads");
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.preferences.page.state.lastAutoBackupDate,
      ),
      null,
    );
    await page.locator(".onboarding-folder-button").click();
    await saved();
    await page.locator("[data-onboarding-next]").click();
    await clickSettingsControl(page, "#pageSettingsOpen");
    await page.locator("#autoBackupFolderChoose").waitFor({ state: "visible" });
    const layout = await page.evaluate(() => {
      const frequency = document
        .querySelector("#autoBackupTrigger")
        .getBoundingClientRect();
      const folder = document
        .querySelector(".auto-backup-folder-control")
        .getBoundingClientRect();
      return {
        topDifference: Math.abs(frequency.top - folder.top),
        ratio: folder.width / frequency.width,
      };
    });
    assert.ok(
      layout.topDifference < 1,
      "frequency and folder must share a row",
    );
    assert.ok(
      Math.abs(layout.ratio - 1.5) < 0.03,
      "frequency/folder widths must keep the 2:3 ratio",
    );
    assert.equal(downloads.length, 0, "folder archive must not download");
    assert.equal(
      await page.locator("#autoBackupFolderLabel").innerText(),
      await page.evaluate(() => WorkTimeApp.ui.autoBackupFolderText("label")),
    );
    assert.equal(await page.locator("#autoBackupFolderReset").count(), 0);
    assert.equal(
      await page
        .locator("#autoBackupFolderChoose")
        .evaluate((element) => getComputedStyle(element).textAlign),
      "left",
    );
    const innerStyles = await page
      .locator(".auto-backup-folder-action")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element);
          return {
            border: style.borderTopWidth,
            radius: style.borderTopLeftRadius,
            shadow: style.boxShadow,
          };
        }),
      );
    assert.ok(
      innerStyles.every(
        (style) =>
          style.border === "0px" &&
          style.radius === "0px" &&
          style.shadow === "none",
      ),
      "inner actions must not draw a second button frame",
    );
    await page.locator(".auto-backup-settings").screenshot({
      path: path.join(root, "test-results", "auto-backup-folder-control.png"),
    });
    let archived = await files();
    assert.equal(archived.length, 1);
    assert.ok(archived[0].text.length > 100);
    await page.evaluate(
      (text) =>
        WorkTimeApp.services.backup.decode(text, (value) => {
          if (value.format !== "worktime-full-backup")
            throw Error("Unexpected format");
          WorkTimeApp.services.archive.migrate(value.work);
          return true;
        }),
      archived[0].text,
    );
    await page.reload();
    await ready();
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.autoBackupFolder.state.name,
      ),
      "archive-A",
      "directory persists through real IndexedDB",
    );
    if (await page.locator("#onboardingDialog[open]").count())
      await page.locator("[data-onboarding-next]").click();
    await clickSettingsControl(page, "#pageSettingsOpen");
    await page.evaluate(() => {
      window.folderTest.cancel = true;
    });
    await page.locator("#autoBackupFolderChoose").click();
    await page.locator("#runtimeFolderChange [data-select]").click();
    await page.locator("#runtimeFolderChange [data-close]").click();
    await status("available");
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.autoBackupFolder.state.name,
      ),
      "archive-A",
    );
    await page.evaluate(() => {
      window.folderTest.cancel = false;
      window.folderTest.permission = "prompt";
    });
    await due();
    await page.evaluate(() =>
      document.dispatchEvent(new Event("worktime:autobackupretry")),
    );
    await status("permission");
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.preferences.page.state.lastAutoBackupDate,
      ),
      "2020-01-01",
    );
    await page.locator("#runtimeFolderRecovery[open] button").click();
    await saved();
    archived = await files();
    assert.equal(archived.length, 2);
    assert.equal(
      new Set(archived.map((file) => file.name)).size,
      2,
      "backups never overwrite",
    );
    const previousTime = await page.evaluate(
      () => WorkTimeApp.services.preferences.page.state.lastBackupAt,
    );
    await due();
    await page.evaluate(() => {
      window.folderTest.failWrite = true;
      document.dispatchEvent(new Event("worktime:autobackupretry"));
    });
    await status("failed");
    assert.equal(
      downloads.length,
      0,
      "write failure must not fall back to downloads",
    );
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.preferences.page.state.lastBackupAt,
      ),
      previousTime,
    );
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.preferences.page.state.lastAutoBackupDate,
      ),
      "2020-01-01",
    );
    await page.evaluate(() => {
      window.folderTest.failWrite = false;
    });
    await page.locator("#autoBackupFolderRetry").click();
    await saved();
    assert.ok(
      (await files()).every((file) => file.name.startsWith("automatic/")),
    );
    await page.evaluate(() =>
      document.getElementById("backupBeforeRestore").click(),
    );
    await page.waitForFunction(
      () => !document.querySelector("#backupBeforeRestore").disabled,
    );
    assert.equal(downloads.length, 0);
    assert.equal(
      (await files()).filter((file) => file.name.startsWith("manual/")).length,
      1,
    );
    await page.evaluate(() => {
      window.folderTest.failSave = true;
      window.folderTest.folder = "archive-B";
    });
    await page.locator("#autoBackupFolderChoose").click();
    await page.locator("#runtimeFolderChange [data-select]").click();
    await page.locator("#runtimeFolderChange [data-submit]").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#runtimeFolderChange [data-status]")
        .textContent.includes("仍使用原文件夹"),
    );
    await status("available");
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.autoBackupFolder.state.name,
      ),
      "archive-A",
      "save failure preserves previous folder",
    );
    await page.evaluate(() => {
      window.folderTest.failSave = false;
    });
    await page.locator("#runtimeFolderChange [data-submit]").click();
    await page.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder.state.name === "archive-B",
    );
    await page.locator("#runtimeFolderChange [data-close]").click();
    await status("available");
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.autoBackupFolder.state.name,
      ),
      "archive-B",
    );
    await due();
    await page.evaluate(async () => {
      const runtime = WorkTimeApp.services.runtimeFolder;
      const root = await navigator.storage.getDirectory();
      const source = await root.getDirectoryHandle("archive-B");
      const selected = await root.getDirectoryHandle("archive-C", {
        create: true,
      });
      const script = WorkTimeApp.services.assets.script;
      let entered;
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      WorkTimeApp.services.assets.script = async (src) => {
        await script(src);
        if (src === "assets/js/services/runtime-migration.js") {
          entered();
          await new Promise((resolve) => {
            window.releaseMigration = resolve;
          });
        }
      };
      window.pendingMigration = runtime
        .changeFolder({ source, selected })
        .finally(() => {
          WorkTimeApp.services.assets.script = script;
        });
      await started;
      document.dispatchEvent(new Event("worktime:autobackupretry"));
    });
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.preferences.page.state.lastAutoBackupDate,
      ),
      "2020-01-01",
      "automatic backup must wait for migration",
    );
    await page.evaluate(async () => {
      window.releaseMigration();
      await window.pendingMigration;
    });
    await saved();
    assert.equal(
      await page.evaluate(() => WorkTimeApp.services.runtimeFolder.state.name),
      "archive-C",
    );
    // Unsupported environments explain the limitation without a download route.
    await page.evaluate(() => {
      window.showDirectoryPicker = undefined;
      document.dispatchEvent(new Event("worktime:languagechange"));
    });
    assert.equal(
      await page.locator("#autoBackupFolderChoose").isDisabled(),
      true,
    );
    assert.match(
      await page.locator("#autoBackupFolderStatus").innerText(),
      /不支持/,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    for (const language of ["en", "ja", "ko", "zh-TW", "zh-HK", "zh-CN"]) {
      await page.evaluate(
        (language) =>
          WorkTimeApp.services.preferences.page.saveLanguage(language),
        language,
      );
      assert.equal(
        await page
          .locator("#autoBackupFolderChoose")
          .evaluate(
            (element) => element.getBoundingClientRect().right <= innerWidth,
          ),
        true,
      );
    }
    assert.equal(
      await page.locator("#autoBackupFolderRetry").isVisible(),
      false,
    );
    assert.equal(await page.locator("#autoBackupFolderReset").count(), 0);
    await due();
    await page.evaluate(() => localStorage.setItem("folder-read-fail", "1"));
    const beforeReadFailure = downloads.length;
    await page.reload();
    await ready();
    await status("storageFailed");
    await page.waitForFunction(
      () => !document.querySelector("#backupBeforeRestore").disabled,
    );
    assert.equal(
      downloads.length,
      beforeReadFailure,
      "unreadable directory settings must not silently download",
    );
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.preferences.page.state.lastAutoBackupDate,
      ),
      "2020-01-01",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Archive folder selection, persistence, permission retry, failure recovery, manual folder writes, no downloads, languages and narrow layout verified.",
    );
    await context.close();
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
