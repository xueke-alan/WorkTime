"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const key = "worktime.games.sliding-puzzle.v1";
const context = vm.createContext({
  WorkTimeApp: { games: {}, services: {} },
  window: { navigator: {} },
  TextEncoder,
});
for (const file of ["games/sliding-puzzle-rules", "services/game-archive"])
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/js", file + ".js"), "utf8"),
    context,
  );
const rules = context.WorkTimeApp.games.slidingPuzzleRules;
assert.deepEqual(Array.from(rules.sizes), [3, 4, 5, 6, 7]);
const archive = context.WorkTimeApp.services.gameArchive;
const clone = (v) => JSON.parse(JSON.stringify(v));
function fixture(size) {
  const board = Array.from(
    { length: size * size },
    (_, i) => (i + 1) % (size * size),
  );
  [board[board.length - 1], board[board.length - 2]] = [
    board[board.length - 2],
    board[board.length - 1],
  ];
  return {
    version: 1,
    size,
    sessions: {
      [size]: {
        initial: [...board],
        board,
        history: [],
        elapsed: 0,
        started: false,
        awarded: false,
      },
    },
    best: {},
  };
}
for (const size of rules.sizes) {
  for (let n = 0; n < 100; n++) {
    const state = rules.create(size);
    assert(
      rules.valid(state.board, size) &&
        rules.solvable(state.board, size) &&
        !rules.solved(state.board),
    );
  }
  const save = fixture(size),
    state = save.sessions[size];
  assert(!rules.move(state, 0, size));
  assert(!rules.adjacent(size - 1, size, size));
  assert(rules.move(state, size * size - 1, size));
  assert(rules.solved(state.board));
  state.awarded = true;
  save.best[size] = { moves: 1, time: 0 };
  assert(rules.restore(save));
  assert(rules.undo(state));
  assert.deepEqual(clone(state.board), state.initial);
  assert.equal(rules.restart(state).elapsed, 0);
  const bad = clone(save);
  bad.sessions[size].board[0] = 0;
  assert.equal(rules.restore(bad), null);
  const badHistory = fixture(size);
  badHistory.sessions[size].history = [0];
  assert.equal(rules.restore(badHistory), null);
}
const a = fixture(4),
  b = fixture(4);
