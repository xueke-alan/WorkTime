"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const { observeBackupWrites } = require("./lib/backup-test-file.cjs");
const { chromium } = require("playwright");

(async () => {
  const server = await runtimeServer(path.resolve(process.argv[2] || "."));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ serviceWorkers: "block" });
    const capture = await observeBackupWrites(page);
    page.on("download", () => assert.fail("Backup triggered browser download"));
    await page.addInitScript(() => {
      localStorage.setItem("worktime.onboarding.v1", "dismissed");
      window.showOpenFilePicker = undefined;
    });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, (route) => route.abort());
    await page.goto(server.url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.preferences.page.state.lastAutoBackupDate ===
          WorkTimeApp.domain.time.businessDate(new Date()) &&
        !document.getElementById("backupBeforeRestore").disabled,
    );
    const xiangqi = await page.evaluate(async () => {
      localStorage.setItem("worktime.games.jump.best.v1", "42");
      await WorkTimeApp.games.prepareArchive(["game-xiangqi"]);
      const [level] = WorkTimeApp.data.xiangqi;
      const draftLevel = WorkTimeApp.data.xiangqi.find(
        ({ goal }) => goal === 2,
      );
      const opening = Number(Object.keys(draftLevel.tree[1])[0]);
      const reply = WorkTimeApp.games.xiangqiRules.reply(
        draftLevel.tree[1][opening],
      );
      const save = {
        version: 1,
        current: draftLevel.id,
        drafts: { [draftLevel.id]: { path: [opening, reply] } },
        completed: {
          [level.id]: { path: [Number(Object.keys(level.tree[1])[0])] },
        },
      };
      localStorage.setItem(
        WorkTimeApp.services.gameArchive.keys["game-xiangqi"],
        JSON.stringify(save),
      );
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw Error("Unexpected clipboard write");
          },
          readText: async () => {
            window.testReadCount = (window.testReadCount || 0) + 1;
            throw Error("Unexpected clipboard read");
          },
        },
      });
      return save;
    });
    const xiangqiKey = "worktime.games.xiangqi.v1";
    const savedXiangqi = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), xiangqiKey);
    assert.equal(await page.locator("#backup").count(), 0);
    const exportFile = async () => {
      const downloading = capture.next();
      await page.evaluate(() =>
        document.getElementById("backupBeforeRestore").click(),
      );
      const file = await downloading;
      const text = file.text;
      await page.waitForFunction(
        () => !document.getElementById("backupBeforeRestore").disabled,
      );
      await page.evaluate((value) => {
        window.testBackupText = value;
      }, text);
      return text;
    };
    const importFile = async () => {
      const choosing = page.waitForEvent("filechooser");
      await page.locator("#restore").click();
      const chooser = await choosing;
      await chooser.setFiles({
        name: "backup.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(await page.evaluate(() => window.testBackupText)),
      });
    };
    await exportFile();
    // Native import must start in this runtime root's backups directory.
    await page.evaluate(() => {
      window.testPickerCalls = 0;
      window.showOpenFilePicker = async (options) => {
        const expected =
          await WorkTimeApp.services.runtimeFolder.getDirectory("backups");
        if (!(await expected.isSameEntry(options.startIn)))
          throw Error("Picker did not start in the backup directory");
        if (options.multiple || options.id)
          throw Error("Picker must select one file from the specified folder");
        window.testPickerCalls++;
        return [
          {
            getFile: async () =>
              new File([window.testBackupText], "backup.txt"),
          },
        ];
      };
    });
    await page.locator("#restore").click();
    await page.locator("#restoreDialog[open]").waitFor();
    assert.equal(await page.evaluate(() => window.testPickerCalls), 1);
    await page
      .locator('#restoreDialog [data-close="restoreDialog"]')
      .first()
      .click();
    await page.evaluate(() => {
      window.showOpenFilePicker = async () => {
        throw new DOMException("Cancelled", "AbortError");
      };
    });
    await page.locator("#restore").click();
    await page.waitForFunction(
      () => !document.getElementById("restore").disabled,
    );
    assert.equal(await page.locator("#restoreDialog").isVisible(), false);
    // An exposed but unavailable native picker falls back to the file input.
    await page.evaluate(() => {
      window.showOpenFilePicker = async () => {
        throw new DOMException("Unavailable", "SecurityError");
      };
    });
    await importFile();
    await page.locator("#restoreDialog[open]").waitFor();
    await page
      .locator('#restoreDialog [data-close="restoreDialog"]')
      .first()
      .click();
    await page.evaluate(() => {
      window.showOpenFilePicker = undefined;
    });
    assert.ok(
      await page.evaluate(() =>
        /^WORKTIME:(GZIP|DEFLATE|CHUNKS):1:/.test(window.testBackupText),
      ),
    );
    const original = await page.evaluate(async () => {
      const backup = WorkTimeApp.services.backup;
      const value = await backup.decode(window.testBackupText, (v) => v);
      window.legacyBackup = JSON.stringify(value.work);
      value.work.modules.find(
        (m) => m.id === "worktime.profile",
      ).records[0].data.employmentDate = "2020-01-01";
      window.testBackupText = await backup.encodeCompact(JSON.stringify(value));
      window.fullBackup = window.testBackupText;
      return {
        format: value.format,
        games: value.games.games,
        rawLength: JSON.stringify(value).length,
        compressedLength: window.testBackupText.length,
      };
    });
    assert.equal(original.format, "worktime-full-backup");
    assert.equal(original.games["game-jump"], 42);
    assert.deepEqual(original.games["game-xiangqi"], xiangqi);
    assert.ok(original.compressedLength < original.rawLength);
    await page.evaluate((key) => {
      localStorage.setItem("worktime.games.jump.best.v1", "99");
      localStorage.removeItem(key);
    }, xiangqiKey);
    await importFile();
    await page.waitForFunction(
      () => document.querySelector("#restoreDialog").open,
    );
    assert.match(
      await page.locator("#restoreSummary").textContent(),
      /2.*游戏|2.*game/,
    );
    // Cancelling a full restore leaves game storage untouched.
    await page.evaluate(() => document.querySelector("#restoreDialog").close());
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      "99",
    );
    await importFile();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      "42",
    );
    assert.deepEqual(await savedXiangqi(), xiangqi);
    await page.evaluate(() => {
      window.testBackupText = null;
    });
    await exportFile();
    assert.equal(
      await page.evaluate(async () => {
        const value = await WorkTimeApp.services.backup.decode(
          window.testBackupText,
          (v) => v,
        );
        return value.work.modules.find((m) => m.id === "worktime.profile")
          .records[0].data.employmentDate;
      }),
      "2020-01-01",
    );

    // Older work-only archives preserve games.
    await page.evaluate(() => {
      window.testBackupText = window.legacyBackup;
      localStorage.setItem("worktime.games.jump.best.v1", "77");
    });
    await importFile();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      "77",
    );
    assert.deepEqual(await savedXiangqi(), xiangqi);

    const fileText = await exportFile();
    const fileGames = await page.evaluate(
      async (text) =>
        (await WorkTimeApp.services.backup.decode(text, (v) => v)).games.games,
      fileText,
    );
    assert.equal(fileGames["game-jump"], 77);
    assert.deepEqual(fileGames["game-xiangqi"], xiangqi);
    await page.evaluate(() =>
      localStorage.setItem("worktime.games.jump.best.v1", "88"),
    );
    await page.locator("#backupFile").setInputFiles({
      name: "full-backup.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(fileText),
    });
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      "77",
    );

    // An empty full game archive clears local games, unlike a legacy work backup.
    await page.evaluate(async () => {
      const backup = WorkTimeApp.services.backup;
      const value = await backup.decode(window.fullBackup, (v) => v);
      value.games.games = {};
      window.testBackupText = JSON.stringify(value);
    });
    await importFile();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      null,
    );
    assert.equal(await savedXiangqi(), null);
    console.log(
      `Full backup folder save/file restore, legacy compatibility, cancellation and empty games: PASS (${original.rawLength} -> ${original.compressedLength} characters)`,
    );

    // Cancelling a picker leaves storage untouched and does not access clipboard.
    const beforeCancel = await savedXiangqi();
    const choosing = page.waitForEvent("filechooser");
    await page.locator("#restore").click();
    await (await choosing).setFiles([]);
    assert.deepEqual(await savedXiangqi(), beforeCancel);
    assert.equal(await page.locator("#restoreDialog").isVisible(), false);
    await page.evaluate(() => {
      window.testBackupText = "{invalid backup";
    });
    await importFile();
    await page.waitForFunction(() =>
      document.querySelector("#feedbackList").textContent.includes("JSON"),
    );
    assert.equal(await page.locator("#restoreDialog").isVisible(), false);
    await page.evaluate(() => {
      window.testBackupText = JSON.stringify({
        format: "worktime-full-backup",
        version: 999,
      });
    });
    await importFile();
    assert.equal(await page.locator("#restoreDialog").isVisible(), false);
    const lifecycle = await page.evaluate(() => {
      const nodes = new Map();
      const element = (id) => {
        if (!nodes.has(id))
          nodes.set(id, document.getElementById(id).cloneNode(true));
        return nodes.get(id);
      };
      let picks = 0;
      element("backupFile").click = () => picks++;
      const controller = WorkTimeApp.ui.createBackupController({
        element,
        model: { loadIssue: null, loadCorrupt: false },
        downloads: {},
        backupSource: { subscribe: () => () => {} },
      });
      controller.bind();
      controller.bind();
      element("restore").click();
      element("restoreStorage").click();
      const first = picks;
      controller.dispose();
      element("restore").click();
      const disposed = picks;
      controller.bind();
      element("restore").click();
      controller.dispose();
      return { first, disposed, rebound: picks };
    });
    assert.deepEqual(lifecycle, { first: 2, disposed: 2, rebound: 3 });
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
      await page.evaluate(
        (language) =>
          WorkTimeApp.services.preferences.page.saveLanguage(language),
        language,
      );
      assert.equal(
        await page.locator("#restore").getAttribute("aria-label"),
        await page.evaluate(() => WorkTimeApp.i18n.t("backup.importFile")),
      );
    }
    await page.evaluate(() =>
      WorkTimeApp.services.preferences.page.saveLanguage("zh-CN"),
    );
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const style = await page.locator("#restore").evaluate((button) => {
        const css = getComputedStyle(button),
          rect = button.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          viewport: innerWidth,
          radii: [
            css.borderTopLeftRadius,
            css.borderTopRightRadius,
            css.borderBottomLeftRadius,
            css.borderBottomRightRadius,
          ],
        };
      });
      assert.ok(
        style.left >= 0 && style.right <= style.viewport,
        JSON.stringify(style),
      );
      assert.equal(new Set(style.radii).size, 1);
    }
    // Oversized files are rejected before reading their content.
    await page.evaluate(() => {
      const file = new File(["x"], "large.txt");
      Object.defineProperty(file, "size", {
        value: WorkTimeApp.services.backup.MAX_BYTES + 1,
      });
      file.text = () => {
        throw Error("Oversized file was read");
      };
      const input = document.getElementById("backupFile");
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change"));
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#feedbackList")
        .textContent.includes(WorkTimeApp.i18n.t("copy.c3b5086f19")),
    );
    assert.equal(await page.evaluate(() => window.testReadCount || 0), 0);
    const rescue = capture.next();
    await page.evaluate(() => {
      const nodes = new Map();
      const element = (id) => {
        if (!nodes.has(id))
          nodes.set(id, document.getElementById(id).cloneNode(true));
        return nodes.get(id);
      };
      const controller = WorkTimeApp.ui.createBackupController({
        element,
        originalStorageText: "{unreadable original bytes",
        model: { loadIssue: "corrupt", loadCorrupt: true, today: "2026-11-09" },
        actions: { toast() {} },
        backupSource: { subscribe: () => () => {} },
      });
      controller.bind();
      element("exportCorruptStorage").click();
      window.rescueTestController = controller;
    });
    const raw = await rescue;
    assert.equal(raw.kind, "manual");
    assert.equal(raw.text, "{unreadable original bytes");
    await page.evaluate(() => window.rescueTestController.dispose());
    console.log(
      "Direct file picker, repeat import, cancellation, invalid/unsupported/oversized files and zero clipboard access: PASS",
    );
  } finally {
    await browser.close();
    await server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
