"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({
  WorkTimeApp: { services: {} },
  structuredClone,
});
for (const file of [
  "assets/vendor/vocabulary/fsrs.js",
  "assets/js/vocabulary-engine.js",
  "assets/js/services/vocabulary-storage.js",
])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const { vocabularyEngine: E, vocabularyStorage: S } =
  context.WorkTimeApp.services;
const words = Array.from({ length: 30 }, (_, i) => ({
  id: `w${i}`,
  word: `w${i}`,
  books: ["daily"],
}));
const now = new Date(2026, 10, 25, 10).getTime();
const key = E.key(words[0].id, "recall");
let time = now;
const rate = (data, i, grade) =>
  S.validate(E.review(data, words[i], "recall", grade, (time += 1000)));
let data = rate(S.defaults(), 0, 2);
assert.equal(E.statistics(data, time).today, 0);
assert.equal(E.queue(data, words, time).practice.length, 1);
assert.equal(E.queue(data, words, time).items[0].id, "w1");
assert.equal(data.reinforcement[key].gap, 4);
for (let i = 1; i <= 4; i++) data = rate(data, i, 3);
assert.equal(E.queue(data, words, time).items[0].id, "w0");
const reps = data.cards[key].reps;
data = rate(data, 0, 3);
assert.equal(data.reinforcement[key], undefined);
assert.equal(data.cards[key].reps, reps);
assert.equal(E.statistics(data, time).today, 5);
assert.equal(E.statistics(data, time).newLearned, 5);
// Forgotten needs two spaced recalls, with an expanding second interval.
data = rate(S.defaults(), 0, 1);
assert.equal(data.reinforcement[key].required, 2);
assert.equal(data.reinforcement[key].gap, 2);
data = rate(data, 1, 3);
data = rate(data, 2, 3);
assert.equal(E.queue(data, words, time).items[0].id, "w0");
data = rate(data, 0, 3);
assert.equal(data.reinforcement[key].successes, 1);
assert.equal(data.reinforcement[key].gap, 6);
assert.equal(E.preview(data, words[0], "recall", 3, time).remaining, 0);
data = rate(data, 0, 2);
assert.equal(data.reinforcement[key].successes, 0);
assert.equal(data.reinforcement[key].required, 2);
assert(data.reinforcement[key].gap < 4);
data = rate(data, 0, 1);
assert.equal(data.reinforcement[key].successes, 0);
assert(data.reinforcement[key].gap < 2);
data = rate(data, 0, 3);
data = rate(data, 0, 3);
assert.equal(E.queue(data, [words[0]], time).items.length, 0);
assert.equal(E.statistics(data, time).today, 3);
assert.equal(data.cards[key].reps, 1);
assert.equal(data.cards[key].lapses, 0);
assert(Date.parse(data.cards[key].due) >= time + 86400000);
// Existing familiar words get more spacing; lower difficulty/fewer lapses help.
let mature = rate(S.defaults(), 0, 3);
mature.cards[key].stability = 30;
mature.cards[key].difficulty = 1;
mature.cards[key].lapses = 0;
assert.equal(E.preview(mature, words[0], "recall", 1, time).gap, 6);
assert.equal(E.preview(mature, words[0], "recall", 2, time).gap, 10);
const baseline = structuredClone(mature.cards[key]);
mature = rate(mature, 0, 2);
mature = rate(mature, 0, 1);
assert.equal(mature.cards[key].reps, baseline.reps + 1);
assert.equal(
  JSON.stringify(mature.cards[key]),
  JSON.stringify(
    E.schedule(baseline, 1, Date.parse(mature.reinforcement[key].firstAt)).card,
  ),
);
// Distinct successful other-word submissions advance only the matching mode.
data = rate(S.defaults(), 0, 1);
data = rate(data, 1, 1);
data = rate(data, 1, 1);
assert.equal(data.reinforcement[key].seen.length, 1);
data = S.validate(E.review(data, words[2], "spelling", 3, (time += 1000)));
assert.equal(data.reinforcement[key].seen.length, 1);
// Quota does not hide pending practice, including across midnight and modes.
data.settings.dailyTotal = 1;
assert(E.queue(data, words, time).items.some((w) => w.id === "w0"));
assert.equal(E.queue(data, words, time).fresh.length, 0);
assert.equal(E.queue(data, words, time + 86400000).fresh.length, 0);
assert(E.queue(data, words, time + 86400000).items.some((w) => w.id === "w0"));
data.settings.mode = "spelling";
assert.equal(E.queue(data, words, time).practice.length, 0);
data.settings.mode = "recall";
data.settings.book = "cet6";
assert.equal(E.queue(data, words, time).practice.length, 0);
data.settings.book = "daily";
// JSON/backup round-trip and legacy archives.
assert.equal(
  JSON.stringify(S.validateModule(S.find(S.attach({}, data)))),
  JSON.stringify(data),
);
assert.equal(S.validate(S.defaults()).reinforcement, undefined);
for (const mutate of [
  (d) => {
    d.reinforcement[key].gap = 0;
  },
  (d) => {
    d.reinforcement[key].successes = 2;
  },
  (d) => {
    d.reinforcement[key].seen = ["w1", "w1"];
  },
  (d) => {
    d.reinforcement[key].baseline = {};
  },
  (d) => {
    d.reinforcement[key].mode = "bad";
  },
  (d) => {
    d.logs[0].completed = 1;
  },
]) {
  const invalid = structuredClone(data);
  mutate(invalid);
  assert.throws(() => S.validate(invalid));
}
const tail = rate(S.defaults(), 0, 1);
assert.equal(E.queue(tail, [words[0]], time).items.length, 1);
assert.equal(E.queue(tail, [words[0]], time).early, true);
const nextDay = time + 86400000;
let carried = E.review(tail, words[0], "recall", 3, nextDay);
carried = S.validate(E.review(carried, words[0], "recall", 3, nextDay + 1000));
assert.equal(carried.reinforcement[key], undefined);
assert.equal(carried.cards[key].reps, tail.cards[key].reps);
assert(Date.parse(carried.cards[key].due) >= nextDay + 1000 + 86400000);
const alternatives = rate(tail, 1, 2);
assert.notEqual(
  E.queue(alternatives, words.slice(0, 2), time).items[0].id,
  "w1",
  "Tail alternates words when possible",
);
const hard = structuredClone(baseline);
hard.difficulty = 10;
hard.lapses = 10;
assert(E.familiarity(hard) < E.familiarity(baseline));
assert.equal(E.analysis(data, time).days.at(-1).fresh, 3);
console.log(
  "Vocabulary dynamic reinforcement, quota, persistence and long-term scheduling verified.",
);

