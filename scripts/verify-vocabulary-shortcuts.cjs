"use strict";
require("./lib/browser-test-setup.cjs");
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      pathToFileURL(
        path.resolve(
          process.argv[2] || path.join(__dirname, ".."),
          "index.html",
        ),
      ).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(async () => {
      await WorkTimeApp.services.vocabularyIdle.load();
      WorkTimeApp.services.vocabularyIdle.configure({ enabled: false });
      const data = WorkTimeApp.services.vocabularyStorage.defaults();
      data.settings.dailyNew = 3;
      data.settings.autoRead = false;
      await WorkTimeApp.services.vocabularyStorage.save(data);
    });
    await page.locator("#date-tab-tools").click();
    await page.locator("#vocabularyOpen").click();
    await page.locator(".vocabulary-card").waitFor();
    const state = () =>
      page.evaluate(() =>
        structuredClone(WorkTimeApp.services.vocabularyStorage.read()),
      );
    const ready = () =>
      page.waitForFunction(
        () =>
          document.querySelector(".vocabulary-card") &&
          !!document.querySelector(
            ".vocabulary-pronunciation-play:not(:disabled)",
          ),
      );
    await ready();
    const first = await state();
    await page.keyboard.press("ArrowLeft");
    assert.equal((await state()).logs.length, 0);
    await page.keyboard.press("Space");
    await page.locator('[data-grade="3"]:not(:disabled)').waitFor();
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(
      (id) =>
        WorkTimeApp.services.vocabularyStorage.read().draft?.id !== id &&
        !!document.querySelector(".vocabulary-recall-prompt"),
      first.draft.id,
    );
    await ready();
    const second = await state();
    assert.equal(second.logs.length, 1);
    assert.equal(second.logs[0].grade, 3);
    await page.keyboard.press("Space");
    await page.locator('[data-grade="2"]:not(:disabled)').waitFor();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(
      (id) =>
        WorkTimeApp.services.vocabularyStorage.read().draft?.id !== id &&
        !!document.querySelector(".vocabulary-recall-prompt"),
      second.draft.id,
    );
    await ready();
    const beforeUndo = await state();
    await page.evaluate(() => {
      const storage = WorkTimeApp.services.vocabularyStorage;
      window.savedShortcutSave = storage.save;
      storage.save = async () => ({ persisted: false });
    });
    await page.keyboard.press("ArrowUp");
    await page.getByRole("button", { name: "重试", exact: true }).waitFor();
    assert.deepEqual(
      await state(),
      beforeUndo,
      "Failed undo keeps saved grading unchanged",
    );
    await page.keyboard.press("ArrowRight");
    assert.deepEqual(await state(), beforeUndo);
    await page.evaluate(() => {
      WorkTimeApp.services.vocabularyStorage.save = window.savedShortcutSave;
    });
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page
      .locator('[data-grade="2"].is-previous-choice:not(:disabled)')
      .waitFor();
    const undone = await state();
    assert.equal(undone.draft.id, second.draft.id);
    assert.equal(undone.logs.length, 1);
    assert.deepEqual(undone.cards, second.cards);
    await page.keyboard.press("ArrowUp");
    assert.deepEqual(await state(), undone);
    await page.screenshot({
      path: path.join(
        __dirname,
        "../.cache/vocabulary-shortcuts-correction.png",
      ),
    });
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      (id) =>
        WorkTimeApp.services.vocabularyStorage.read().draft?.id !== id &&
        !!document.querySelector(".vocabulary-recall-prompt"),
      second.draft.id,
    );
    await ready();
    const corrected = await state();
    assert.equal(corrected.logs.length, 2);
    assert.equal(corrected.logs[1].grade, 1);
    assert.equal(corrected.logs[1].id, second.draft.id);
    await page.keyboard.press("ArrowUp");
    assert.deepEqual(await state(), corrected);
    // Held keys, editable controls, hidden vocabulary, and settings must not act.
    await page.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true }),
      ),
    );
    assert.equal((await state()).draft.revealed, false);
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "shortcut-fixture";
      document.querySelector(".vocabulary-page").append(input);
      input.focus();
    });
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowLeft");
    assert.deepEqual(await state(), corrected);
    await page.evaluate(() =>
      document.getElementById("shortcut-fixture").remove(),
    );
    await page.locator('[data-page="preferences"]').click();
    await page.keyboard.press("Space");
    assert.deepEqual(await state(), corrected);
    await page.locator('[data-page="learning"]').click();
    await ready();
    await page.keyboard.press("Space");
    await page.locator('[data-grade="3"]:not(:disabled)').waitFor();
    await page.keyboard.press("ArrowLeft");
    await page.locator(".vocabulary-hero").waitFor();
    await page.keyboard.press("ArrowUp");
    await page
      .locator('[data-grade="3"].is-previous-choice:not(:disabled)')
      .waitFor();
    assert.equal((await state()).logs.length, 2);
    await page.keyboard.press("ArrowRight");
    await page.locator(".vocabulary-hero").waitFor();
    const final = await state();
    assert.equal(final.logs.length, 3);
    assert.equal(final.logs[2].grade, 1);
    await page.keyboard.press("ArrowUp");
    assert.deepEqual(await state(), final);
    assert.deepEqual(errors, []);
    console.log(
      "Space reveal, three arrow ratings, single-level correction, FSRS rollback, corrected log replacement, last-word undo, held-key and editing guards passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