// Removed menu sizes must not invalidate earlier progress or records.
for (const size of [8, 9]) {
  const legacy = fixture(size);
  legacy.sessions[4] = fixture(4).sessions[4];
  legacy.best[size] = { moves: 20, time: 900 };
  assert.deepEqual(clone(rules.restore(legacy)), legacy);
}
rules.move(a.sessions[4], 10, 4);
a.sessions[4].elapsed = 2000;
b.best[4] = { moves: 20, time: 900 };
a.best[4] = { moves: 10, time: 2000 };
const merged = archive.merge("game-sliding-puzzle", a, b).value;
assert.equal(merged.best[4].moves, 10);
assert.equal(merged.best[4].time, 900);
assert.equal(merged.sessions[4].history.length, 1);
const memory = new Map();
const storage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => memory.set(k, v),
  removeItem: (k) => memory.delete(k),
};
const owner = archive.create(() => storage);
owner.session().setItem(key, JSON.stringify(a));
assert(owner.exportArchive().games["game-sliding-puzzle"]);
assert.equal(owner.progressSummary("game-sliding-puzzle").kind, "completed");
// Recovery journals written before this game existed remain recoverable.
const raw = owner.read().raw;
delete raw["game-sliding-puzzle"];
storage.setItem(
  archive.JOURNAL,
  JSON.stringify({ version: 1, revision: "old", before: raw }),
);
owner.recover();
assert(!owner.pendingRecovery());
async function main() {
  const exported = owner.exportArchive();
  assert.deepEqual(
    clone(await archive.decode(await archive.encode(exported))),
    clone(exported),
  );
  const imported = archive.create(() => {
    const values = new Map();
    return {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
      removeItem: (k) => values.delete(k),
    };
  });
  assert.equal(imported.preview(exported).rows[0].status, "added");
  await owner.replace({ ...exported, games: {} }, async () => ({
    persisted: true,
  }));
  assert.equal(storage.getItem(key), null);
  owner.commit(owner.preview(exported));
  assert.equal(
    owner.read().games["game-sliding-puzzle"].sessions[4].elapsed,
    2000,
  );
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const browserContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1280, height: 1000 },
    });
    const page = await browserContext.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/^https?:/, (route) => route.abort());
    const entry = pathToFileURL(
      path.resolve(process.argv[2] || root, "index.html"),
    ).href;
    await page.goto(entry);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(
      ({ key, save }) => localStorage.setItem(key, JSON.stringify(save)),
      { key, save: fixture(4) },
    );
    await launchGame(page, "game-sliding-puzzle");
    const read = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const board = page.locator(".sliding-board");
    const chooseSize = async (size) => {
      await page.locator("#slidingSizeTrigger").click();
      await page
        .locator(`#slidingSizeOptions [data-game-option="${size}"]`)
        .click();
    };
    assert.equal(await page.locator(".sliding-select option").count(), 5);
    await board.focus();
    assert.equal(
      await board.evaluate((el) => getComputedStyle(el).outlineStyle),
      "none",
    );
    const movable = page.locator('.sliding-tile[data-movable="true"]').first();
    const restingColor = await movable.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await movable.hover();
    await page.waitForTimeout(180);
    assert.notEqual(
      await movable.evaluate((el) => getComputedStyle(el).backgroundColor),
      restingColor,
    );
    assert.notEqual(
      await movable.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(255, 255, 255)",
    );
    await board.focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(180);
    assert.equal((await read()).sessions[4].history.length, 1);
    // Time advances after a move, and stops during confirmation.
    await page.waitForTimeout(1100);
    await page.locator('[data-sliding-action="restart"]').click();
    const elapsed = (await read()).sessions[4].elapsed;
    await page.waitForTimeout(1100);
    assert((await read()).sessions[4].elapsed - elapsed < 150);
    await page.locator('[data-sliding-action="cancel"]').click();
    await page.locator('[data-sliding-action="undo"]').click();
    assert.equal((await read()).sessions[4].history.length, 0);
    // A pointer swipe produces exactly one move, including its synthetic click.
    await board.evaluate((el) => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          clientX: 100,
          clientY: 100,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 1,
          clientX: 100,
          clientY: 150,
          bubbles: true,
        }),
      );
      el.querySelector("button").click();
    });
    await page.waitForTimeout(180);
    assert.equal((await read()).sessions[4].history.length, 1);
    await page.locator('[data-sliding-action="undo"]').click();
    await page.waitForTimeout(420);
    await page.locator('[data-tile="15"]').click();
    assert(!(await page.locator(".sliding-cover").isVisible()));
    await page.locator(".game-celebration-ribbons").waitFor();
    assert(!(await page.locator(".sliding-cover").isVisible()));
    await page
      .locator(".game-celebration-ribbons")
      .waitFor({ state: "detached" });
    await page.locator(".sliding-cover").waitFor();
    await page.waitForTimeout(420);
    assert.equal(
      await page
        .locator(".sliding-cover")
        .evaluate((el) => getComputedStyle(el).opacity),
      "1",
    );
    assert.equal((await read()).best[4].moves, 1);
    await page.locator('[data-sliding-action="accept"]').click();
    // Switching sizes discards the previous game but keeps its best record.
    await page.locator('.sliding-tile[data-movable="true"]').first().click();
    await page.waitForTimeout(180);
    assert.equal((await read()).sessions[4].history.length, 1);
    const previousBest = (await read()).best;
    await chooseSize(3);
    assert.deepEqual(Object.keys((await read()).sessions), ["3"]);
    await chooseSize(4);
    const fresh = await read();
    assert.deepEqual(Object.keys(fresh.sessions), ["4"]);
    assert.equal(fresh.sessions[4].history.length, 0);
    assert.equal(fresh.sessions[4].elapsed, 0);
    assert.equal(fresh.sessions[4].started, false);
    assert.deepEqual(fresh.best, previousBest);
    assert(await page.locator('[data-sliding-action="undo"]').isDisabled());
    for (const size of rules.sizes) {
      await chooseSize(size);
      assert.equal(
        await page.locator(".sliding-tile").count(),
        size * size - 1,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(root, "test-results/sliding-puzzle/mobile-7.png"),
      fullPage: false,
    });
    const bounds = await board.boundingBox();
    assert(bounds.width <= 390);
    assert.equal(
      await page.locator(".sliding-select option").last().textContent(),
      "7 × 7 · 大师模式",
    );
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.waitForTimeout(700);

    await launchGame(page, "game-sliding-puzzle");
    assert.equal(await page.locator(".sliding-tile").count(), 48);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const language of ["en", "ja", "ko", "zh-TW", "zh-HK", "zh-CN"]) {
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      assert.equal(await page.locator(".sliding-help").count(), 0);
      assert.equal(await page.locator(".sliding-stats .game-stat").count(), 3);
      assert.equal(
        await page.locator(".sliding-actions > .game-icon-button").count(),
        3,
      );
    }
    await page.screenshot({
      path: path.join(root, "test-results/sliding-puzzle/desktop.png"),
      fullPage: false,
    });
    assert(
      await page.evaluate(
        async ({ key, save }) => {
          const service = WorkTimeApp.services.gameArchive,
            original = service.session;
          let saved = JSON.stringify(save),
            denied = false;
          const host = document.createElement("div");
          host.className = "game-content";
          document.body.append(host);
          const abort = new AbortController();
          service.session = () => ({
            getItem: () => saved,
            setItem: (storageKey, value) => {
              if (denied) throw Error("unavailable");
              if (storageKey === key) saved = value;
            },
          });
          let instance;
          try {
            instance = WorkTimeApp.games
              .get("game-sliding-puzzle")
              .create({ container: host, signal: abort.signal });
            host.querySelector('[data-tile="11"]').click();
            await new Promise((resolve) => setTimeout(resolve, 350));
            instance.pause();
            const before = JSON.parse(saved).sessions[4].elapsed;
            await new Promise((resolve) => setTimeout(resolve, 350));
            instance.pause();
            const after = JSON.parse(saved).sessions[4].elapsed;
            if (before !== after || before < 300) return false;
            instance.resume();
            await new Promise((resolve) => setTimeout(resolve, 350));
            instance.pause();
            if (JSON.parse(saved).sessions[4].elapsed < after + 300)
              return false;
            denied = true;
            await new Promise((resolve) => setTimeout(resolve, 1100));
            return (
              host.querySelector(".sliding-warning").textContent.length > 0
            );
          } finally {
            abort.abort();
            instance?.dispose();
            service.session = original;
            host.remove();
          }
        },
        { key, save: fixture(4) },
      ),
    );
    for (const scenario of ["reduced", "pause", "dispose"]) {
      await page.emulateMedia({
        reducedMotion: scenario === "reduced" ? "reduce" : "no-preference",
      });
      assert(
        await page.evaluate(
          async ({ save, scenario }) => {
            const service = WorkTimeApp.services.gameArchive,
              original = service.session;
            const host = document.createElement("div");
            host.className = "game-content";
            Object.assign(host.style, {
              position: "fixed",
              inset: "0",
              zIndex: "10001",
              overflow: "auto",
            });
            document.body.append(host);
            const abort = new AbortController();
            service.session = () => ({
              getItem: () => JSON.stringify(save),
              setItem() {},
            });
            let instance;
            try {
              instance = WorkTimeApp.games
                .get("game-sliding-puzzle")
                .create({ container: host, signal: abort.signal });
              host.querySelector('[data-tile="15"]').click();
              await new Promise((resolve) => setTimeout(resolve, 250));
              const cover = host.querySelector(".sliding-cover");
              if (scenario === "reduced")
                return (
                  !cover.hidden && !document.querySelector(".game-celebration")
                );
              if (!document.querySelector(".game-celebration") || !cover.hidden)
                return false;
              if (scenario === "pause") {
                instance.pause();
                instance.resume();
              } else abort.abort();
              await new Promise((resolve) => setTimeout(resolve, 50));
              return (
                !document.querySelector(".game-celebration") &&
                (scenario === "dispose" || !cover.hidden)
              );
            } finally {
              abort.abort();
              instance?.dispose();
              service.session = original;
              host.remove();
            }
          },
          { save: fixture(4), scenario },
        ),
        scenario,
      );
    }
    // All runtime catalogs contain translated names and instructions.
    assert(
      await page.evaluate(async () => {
        for (const language of ["en", "ja", "ko", "zh-TW", "zh-HK"])
          await WorkTimeApp.services.assets.script(
            "assets/js/locales/runtime/" + language + ".js",
          );
        return Object.values(WorkTimeApp.data.locales).every(
          (c) => c["games.sliding.name"] && c["games.sliding.help"],
        );
      }),
    );
    assert.deepEqual(errors, []);
    await browserContext.close();
    console.log(
      "Sliding puzzle: five sizes, legacy saves, hover, solvability, undo, archive, keyboard, swipe, timer, victory, mobile and offline persistence verified.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
