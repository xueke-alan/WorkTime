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
      data.settings.dailyTotal = 3;
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
    assert.deepEqual(undone.reinforcement, second.reinforcement);
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
    let corrected = await state();
    assert.equal(corrected.logs.length, 2);
    assert.equal(corrected.logs[1].grade, 1);
    assert.equal(corrected.logs[1].id, second.draft.id);
    for (const [key, grade] of [
      ["ArrowDown", 2],
      ["ArrowRight", 1],
      ["ArrowLeft", 3],
    ]) {
      await page.keyboard.press("ArrowUp");
      await page
        .locator(
          `[data-grade="${corrected.logs[1].grade}"].is-previous-choice:not(:disabled)`,
        )
        .waitFor();
      const returned = await state();
      assert.equal(returned.draft.id, second.draft.id);
      assert.equal(returned.logs.length, 1);
      assert.deepEqual(returned.cards, second.cards);
      assert.deepEqual(returned.reinforcement, second.reinforcement);
      await page.keyboard.press("ArrowUp");
      assert.deepEqual(await state(), returned, "Cannot return two words back");
      await page.keyboard.press(key);
      await page.waitForFunction(
        (id) => WorkTimeApp.services.vocabularyStorage.read().draft?.id === id,
        beforeUndo.draft.id,
      );
      await ready();
      corrected = await state();
      assert.deepEqual(corrected.draft, beforeUndo.draft);
      assert.equal(corrected.logs.length, 2);
      assert.equal(corrected.logs[1].id, second.draft.id);
      assert.equal(corrected.logs[1].grade, grade);
      assert.equal(
        corrected.cards[`${second.draft.mode}:${second.draft.id}`].reps,
        beforeUndo.cards[`${second.draft.mode}:${second.draft.id}`].reps,
      );
    }
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
    await page.waitForFunction(
      () => WorkTimeApp.services.vocabularyStorage.read().logs.length === 3,
    );
    await page.keyboard.press("ArrowUp");
    await page
      .locator('[data-grade="3"].is-previous-choice:not(:disabled)')
      .waitFor();
    assert.equal((await state()).logs.length, 2);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => {
      const data = WorkTimeApp.services.vocabularyStorage.read();
      return data.logs.length === 3 && data.draft?.revealed === false;
    });
    await ready();
    const final = await state();
    assert.equal(final.logs.length, 3);
    assert.equal(final.logs[2].grade, 1);
    for (const [key, grade] of [
      ["ArrowRight", 1],
      ["ArrowLeft", 3],
    ]) {
      await page.keyboard.press("ArrowUp");
      await page.locator(".is-previous-choice:not(:disabled)").waitFor();
      const returned = await state();
      assert.equal(returned.draft.id, corrected.draft.id);
      assert.equal(returned.logs.length, 2);
      assert.deepEqual(returned.cards, corrected.cards);
      assert.deepEqual(returned.reinforcement, corrected.reinforcement);
      await page.keyboard.press("ArrowUp");
      assert.deepEqual(await state(), returned);
      await page.keyboard.press(key);
      await page.waitForFunction(
        () => WorkTimeApp.services.vocabularyStorage.read().logs.length === 3,
      );
      assert.equal((await state()).logs[2].grade, grade);
      if (grade === 3) await page.locator(".vocabulary-hero").waitFor();
      else {
        await page.waitForFunction(
          () =>
            WorkTimeApp.services.vocabularyStorage.read().draft?.revealed ===
            false,
        );
        await ready();
      }
    }
    // Spelling keeps the unfinished current answer through repeated corrections.
    await page.evaluate(async () => {
      const storage = WorkTimeApp.services.vocabularyStorage;
      const data = storage.defaults();
      data.settings.mode = "spelling";
      data.settings.dailyTotal = 3;
      data.settings.autoRead = false;
      await storage.save(data);
    });
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(async () => {
      await WorkTimeApp.services.vocabularyIdle.load();
      WorkTimeApp.services.vocabularyIdle.configure({ enabled: false });
    });
    await page.locator("#date-tab-tools").click();
    await page.locator("#vocabularyOpen").click();
    await page.locator(".vocabulary-answer:not(:disabled)").waitFor();
    const answer = await page.evaluate(() => {
      const id = WorkTimeApp.services.vocabularyStorage.read().draft.id;
      return WorkTimeApp.data.vocabularyCatalog.entries.find((e) => e.id === id)
        .word;
    });
    await page.locator(".vocabulary-answer").fill(answer);
    await page.locator('[data-action="check"]').click();
    await page.locator('[data-grade="3"]:not(:disabled)').click();
    await page.locator(".vocabulary-answer:not(:disabled)").waitFor();
    await page.locator(".vocabulary-answer").fill("unfinished answer");
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().draft.answer ===
        "unfinished answer",
    );
    await page.locator(".vocabulary-answer").evaluate((input) => input.blur());
    const unfinished = await state();
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("ArrowUp");
      await page.locator(".is-previous-choice:not(:disabled)").waitFor();
      assert.equal((await state()).logs.length, 0);
      await page.keyboard.press("ArrowLeft");
      await page.locator(".vocabulary-answer:not(:disabled)").waitFor();
      assert.equal(
        await page.locator(".vocabulary-answer").inputValue(),
        "unfinished answer",
      );
      assert.deepEqual((await state()).draft, unfinished.draft);
      assert.equal((await state()).logs.length, 1);
    }
    assert.deepEqual(errors, []);
    console.log(
      "Space reveal, arrow ratings, repeated single-level correction, FSRS rollback, log replacement, completion-page return, spelling draft restoration, save retry and editing guards passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
