"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const context = await browser.newContext({
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
  await page.addInitScript(() => {
    window.clipboardWrites = 0;
    window.clipboardValue = "";
    window.clipboardDenied = false;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: async () => {
          if (window.clipboardDenied)
            throw new DOMException("denied", "NotAllowedError");
          return window.clipboardValue;
        },
        writeText: async (text) => {
          if (window.clipboardDenied)
            throw new DOMException("denied", "NotAllowedError");
          window.clipboardValue = text;
          window.clipboardWrites++;
        },
      },
      configurable: true,
    });
  });
  await page.goto(
    require("node:url").pathToFileURL(path.resolve(__dirname, "../index.html"))
      .href,
  );
  await page.locator("#backup").waitFor({ state: "visible" });
  await page.evaluate(() =>
    WorkTimeApp.services.preferences.page.saveTheme("rose"),
  );
  await page.evaluate(() => WorkTimeApp.ui.theme.apply("blue"));
  assert.equal(await page.locator("html").getAttribute("data-theme"), "blue");
  await page.locator("#backup").focus();
  await page.keyboard.down("Space");
  await page.clock.fastForward(100);
  await page.keyboard.up("Space");
  await page.waitForFunction(() => window.clipboardWrites === 1);
  const copied = await page.evaluate(async () =>
    WorkTimeApp.services.backup.decode(
      window.clipboardValue,
      WorkTimeApp.domain.validation.validateBackup,
    ),
  );
  assert.equal(copied.schemaVersion, 3);
  assert.equal(copied.preferences.pageTheme, "rose");
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.down("Space");
  await page.clock.fastForward(2600);
  const download = await downloadPromise;
  await page.keyboard.up("Space");
  const raw = await fs.readFile(await download.path(), "utf8"),
    file = JSON.parse(raw);
  assert.equal(file.schemaVersion, 3);
  assert.equal(file.preferences.pageTheme, "rose");
  assert.equal(
    await page.evaluate(() => window.clipboardWrites),
    1,
    "Long hold downloads once without extra clipboard copy",
  );
  await page.evaluate(() => (window.clipboardDenied = true));
  await page.locator("#backup").click();
  await page.waitForFunction(() =>
    document
      .getElementById("feedbackList")
      .textContent.includes("请允许剪贴板访问"),
  );
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#restore").click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "saved.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await page.evaluate(() =>
    WorkTimeApp.services.preferences.page.saveTheme("blue"),
  );
  await page.locator("#confirmRestore").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "rose");
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem(WorkTimeApp.services.preferences.key),
    ),
    "rose",
  );
  assert.equal(
    await page.locator("#restoreDialog").evaluate((e) => e.open),
    false,
  );
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("worktime-local-v1")),
  );
  assert.deepEqual(restored.settings, file.settings);
  await page.evaluate(() => {
    window.clipboardDenied = false;
    WorkTimeApp.services.preferences.page.saveTheme("blue");
  });
  await page.locator("#restore").click();
  await page.locator("#restoreDialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "blue");
  assert.match(await page.locator("#restoreSummary").textContent(), /玫瑰红/);
  await page.locator("#confirmRestore").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "rose");
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  assert.equal(await page.locator("html").getAttribute("data-theme"), "rose");
  assert.equal(
    await page.locator('input[name="pageTheme"][value="rose"]').isChecked(),
    true,
  );
  const beforeExit = await page.evaluate(() =>
    localStorage.getItem("worktime-local-v1"),
  );
  await page.evaluate(() => {
    window.pendingClipboard = [];
    window.prepareCalls = 0;
    navigator.clipboard.readText = () =>
      new Promise((resolve) => window.pendingClipboard.push(resolve));
    const original = WorkTimeApp.services.imports.prepare;
    WorkTimeApp.services.imports.prepare = (...args) => {
      window.prepareCalls++;
      return original(...args);
    };
  });
  await page.locator("[data-import-clipboard]").click();
  await page.locator("#restore").click();
  assert.equal(await page.evaluate(() => window.pendingClipboard.length), 2);
  await page.evaluate((text) => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    window.pendingClipboard[0]("09/28\n08:00\n17:30");
    window.pendingClipboard[1](text);
  }, raw);
  await page.clock.fastForward(100);
  assert.equal(
    await page.evaluate(() => window.prepareCalls),
    0,
    "Disposed import must not plan or commit delayed clipboard data",
  );
  assert.equal(
    await page.locator("#restoreDialog").evaluate((e) => e.open),
    false,
    "Disposed restore must not reopen a dialog",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("worktime-local-v1")),
    beforeExit,
  );
  const released = await page.evaluate(() => {
    const ids = [
      "backup",
      "restore",
      "confirmRestore",
      "importOpen",
      "oaShortcut",
      "settingsOpen",
      "setupButton",
      "plannedOvertimeToggle",
      "helpOpen",
    ];
    const attached = ids.filter(
      (id) => document.getElementById(id).onclick !== null,
    );
    for (const id of ids) document.getElementById(id).click();
    const button = document.getElementById("backup");
    button.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
    );
    return { attached, pending: window.pendingClipboard.length };
  });
  assert.deepEqual(
    released,
    { attached: [], pending: 2 },
    "Released controllers accept no further clicks or clipboard work",
  );
  await page.clock.fastForward(3000);
  assert.equal(
    await page.locator("#backup.is-holding, #backup.is-completing").count(),
    0,
  );
  const remount = await page.evaluate(async (raw) => {
    const D = WorkTimeApp.domain;
    const $ = (id) => document.getElementById(id);
    const pending = [],
      messages = [];
    let commits = 0;
    const model = {
      state: D.state.defaultState(),
      today: "2026-10-04",
      selected: "2026-10-04",
    };
    const options = {
      element: $,
      model,
      originalStorageText: null,
      core: {
        hours: D.time.hours,
        validateBackup: D.validation.validateBackup,
        timeMin: D.time.timeMin,
        deleteImport: D.observations.deleteImport,
        parseText: D.observations.parseText,
        mergeObservation: D.observations.mergeObservation,
      },
      escape: String,
      clock: {
        now: () => new Date("2026-10-04T12:00:00+08:00"),
        year: () => 2026,
      },
      clipboard: {
        readText: () => new Promise((resolve) => pending.push(resolve)),
      },
      downloads: { download() {} },
      preferences: WorkTimeApp.services.preferences.page,
      application: {
        importRecords() {
          commits++;
          return { persisted: true };
        },
      },
      importIndex: WorkTimeApp.services.importIndex.create({
        core: { parseText: D.observations.parseText },
      }),
      actions: {
        toast: (message) => messages.push(message),
        saveFeedback: () => {},
        render() {},
        open: (id) => $(id).showModal(),
      },
    };
    const backup = WorkTimeApp.ui.createBackupController(options);
    const imports = WorkTimeApp.ui.createImportController(options);
    backup.bind();
    imports.bind();
    $("restore").click();
    document.querySelector("[data-import-clipboard]").click();
    backup.dispose();
    imports.dispose();
    backup.bind();
    imports.bind();
    $("restore").click();
    pending[0]("invalid old backup");
    pending[1]("09/27\n08:00\n17:30");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stale = {
      commits,
      messages: messages.length,
      newRestorePending: $("restore").disabled,
      dialog: $("restoreDialog").open,
    };
    pending[2](raw);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const currentRestore = {
      dialog: $("restoreDialog").open,
      enabled: !$("restore").disabled,
      messages: messages.length,
    };
    $("restoreDialog").close();
    document.querySelector("[data-import-clipboard]").click();
    pending[3]("09/27\n08:00\n17:30");
    await new Promise((resolve) => setTimeout(resolve, 0));
    backup.dispose();
    imports.dispose();
    options.importIndex.dispose();
    const files = [],
      corrupt = WorkTimeApp.ui.createBackupController({
        ...options,
        model: { ...model, loadCorrupt: true },
        originalStorageText: "{unreadable original bytes}",
        downloads: { download: (...args) => files.push(args) },
      });
    for (let cycle = 0; cycle < 3; cycle++) {
      corrupt.bind();
      corrupt.bind();
      if (document.querySelectorAll("#exportCorruptStorage").length !== 1)
        throw Error("Remounted corrupt export duplicates its control");
      $("exportCorruptStorage").click();
      corrupt.dispose();
      corrupt.dispose();
      $("exportCorruptStorage").click();
    }
    return {
      stale,
      currentRestore,
      commits,
      corruptExports: files.map((args) => args[1]),
    };
  }, raw);
  assert.deepEqual(
    remount,
    {
      stale: {
        commits: 0,
        messages: 0,
        newRestorePending: true,
        dialog: false,
      },
      currentRestore: { dialog: true, enabled: true, messages: 1 },
      commits: 1,
      corruptExports: Array(3).fill("{unreadable original bytes}"),
    },
    "Remount rejects previous lifetime results while new restore/import work normally",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Controller backup passed: short copy, long download, denied/file fallback and pending clipboard import/restore canceled after page exit.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
