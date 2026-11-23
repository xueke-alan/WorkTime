"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.find((arg, i) => i > 1 && !arg.startsWith("--")) || root,
);
function unit() {
  const context = vm.createContext({
    WorkTimeApp: { services: {}, data: {} },
    structuredClone,
  });
  const run = (file) =>
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  run("assets/js/typing-engine.js");
  run("assets/js/services/typing-storage.js");
  run("assets/data/typing/catalog.js");
  const { typingEngine: E, typingStorage: S } = context.WorkTimeApp.services;
  const all = [];
  for (const language of ["en"])
    for (const chapter of context.WorkTimeApp.data.typingCatalog[language]) {
      run(chapter.path);
    }
  for (const language of ["en"]) {
    const list = Object.values(
      context.WorkTimeApp.data.typingLessons[language],
    ).flat();
    assert.equal(list.length, language === "en" ? 600 : 100);
    list.forEach((lesson, index) => {
      assert.equal(lesson.number, index + 1);
      assert.equal(
        lesson.id,
        `${language}-${String(index + 1).padStart(3, "0")}`,
      );
      assert(lesson.text.trim());
      assert(lesson.goal > 0);
      assert.equal(lesson.source, "original");
      if (language === "en")
        assert(
          [...lesson.text].every((c) => lesson.keys.includes(c)),
          `Untaught key in ${lesson.id}`,
        );
    });
    all.push(...list);
  }
  assert.equal(new Set(all.map((l) => l.text)).size, 600);
  let state = E.create({ text: "abcde", goal: 1 });
  E.input(state, "abxde");
  state.elapsed = 60000;
  assert.equal(E.metrics(state).accuracy, 80);
  assert.equal(E.metrics(state).speed, 0.8);
  assert.equal(E.complete(state), false);
  E.input(state, "ab");
  E.input(state, "abcde");
  assert.equal(E.metrics(state).accuracy, 87.5);
  assert.equal(E.complete(state), true);
  assert.equal(E.replay(state.events, state.elapsed), "abcde");
  assert.equal(state.errors.c, 1);
  const middle = E.create({ text: "abcde" });
  E.input(middle, "abcde");
  E.input(middle, "abXde");
  assert.equal(middle.attempts, 6);
  assert.equal(middle.correct, 5);
  E.input(middle, "abde");
  assert.equal(middle.attempts, 6);
  assert.equal(E.replay(middle.events, 0), "abde");
  state = E.create({ text: "春天，来了。", language: "zh" });
  E.input(state, "春天，来了。");
  state.elapsed = 60000;
  assert.equal(E.metrics(state).speed, 4);
  assert.equal(E.metrics(state).accuracy, 100);
  assert.equal(E.stars(30, 95, 30), 1);
  assert.equal(E.stars(60, 94.99, 30), 0);
  assert.equal(E.stars(52.5, 99, 30), 5);
  assert.equal(E.stars(45, 98, 30), 4);
  assert.equal(E.stars(37.5, 97, 30), 3);
  assert.equal(E.stars(33, 96, 30), 2);
  assert.equal(E.keyHint("F").key, "f");
  assert.equal(E.keyHint("F").finger, 3);
  assert.equal(E.keyHint("F").shiftHand, "right");
  assert.equal(E.keyHint("?").key, "/");
  assert.equal(E.keyHint(" ").finger, 4);
  const defaults = S.defaults();
  assert(S.validate(defaults));
  const draft = E.create({ text: "a", mode: "custom" });
  draft.elapsed = 20.9;
  E.input(draft, "a");
  defaults.draft = draft;
  assert(S.validate(defaults));
  for (const mutate of [
    (v) => {
      v.unlocked.en = 601;
    },
    (v) => {
      v.settings.dailyMinutes = 0;
    },
    (v) => {
      v.draft.events[0].from = 50;
    },
    (v) => {
      v.draft.events[0].t = 21;
    },
    (v) => {
      v.draft.goal = Infinity;
    },
  ]) {
    const invalid = structuredClone(defaults);
    mutate(invalid);
    assert.throws(() => S.validate(invalid));
  }
  const attached = S.attach({}, defaults);
  assert(S.validateModule(S.find(attached)));
  console.log(
    "Typing rules: 600 unique English staged lessons, scoring, corrections, replay, finger mapping, and invalid archives verified.",
  );
}
async function browser() {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const server = process.argv.includes("--http")
    ? await runtimeServer(site)
    : null;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      errors.push(error.stack);
      console.error(error.stack);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    page.on("requestfailed", (request) =>
      console.error("REQUEST", request.url(), request.failure()),
    );
    await page.goto(
      (server?.url || pathToFileURL(path.join(site, "index.html")).href) +
        "#dev",
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#date-tab-tools").click();
    if (!(await page.locator("#typingOpen").isVisible()))
      await page.locator("#date-tab-tools").click();
    await page.locator("#typingOpen").waitFor();
    assert.equal(
      await page.locator("#typingDialog").count(),
      0,
      "Tutor stays lazy",
    );
    await page.locator("#date-tab-tools").click();
    if (!(await page.locator("#typingOpen").isVisible()))
      await page.locator("#date-tab-tools").click();
    await page.locator("#typingOpen").click();
    await page
      .locator('#typingDialog[data-state="open"]')
      .waitFor({ timeout: 10000 })
      .catch(async (error) => {
        console.log(await page.locator("#typingPanel").innerText());
        console.log(
          await page.evaluate(() => ({
            typing: Object.keys(WorkTimeApp.ui.typing),
            expansion: typeof WorkTimeApp.ui.createWorkspaceExpansion,
            storage: WorkTimeApp.services.typingStorage.read(),
          })),
        );
        throw error;
      });
    await page.locator(".typing-lesson").first().waitFor();
    assert.equal(await page.locator(".typing-lesson").count(), 50);
    assert.equal(
      await page.locator(".typing-lesson:not(:disabled)").count(),
      1,
    );
    if (process.argv.includes("--screenshot"))
      await page.screenshot({ path: path.join(root, "typing-preview.png") });
    await page.locator(".typing-lesson").first().click();
    await page.locator("#typingInput").pressSequentially("x", { delay: 30 });
    assert.equal(await page.locator(".typing-text .is-error").count(), 1);
    await page.locator("#typingInput").press("Backspace");
    await page.locator("#typingInput").pressSequentially("as", { delay: 30 });
    await page.locator(".typing-session-header .typing-button").first().click();
    assert(await page.locator("#typingInput").isDisabled());
    const before = await page.evaluate(
      () => WorkTimeApp.services.typingStorage.read().draft.elapsed,
    );
    await page.waitForTimeout(300);
    const after = await page.evaluate(
      () => WorkTimeApp.services.typingStorage.read().draft.elapsed,
    );
    assert.equal(before, after, "Paused timer does not advance");
    await page.locator(".typing-pause .typing-button").click();
    assert(await page.locator("#typingInput").isEnabled());
    // Commit a real Chinese composition sequence: preview is not scored; final input is scored once.
    await page.locator(".typing-navigation .typing-button").nth(1).click();
    await page.locator(".typing-custom-form input").fill("测试文章");
    await page.locator(".typing-custom-form textarea").fill("春天来了。");
    await page.locator('.typing-custom-form button[type="submit"]').click();
    await page.locator(".typing-article-row button").first().click();
    await page.locator("#typingInput").evaluate((input) => {
      input.focus();
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      input.value = "chun";
      input.dispatchEvent(
        new CompositionEvent("compositionupdate", {
          data: "chun",
          bubbles: true,
        }),
      );
      input.dispatchEvent(
        new InputEvent("input", {
          data: "chun",
          isComposing: true,
          bubbles: true,
        }),
      );
    });
    assert.equal(await page.locator(".typing-text .is-correct").count(), 0);
    assert.equal(
      await page.locator(".typing-composition").textContent(),
      "chun",
    );
    await page.locator("#typingInput").evaluate((input) => {
      input.value = "春天";
      input.dispatchEvent(
        new CompositionEvent("compositionend", { data: "春天", bubbles: true }),
      );
      input.dispatchEvent(
        new InputEvent("input", { data: "春天", bubbles: true }),
      );
    });
    assert.equal(await page.locator(".typing-text .is-correct").count(), 2);
    assert.equal(await page.locator(".typing-composition").count(), 0);
    await page.locator("#typingInput").pressSequentially("来了。");
    await page.locator(".typing-result").waitFor();
    const stored = await page.evaluate(() =>
      WorkTimeApp.services.typingStorage.read(),
    );
    assert.equal(stored.attempts.at(-1).accuracy, 100);
    assert.equal(stored.attempts.at(-1).events.length, 4);
    assert(stored.attempts.at(-1).stars > 0);
    assert.equal(stored.draft, null);
    await page
      .locator(".typing-result .typing-actions button")
      .filter({ hasText: /回放|Replay/ })
      .click();
    await page
      .locator(".typing-replay-slider")
      .fill(String(stored.attempts.at(-1).elapsed));
    assert.equal(await page.locator(".typing-text .is-correct").count(), 5);
    await page.locator(".typing-navigation .typing-button").nth(3).click();
    assert(await page.locator(".typing-history-row").count());
    for (const lang of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.evaluate(async (language) => {
        await WorkTimeApp.i18n.setLanguage(language);
      }, lang);
      assert(
        !/typing\./.test(await page.locator("#typingDialog").innerText()),
        lang + " translated",
      );
    }
    await page.locator(".typing-navigation .typing-button").first().click();
    await page.locator(".typing-lesson").first().click();
    async function finishText() {
      await page.locator("#typingInput").evaluate((input) => {
        input.value = document
          .querySelector(".typing-text")
          .textContent.slice(0, 1);
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      });
      await page.waitForTimeout(70);
      await page.locator("#typingInput").evaluate((input) => {
        input.value = document.querySelector(".typing-text").textContent;
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      });
      await page.locator(".typing-result").waitFor();
    }
    await finishText();
    await page.waitForFunction(
      () => WorkTimeApp.services.typingStorage.read().unlocked.en === 2,
    );
    await page.locator(".typing-navigation .typing-button").first().click();
    assert.equal(
      await page.locator(".typing-placement").count(),
      0,
      "Placement feature removed",
    );
    const backupChecks = await page.evaluate(async () => {
      const S = WorkTimeApp.services,
        A = S.archive,
        T = S.typingStorage;
      const saved = T.read(),
        initial = A.migrate(WorkTimeApp.domain.state.defaultState());
      let fail = false;
      const persistence = S.indexedStorage.create({
        key: "typing-test",
        defaultState: WorkTimeApp.domain.state.defaultState,
        getStorage: () => localStorage,
      });
      const owner = S.application.createState({
        state: initial,
        core: {},
        persistence: {
          commit: async () => ({ persisted: true }),
          restore: async () => ({
            persisted: !fail,
            error: fail ? Error("simulated restore failure") : null,
          }),
        },
      });
      const source = {
        snapshot: () => owner.state,
        export: (state) => persistence.export(state),
        exportChanges: (state, changes) =>
          persistence.exportChanges(state, changes),
      };
      const cache = S.backupCache.create({
        source,
        getGames: () => ({ getItem: () => null }),
        prepareGames: async () => {},
      });
      await cache.warm();
      await owner.saveTyping(saved);
      cache.invalidate({ typing: true });
      const full = await S.backup.decode(
        await cache.capture(),
        (value) => value,
      );
      const migrated = A.migrate(full.work),
        roundtrip = T.validateModule(T.find(migrated));
      const same = JSON.stringify(saved) === JSON.stringify(roundtrip);
      await owner.restore(initial);
      const preserved =
        JSON.stringify(T.validateModule(T.find(owner.state))) ===
        JSON.stringify(saved);
      const before = JSON.stringify(owner.state);
      fail = true;
      const replacement = T.attach(initial, T.defaults());
      const restored = await owner.restore(replacement);
      const rollback =
        !restored.persisted && JSON.stringify(owner.state) === before;
      const bad = structuredClone(full.work);
      bad.modules.find((m) => m.id === T.ID).records[0].data.unlocked.en = 999;
      let rejected = false;
      try {
        A.migrate(bad);
      } catch {
        rejected = true;
      }
      cache.dispose();
      return { same, preserved, rollback, rejected };
    });
    assert.deepEqual(backupChecks, {
      same: true,
      preserved: true,
      rollback: true,
      rejected: true,
    });
    await page.locator(".typing-navigation .typing-button").nth(2).click();
    await page.locator('[data-challenge="words-easy"]').click();
    await page.locator("#typingInput").waitFor();
    assert(await page.locator(".typing-word-cloud").isVisible());
    await page.locator(".typing-navigation .typing-button").nth(2).click();
    await page.locator('[data-challenge="race-normal"]').click();
    assert.equal(await page.locator(".typing-race progress").count(), 2);
    await page.locator("#typingInput").pressSequentially("A");
    await page.locator("#typingExitButton").click();
    await page.locator("#typingDialog").waitFor({ state: "hidden" });
    const saved = await page.evaluate(() =>
      WorkTimeApp.services.typingStorage.read(),
    );
    assert(saved.draft);
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#date-tab-tools").click();
    if (!(await page.locator("#typingOpen").isVisible()))
      await page.locator("#date-tab-tools").click();
    await page.locator("#typingOpen").click();
    await page.locator("#typingDialog[data-state=open]").waitFor();
    const reloaded = await page.evaluate(() =>
      WorkTimeApp.services.typingStorage.read(),
    );
    assert.equal(reloaded.articles.length, 1);
    assert.equal(reloaded.attempts.length, 2);
    assert(reloaded.draft);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".typing-navigation .typing-button").first().click();
    await page.waitForTimeout(250);
    assert(
      await page
        .locator("#typingDialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "Mobile has no horizontal overflow",
    );
    if (process.argv.includes("--screenshot"))
      await page.screenshot({
        path: path.join(root, "typing-mobile-preview.png"),
      });
    // Saving failures retain the local draft and offer a working retry.
    await page.evaluate(() => {
      globalThis.typingOriginalSave = WorkTimeApp.services.typingStorage.save;
      WorkTimeApp.services.typingStorage.save = async () => ({
        persisted: false,
      });
    });
    await page.locator(".typing-daily input").fill("11");
    await page.locator(".typing-daily input").blur();
    await page.locator(".typing-notice button").waitFor();
    await page.evaluate(() => {
      WorkTimeApp.services.typingStorage.save = globalThis.typingOriginalSave;
      delete globalThis.typingOriginalSave;
    });
    await page.locator(".typing-notice button").click();
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.typingStorage.read().settings.dailyMinutes === 11,
    );
    await page.clock.install({ time: new Date() });
    await page.locator(".typing-navigation .typing-button").nth(1).click();
    await page
      .locator(".typing-two-columns .typing-actions button")
      .first()
      .click();
    await page.locator("#typingInput").evaluate((input) => {
      const pasted = new Event("paste", { bubbles: true, cancelable: true });
      if (input.dispatchEvent(pasted)) throw Error("Paste was not blocked");
      const repeated = new KeyboardEvent("keydown", {
        key: "a",
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      if (input.dispatchEvent(repeated))
        throw Error("Key repeat was not blocked");
      input.value = document
        .querySelector(".typing-text")
        .textContent.slice(0, 5);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await page.clock.fastForward(61000);
    await page.locator(".typing-result").waitFor();
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.typingStorage.read().attempts.at(-1).elapsed,
      ),
      60000,
    );
    await page.locator(".typing-navigation .typing-button").nth(2).click();
    await page.locator('[data-challenge="words-easy"]').click();
    await page.locator("#typingInput").evaluate((input) => {
      const text = document.querySelector(".typing-text").textContent;
      input.value = text.slice(0, text.indexOf(" ") + 1);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await page.clock.fastForward(61000);
    await page.locator(".typing-result").waitFor();
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.typingStorage.read().attempts.at(-1).points,
      ),
      1,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "Typing browser: lazy load, input correction, pause/resume, Chinese composition, replay, history, six locales, games, course unlocks, calendar return toolbar, full backup roundtrip, legacy backup preservation, atomic rollback, persistence, and mobile verified.",
    );
  } finally {
    await browser.close();
    await server?.close();
  }
}
unit();
if (!process.argv.includes("--unit"))
  browser().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
