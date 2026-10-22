"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    await page.route(/^https?:/, (route) => route.abort());
    const siteRoot = process.argv[2] || path.resolve(__dirname, "..");
    await page.goto(pathToFileURL(path.resolve(siteRoot, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => {
      localStorage.setItem("worktime.games.jump.best.v1", "42");
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.testBackupText = text;
          },
          readText: async () => {
            window.testReadCount = (window.testReadCount || 0) + 1;
            if (window.testFocusFailures > 0) {
              window.testFocusFailures--;
              throw new DOMException(
                "Document is not focused.",
                "NotAllowedError",
              );
            }
            if (window.testReadDenied)
              throw new DOMException(
                "Clipboard read denied",
                "NotAllowedError",
              );
            return window.testBackupText;
          },
        },
      });
    });
    await page.locator("#backup").click();
    await page.waitForFunction(() => !!window.testBackupText);
    assert.ok(
      await page.evaluate(() =>
        /^WORKTIME:(GZIP|DEFLATE):1:/.test(window.testBackupText),
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
    assert.ok(original.compressedLength < original.rawLength);
    await page.evaluate(() =>
      localStorage.setItem("worktime.games.jump.best.v1", "99"),
    );
    await page.locator("#restore").click();
    await page.waitForFunction(
      () => document.querySelector("#restoreDialog").open,
    );
    assert.match(
      await page.locator("#restoreSummary").textContent(),
      /1.*游戏|1.*game/,
    );
    // Cancelling a full restore leaves game storage untouched.
    await page.evaluate(() => document.querySelector("#restoreDialog").close());
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      "99",
    );
    await page.locator("#restore").click();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      "42",
    );
    await page.evaluate(() => {
      window.testBackupText = null;
    });
    await page.locator("#backup").click();
    await page.waitForFunction(() => !!window.testBackupText);
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
    await page.locator("#restore").click();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      "77",
    );

    const downloading = page.waitForEvent("download");
    await page.locator("#backup").focus();
    await page.keyboard.down("Space");
    const downloaded = await downloading;
    await page.keyboard.up("Space");
    assert.match(downloaded.suggestedFilename(), /\.txt$/);
    const fileText = await fs.readFile(await downloaded.path(), "utf8");
    const fileGames = await page.evaluate(
      async (text) =>
        (await WorkTimeApp.services.backup.decode(text, (v) => v)).games.games,
      fileText,
    );
    assert.equal(fileGames["game-jump"], 77);
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
    await page.locator("#restore").click();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      null,
    );
    console.log(
      `Full backup copy/file restore, legacy compatibility, cancellation and empty games: PASS (${original.rawLength} -> ${original.compressedLength} characters)`,
    );

    await page.evaluate(() => {
      window.testReadDenied = true;
      window.testReadCount = 0;
    });
    const deniedPicker = page.waitForEvent("filechooser");
    await page.locator("#restore").click();
    await deniedPicker;
    const permissionMessage = "NotAllowedError: Clipboard read denied";
    await page.waitForFunction(
      (message) =>
        document.querySelector("#feedbackList").textContent.includes(message),
      permissionMessage,
    );
    assert.equal(await page.evaluate(() => window.testReadCount), 1);
    console.log("Denied clipboard read displays permission reason: PASS");

    await page.evaluate(() => {
      window.testReadDenied = false;
      window.testBackupText = "{invalid backup";
    });
    const invalidPicker = page.waitForEvent("filechooser");
    await page.locator("#restore").click();
    await invalidPicker;
    await page.waitForFunction(() =>
      document.querySelector("#feedbackList").textContent.includes("JSON"),
    );
    console.log("Invalid backup displays JSON parse reason: PASS");

    await page.evaluate(() => {
      window.testFocusFailures = 99;
      window.testReadCount = 0;
    });
    const unfocusedPicker = page.waitForEvent("filechooser");
    await page.locator("#restore").click();
    await unfocusedPicker;
    const attempts = await page.evaluate(() => window.testReadCount);
    assert.equal(attempts, 1);
    await page.waitForFunction(() =>
      document
        .querySelector("#feedbackList")
        .textContent.includes("Document is not focused"),
    );
    console.log("Focus failure makes exactly one read request: PASS");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