async function browser() {
  require("./lib/browser-test-setup.cjs");
  const { chromium } = require("playwright");
  const { pathToFileURL } = require("node:url");
  const site =
    process.argv.find((arg, i) => i > 1 && !arg.startsWith("--")) || root;
  const instance = await chromium.launch({ headless: true });
  try {
    const page = await instance.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = () =>
      page.evaluate(() => WorkTimeApp.services.vocabularyStorage.read());
    const open = async () => {
      await page.goto(pathToFileURL(path.join(site, "index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#date-tab-tools").click();
      await page.locator("#vocabularyOpen").click();
      await page.locator(".vocabulary-recall-prompt").waitFor();
    };
    await page.goto(pathToFileURL(path.join(site, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(async () => {
      await WorkTimeApp.services.vocabularyIdle.load();
      WorkTimeApp.services.vocabularyIdle.configure({ enabled: false });
      const data = WorkTimeApp.services.vocabularyStorage.defaults();
      data.settings.dailyTotal = 3;
      data.settings.autoRead = false;
      await WorkTimeApp.services.vocabularyStorage.save(data);
    });
    await page.locator("#date-tab-tools").click();
    await page.locator("#vocabularyOpen").click();
    await page.locator(".vocabulary-recall-prompt").waitFor();
    const initial = await state();
    const firstId = initial.draft.id;
    const firstKey = "recall:" + firstId;
    await page.locator('[data-action="reveal"]:not(:disabled)').click();
    await page.locator('[data-grade="1"]:not(:disabled)').waitFor();
    const beforeGrade = await state();
    assert.equal(
      await page.locator('[data-grade="1"] small').innerText(),
      "隔约 2 词",
    );
    await page.evaluate(() => {
      const storage = WorkTimeApp.services.vocabularyStorage;
      window.reinforcementSave = storage.save;
      storage.save = async () => ({ persisted: false });
    });
    await page.locator('[data-grade="1"]').click();
    await page.getByRole("button", { name: "重试", exact: true }).waitFor();
    assert.deepEqual(
      await state(),
      beforeGrade,
      "Failed grading cannot advance practice or logs",
    );
    await page.evaluate(() => {
      WorkTimeApp.services.vocabularyStorage.save = window.reinforcementSave;
    });
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.waitForFunction((id) => {
      const data = WorkTimeApp.services.vocabularyStorage.read();
      return (
        data.logs.length === 1 &&
        data.draft?.id !== id &&
        !!document.querySelector(".vocabulary-recall-prompt")
      );
    }, firstId);
    assert.equal(
      await page.locator(".vocabulary-review-badge").innerText(),
      "3",
    );
    for (const count of [2, 3]) {
      await page.locator('[data-action="reveal"]:not(:disabled)').click();
      await page.locator('[data-grade="3"]:not(:disabled)').waitFor();
      await page.locator('[data-grade="3"]').click();
      await page.waitForFunction((n) => {
        const data = WorkTimeApp.services.vocabularyStorage.read();
        return (
          data.logs.length === n &&
          !data.draft?.revealed &&
          !!document.querySelector(".vocabulary-recall-prompt")
        );
      }, count);
    }
    assert.equal(
      (await state()).draft.id,
      firstId,
      "Forgotten word returns after two other words",
    );
    assert.equal(
      await page.locator(".vocabulary-review-badge").innerText(),
      "1",
    );
    await page.locator('[data-action="reveal"]:not(:disabled)').click();
    await page.locator('[data-grade="3"]:not(:disabled)').waitFor();
    assert.equal(
      await page.locator('[data-grade="3"] small').innerText(),
      "还需认识 1 次",
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page.evaluate(() => {
          const card = document.querySelector(".vocabulary-page");
          return card.scrollWidth <= card.clientWidth + 1;
        }),
        "Reinforcement UI fits on desktop/mobile",
      );
      await page.locator("#vocabularyPanel").screenshot({
        path: path.join(root, `.cache/vocabulary-reinforcement-${width}.png`),
      });
    }
    await page.locator('[data-grade="3"]').click();
    await page.waitForFunction(() => {
      const data = WorkTimeApp.services.vocabularyStorage.read();
      return (
        data.logs.length === 4 &&
        !data.draft?.revealed &&
        !!document.querySelector(".vocabulary-recall-prompt")
      );
    });
    const saved = await state();
    assert.equal(saved.reinforcement[firstKey].successes, 1);
    assert.equal(saved.cards[firstKey].reps, 1);
    await open();
    assert.deepEqual(
      (await state()).reinforcement,
      saved.reinforcement,
      "Reload preserves partially completed practice",
    );
    assert.equal((await state()).draft.id, firstId);
    await page.locator('[data-action="reveal"]:not(:disabled)').click();
    await page.locator('[data-grade="3"]:not(:disabled)').waitFor();
    assert.equal(
      await page.locator('[data-grade="3"] small').innerText(),
      "完成本轮巩固",
    );
    await page.locator('[data-grade="3"]').click();
    await page.locator(".vocabulary-hero").waitFor();
    const complete = await state();
    assert.equal(complete.reinforcement[firstKey], undefined);
    assert.equal(complete.logs.length, 5);
    assert.equal(complete.cards[firstKey].reps, 1);
    assert.equal(
      await page.locator(".vocabulary-review-badge").innerText(),
      "0",
    );
    assert.deepEqual(
      await page.locator(".vocabulary-stats strong").allTextContents(),
      ["3", "0", "3", "0"],
    );
    await page.keyboard.press("ArrowUp");
    await page
      .locator('[data-grade="3"].is-previous-choice:not(:disabled)')
      .waitFor();
    assert.deepEqual(
      (await state()).reinforcement,
      saved.reinforcement,
      "Undo restores all practice state",
    );
    await page.locator('[data-grade="3"]').click();
    await page.locator(".vocabulary-hero").waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "Offline browser: dynamic reinsertion, save retry, hidden answers, two recalls, reload, undo, unique counts and 1440/390 layouts passed.",
    );
  } finally {
    await instance.close();
  }
}
if (!process.argv.includes("--unit"))
  browser().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
