"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const entry = path.resolve(process.argv[2] || root, "index.html");
const output = path.join(root, "test-results/sokoban");
const key = "worktime.games.sokoban.v1";
const context = vm.createContext({ WorkTimeApp: { games: {}, data: {} } });
for (const file of [
  "assets/data/sokoban.js",
  "assets/js/games/sokoban-rules.js",
])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const bank = context.WorkTimeApp.data.sokoban;
const rules = context.WorkTimeApp.games.sokobanRules;
function verifyRules() {
  const source = fs.readFileSync(
    path.join(root, "assets/data/sources/microban.txt"),
    "utf8",
  );
  assert.equal(
    crypto.createHash("sha256").update(source).digest("hex"),
    bank.sha256,
  );
  const blocks = source.split(/^;[ \t]*(\d+)[^\r\n]*\r?\n/m);
  const originals = new Map();
  for (let i = 1; i < blocks.length; i += 2)
    originals.set(
      Number(blocks[i]),
      blocks[i + 1]
        .split(/\r?\n/)
        .filter((line) => line.includes("#"))
        .map((line) => line.trimEnd()),
    );
  assert.equal(bank.levels.length, 60);
  assert.equal(new Set(bank.levels.map((level) => level.id)).size, 60);
  bank.levels.forEach((level, index) => {
    assert.deepEqual(
      Array.from(level.rows),
      originals.get(level.sourceNumber),
      "original geometry",
    );
    if (index) assert.ok(level.minPushes >= bank.levels[index - 1].minPushes);
    const map = rules.parse(level),
      state = rules.create();
    for (const direction of level.solution)
      assert.equal(
        rules.move(map, state, direction),
        true,
        level.id + " solution move",
      );
    assert.ok(rules.won(map, state), level.id + " solvable");
    assert.equal(state.pushes, level.minPushes);
    const restored = rules.restore(map, { path: state.path });
    assert.ok(restored && rules.won(map, restored));
    rules.undo(state);
    assert.equal(rules.won(map, state), false);
    assert.equal(rules.move(map, state, level.solution.at(-1)), true);
  });
  const map = rules.parse({
    rows: ["#######", "#  .  #", "#  $@ #", "#######"],
  });
  const state = rules.create();
  assert.equal(rules.move(map, state, "d"), false, "wall blocks movement");
  assert.equal(state.moves, 0);
  assert.equal(rules.move(map, state, "l"), true);
  assert.equal(rules.move(map, state, "l"), true);
  assert.equal(rules.deadlocked(map, state), true, "wall corner detected");
  rules.undo(state);
  assert.equal(rules.deadlocked(map, state), false);
  const blocked = rules.parse({
    rows: ["#######", "# . . #", "# $$@ #", "#######"],
  });
  assert.equal(
    rules.move(blocked, rules.create(), "l"),
    false,
    "cannot push two boxes",
  );
  assert.equal(
    rules.restore(map, { path: "d" }),
    null,
    "reject illegal replay",
  );
  assert.equal(rules.restore(map, { path: "xyz" }), null);
  assert.equal(rules.restore(map, { path: "l".repeat(20001) }), null);
  assert.throws(() => rules.parse({ rows: ["@$."] }), /boundary/);
}
async function main() {
  verifyRules();
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const session = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    const page = await session.newPage(),
      errors = [];
    await page.addInitScript((key) => {
      const fixture = localStorage.getItem(key + ".fixture");
      if (fixture) {
        localStorage.setItem(key, fixture);
        localStorage.removeItem(key + ".fixture");
      }
    }, key);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    const action = (name) =>
      page.locator('[data-sokoban-action="' + name + '"]');
    const board = page.locator(".sokoban-board");
    const saved = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    async function launch() {
      const url = pathToFileURL(entry).href;
      if (page.url() === url) {
        await page.locator("#gameExitButton").click();
        await page.waitForFunction(
          () => document.querySelector("#gameShell").dataset.state === "closed",
        );
        await page.reload();
      } else await page.goto(url);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await page.locator("#date-tab-games").click();
      await page.locator('#gamesPanel [data-game="game-sokoban"]').click();
      await page
        .locator('#gamesPanel [data-game="game-sokoban"]')
        .locator('xpath=ancestor::div[contains(@class,"game-library")]')
        .locator(".game-menu-play")
        .click();
      await page.waitForFunction(
        () => document.querySelector("#gameShell").dataset.state === "open",
      );
      assert.equal(await page.locator("[data-game-error]").count(), 0);
    }
    await launch();
    assert.equal(await page.locator(".sokoban-levels button").count(), 20);
    assert.equal(await action("level-1").isDisabled(), true);
    await action("chapter-2").click();
    assert.equal(await action("level-0").isDisabled(), true);
    await action("chapter-0").click();
    await page.screenshot({ path: path.join(output, "levels-desktop.png") });
    await action("level-0").click();
    assert.equal(await page.locator(".sokoban-status").innerText(), "");
    assert.equal(
      await page.locator(".sokoban-keyboard-hint, .sokoban-source").count(),
      0,
    );
    const before = await board.boundingBox();
    assert.ok(before.width >= 300, "intro board is large enough to read");
    assert.equal(
      await action("next").isVisible(),
      false,
      "next appears on completion",
    );
    assert.equal(
      await page.locator(".sokoban-directions").isVisible(),
      false,
      "desktop uses keyboard guidance",
    );
    await page.screenshot({ path: path.join(output, "intro-desktop.png") });
    await board.press("ArrowRight");
    assert.equal((await saved()).drafts[bank.levels[0].id].path, "r");
    assert.ok((await saved()).completed[bank.levels[0].id]);
    assert.equal(await action("next").isDisabled(), false);
    assert.equal(await action("next").isVisible(), true);
    assert.ok(
      await page.locator(".sokoban-box").evaluateAll((pieces) =>
        pieces.every((piece) => {
          const bounds = piece.getBoundingClientRect();
          return Math.abs(bounds.width - bounds.height) < 1;
        }),
      ),
      "goal icons keep crates square",
    );
    await page.screenshot({ path: path.join(output, "complete-desktop.png") });
    assert.deepEqual(
      await board.boundingBox(),
      before,
      "status keeps board stationary",
    );
    await action("undo").click();
    assert.equal((await saved()).drafts[bank.levels[0].id].path, "");
    assert.ok(
      (await saved()).completed[bank.levels[0].id],
      "undo keeps earned completion",
    );
    await board.press("ArrowRight");
    await action("next").click();
    const level = bank.levels[1],
      first = level.solution[0];
    await board.press(
      { u: "ArrowUp", r: "ArrowRight", d: "ArrowDown", l: "ArrowLeft" }[first],
    );
    const draft = (await saved()).drafts[level.id].path;
    await action("restart").click();
    await action("cancel").press("Tab");
    assert.equal(
      await action("reset").evaluate(
        (element) => document.activeElement === element,
      ),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal((await saved()).drafts[level.id].path, draft);
    await page.locator("[data-game-help]").click();
    assert.ok(
      (await page.locator(".game-help-screen").innerText()).includes(
        "David W. Skinner",
      ),
      "credit remains in help",
    );
    await page.keyboard.press("ArrowRight");
    assert.equal((await saved()).drafts[level.id].path, draft);
    await page.locator("[data-game-help-close]").click();
    await launch();
    assert.equal(
      (await saved()).current,
      level.id,
      "refresh resumes current level",
    );
    assert.equal((await saved()).drafts[level.id].path, draft);
    await action("restart").click();
    await action("reset").click();
    assert.equal((await saved()).drafts[level.id].path, "");
    const swipeDirection = level.solution[0];
    const touch = await session.newCDPSession(page);
    const touchBounds = await board.boundingBox();
    const x = touchBounds.x + touchBounds.width / 2,
      y = touchBounds.y + touchBounds.height / 2;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x:
            x +
            (swipeDirection === "r" ? 40 : swipeDirection === "l" ? -40 : 0),
          y:
            y +
            (swipeDirection === "d" ? 40 : swipeDirection === "u" ? -40 : 0),
        },
      ],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal((await saved()).drafts[level.id].path, swipeDirection);
    // Six translations, themes and narrow layout use the real offline app.
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      assert.ok(
        !(await page.locator(".game-sokoban").innerText()).includes(
          "games.sokoban.",
        ),
      );
    }
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    const colors = new Set();
    for (const theme of [
      "green",
      "blue",
      "purple",
      "orange",
      "rose",
      "slate",
      "cyan",
      "mint",
      "olive",
      "gold",
      "red",
      "brown",
    ]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      colors.add(
        await page
          .locator(".sokoban-cell.is-wall")
          .first()
          .evaluate((element) => getComputedStyle(element).color),
      );
    }
    assert.ok(colors.size > 5, "board pieces follow the site themes");
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "green"),
    );
    await page.screenshot({ path: path.join(output, "board-desktop.png") });
    await page
      .locator(".sokoban-stage")
      .screenshot({ path: path.join(output, "artwork-preview.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await page.waitForFunction(() =>
      document
        .querySelector("#gameShell")
        .classList.contains("game-shell-compact"),
    );
    const bounds = await board.boundingBox();
    assert.equal(
      await page.locator(".sokoban-directions").isVisible(),
      true,
      "touch has direction buttons",
    );
    for (const name of ["u", "r", "d", "l"]) {
      const buttonBounds = await action(name).boundingBox();
      assert.ok(
        buttonBounds.width >= 44 && buttonBounds.height >= 44,
        "touch targets are at least 44px",
      );
    }
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= 390,
      "board fits phone",
    );
    assert.equal(
      await page
        .locator(".game-content")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
      false,
      "game has no horizontal overflow",
    );
    await page.screenshot({
      path: path.join(output, "board-phone.png"),
    });
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const language of ["en", "ja", "ko", "zh-CN"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        assert.ok(
          await page
            .locator(".game-sokoban")
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
          "translated controls fit narrow screens",
        );
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // Exercise the last-level completion and all chapters using verified replays.
    const fixture = {
      version: 1,
      chapter: 2,
      current: bank.levels.at(-1).id,
      completed: Object.fromEntries(
        bank.levels
          .slice(0, -1)
          .map((level) => [level.id, { path: level.solution }]),
      ),
      drafts: {
        [bank.levels.at(-1).id]: {
          path: bank.levels.at(-1).solution.slice(0, -1),
        },
      },
    };
    await page.evaluate(
      ({ key, fixture }) =>
        localStorage.setItem(key + ".fixture", JSON.stringify(fixture)),
      { key, fixture },
    );
    await launch();
    await board.press(
      { u: "ArrowUp", r: "ArrowRight", d: "ArrowDown", l: "ArrowLeft" }[
        bank.levels.at(-1).solution.at(-1)
      ],
    );
    assert.equal(Object.keys((await saved()).completed).length, 60);
    assert.ok(
      (await page.locator(".sokoban-status").innerText()).includes("60"),
    );
    await action("next").click();
    assert.equal(
      await page.locator(".sokoban-levels .is-complete").count(),
      20,
    );
    // Invalid storage does not grant unlocks or break startup.
    await page.evaluate(
      (key) =>
        localStorage.setItem(
          key + ".fixture",
          JSON.stringify({
            version: 1,
            current: "microban-999",
            drafts: {},
            completed: { "microban-44": { path: "BAD" } },
          }),
        ),
      key,
    );
    await launch();
    assert.equal(await action("level-1").isDisabled(), true);
    await page.evaluate(
      (key) => localStorage.setItem(key + ".fixture", "broken json"),
      key,
    );
    await launch();
    assert.ok((await page.locator(".sokoban-warning").innerText()).length);
    await page.screenshot({ path: path.join(output, "storage-warning.png") });
    // Native animation tracks are paused and sampled to check actual geometry.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await action("level-0").click();
    const tracks = await board.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      const tracks = element.getAnimations({ subtree: true });
      tracks.forEach((track) => {
        track.pause();
        track.currentTime = 60;
      });
      return tracks.map((track) => ({
        piece: track.effect.target.dataset.piece,
        frames: track.effect.getKeyframes().map((frame) => frame.transform),
        duration: track.effect.getTiming().duration,
        offset: new DOMMatrixReadOnly(
          getComputedStyle(track.effect.target).transform,
        ).m41,
      }));
    });
    assert.equal(tracks.length, 2, "player and pushed box animate together");
    assert.deepEqual(tracks.map((track) => track.piece).sort(), [
      "box-0",
      "player",
    ]);
    assert.ok(
      tracks.every(
        (track) =>
          track.duration === 120 && track.offset < -1 && track.offset > -60,
      ),
    );
    assert.deepEqual(
      tracks[0].frames,
      tracks[1].frames,
      "push tracks have matching displacement",
    );
    await board.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", bubbles: true }),
      );
      element
        .getAnimations({ subtree: true })
        .forEach((track) => track.finish());
    });
    await page.waitForFunction(
      (key) =>
        JSON.parse(localStorage.getItem(key)).drafts["microban-44"].path === "",
      key,
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length === 0,
    );
    await board.evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () =>
        document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length === 0,
    );
    await action("undo").click();
    assert.equal(
      await board.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
      0,
      "reduced motion skips movement tracks",
    );
    await board.press("ArrowRight");
    await action("next").click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const burst = bank.levels[1].solution.slice(0, 8);
    await board.evaluate((element, burst) => {
      const keys = {
        r: "ArrowRight",
        l: "ArrowLeft",
        u: "ArrowUp",
        d: "ArrowDown",
      };
      for (const direction of burst)
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: keys[direction], bubbles: true }),
        );
    }, burst);
    await page.waitForFunction(
      ({ key, id, burst }) =>
        JSON.parse(localStorage.getItem(key)).drafts[id].path === burst,
      { key, id: bank.levels[1].id, burst },
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length === 0,
    );
    // Help, resize and exit settle the current step and discard unplayed input.
    await board.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      element
        .getAnimations({ subtree: true })
        .forEach((track) => track.pause());
    });
    await page.locator("[data-game-help]").click();
    assert.equal(
      await board.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
      0,
    );
    await page.locator("[data-game-help-close]").click();
    await board.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", bubbles: true }),
      );
      element
        .getAnimations({ subtree: true })
        .forEach((track) => track.pause());
    });
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForFunction(
      () =>
        document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length === 0,
    );
    await board.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", bubbles: true }),
      );
      element
        .getAnimations({ subtree: true })
        .forEach((track) => track.pause());
    });
    await page.locator("#gameExitButton").click();
    await page.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "closed",
    );
    assert.equal(await page.locator(".sokoban-player").count(), 0);
    assert.deepEqual(errors, []);
    const noStorage = await session.newPage();
    await noStorage.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw Error("disabled");
      };
      Storage.prototype.getItem = () => {
        throw Error("disabled");
      };
    });
    await noStorage.goto(pathToFileURL(entry).href);
    await noStorage.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await noStorage.locator("#date-tab-games").click();
    await noStorage.locator('[data-game="game-sokoban"]').click();
    await noStorage
      .locator('[data-game="game-sokoban"]')
      .locator('xpath=ancestor::div[contains(@class,"game-library")]')
      .locator(".game-menu-play")
      .click();
    await noStorage.locator('[data-sokoban-action="level-0"]').click();
    await noStorage.locator(".sokoban-board").press("ArrowRight");
    assert.equal(
      await noStorage.locator('[data-sokoban-action="next"]').isDisabled(),
      false,
    );
    assert.ok((await noStorage.locator(".sokoban-warning").innerText()).length);
    console.log(
      "Sokoban: 60 source puzzles and solutions, rules, unlocks, saves, undo, restart, keyboard, touch, six languages, responsive layout and storage failures verified: " +
        entry,
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
