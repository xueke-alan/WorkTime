"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const entry = path.resolve(process.argv[2] || root, "index.html");
const output = path.join(root, "test-results/sudoku");
const key = "worktime.games.sudoku.v1";
const sandbox = vm.createContext({ WorkTimeApp: { games: {}, data: {} } });
for (const file of ["assets/data/sudoku.js", "assets/js/games/sudoku-rules.js"])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox);
const { data, games } = sandbox.WorkTimeApp;
const rules = games.sudokuRules;
const plain = (value) => JSON.parse(JSON.stringify(value));
function verifyBank() {
  assert.equal(data.sudoku.groups.length, 6);
  const seen = new Set();
  for (const group of data.sudoku.groups) {
    assert.ok(group.puzzles.length >= 10 && group.puzzles.length <= 30);
    let lastRating = 0;
    for (const puzzle of group.puzzles) {
      assert.equal(
        seen.has(puzzle.originalGivens || puzzle.givens),
        false,
        "distinct source puzzles",
      );
      seen.add(puzzle.originalGivens || puzzle.givens);
      assert.ok(puzzle.rating >= lastRating);
      lastRating = puzzle.rating;
      assert.deepEqual(
        plain(rules.solve(puzzle)),
        [puzzle.solution],
        puzzle.id + " unique solution",
      );
      const solved = {
        ...rules.create(puzzle),
        values: Array.from(puzzle.solution, Number),
      };
      assert.equal(rules.won(puzzle, solved), true);
      // Independently validate rows, columns, boxes and additional clues.
      for (let i = 0; i < 9; i++) {
        const row = solved.values.slice(i * 9, i * 9 + 9);
        const col = Array.from(
          { length: 9 },
          (_, j) => solved.values[j * 9 + i],
        );
        const box = Array.from(
          { length: 9 },
          (_, j) =>
            solved.values[
              (Math.floor(i / 3) * 3 + Math.floor(j / 3)) * 9 +
                ((i % 3) * 3 + (j % 3))
            ],
        );
        for (const unit of [row, col, box])
          assert.equal([...unit].sort().join(""), "123456789");
      }
      puzzle.parity?.forEach((value, i) => {
        if (value) assert.equal(solved.values[i] % 2, value === "o" ? 1 : 0);
      });
      for (const thermo of puzzle.thermos || []) {
        assert.ok(thermo.length >= 3);
        assert.equal(new Set(thermo).size, thermo.length);
        thermo.forEach((cell, i) => {
          if (i) {
            const previous = thermo[i - 1];
            assert.equal(
              Math.abs(Math.floor(cell / 9) - Math.floor(previous / 9)) +
                Math.abs((cell % 9) - (previous % 9)),
              1,
            );
            assert.ok(solved.values[cell] > solved.values[previous]);
          }
        });
      }
    }
  }
  const puzzle = data.sudoku.groups[0].puzzles[0],
    fresh = rules.create(puzzle),
    index = puzzle.givens.indexOf("0");
  assert.equal(rules.enter(puzzle, fresh, index, 4, true), true);
  assert.equal(fresh.notes[index], 8);
  assert.equal(
    rules.enter(puzzle, fresh, index, Number(puzzle.solution[index])),
    true,
  );
  assert.equal(fresh.notes[index], 0);
  rules.undo(fresh);
  assert.equal(fresh.notes[index], 8);
  assert.equal(fresh.values[index], 0);
  assert.ok(rules.restore(puzzle, plain(fresh)));
  assert.equal(rules.restore(puzzle, { ...plain(fresh), values: [] }), null);
  assert.equal(
    rules.restore(puzzle, { ...plain(fresh), elapsed: Infinity }),
    null,
  );
  assert.equal(
    rules.restore(puzzle, { ...plain(fresh), notes: Array(81).fill(512) }),
    null,
  );
  const given = puzzle.givens.split("").findIndex((n) => n !== "0");
  assert.equal(rules.enter(puzzle, fresh, given, 0), false);
  const peer = rules.peers[index].find((i) => fresh.values[i]);
  rules.enter(puzzle, fresh, index, fresh.values[peer]);
  assert.equal(rules.conflicts(puzzle, fresh)[index], true);
  for (const variant of [
    data.sudoku.groups[4].puzzles[0],
    data.sudoku.groups[5].puzzles[0],
  ]) {
    const values = Array(81).fill(0);
    if (variant.parity) {
      const cell = variant.parity.findIndex(Boolean);
      assert.equal(
        rules.allowed(
          values,
          cell,
          variant.parity[cell] === "o" ? 2 : 1,
          variant,
        ),
        false,
      );
    }
    if (variant.thermos) {
      const cells = variant.thermos[0];
      values[cells[0]] = 8;
      assert.equal(rules.allowed(values, cells[1], 7, variant), false);
    }
  }
}
async function main() {
  verifyBank();
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.addInitScript((key) => {
      const fixture = localStorage.getItem(key + ".fixture");
      if (fixture) {
        localStorage.setItem(key, fixture);
        localStorage.removeItem(key + ".fixture");
      }
    }, key);
    async function launch() {
      const url = pathToFileURL(entry).href;
      if (page.url() === url) {
        // Finish the old game's lifecycle before a new document consumes its
        // fixture; pagehide cleanup must not race the next document's storage.
        await page.locator("#gameExitButton").click();
        await page.waitForFunction(
          () => document.querySelector("#gameShell").dataset.state === "closed",
        );
      }
      if (page.url() === url) await page.reload();
      else await page.goto(url);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await page.locator("#date-tab-games").click();
      await page.locator('#gamesPanel [data-game="game-sudoku"]').click();
      await page.waitForFunction(
        () => document.querySelector("#gameShell").dataset.state === "open",
      );
      assert.equal(await page.locator("[data-game-error]").count(), 0);
    }
    const action = (id) => page.locator('[data-sudoku-action="' + id + '"]');
    async function menuAction(id) {
      if (
        !(await page.locator(".sudoku-options").getAttribute("open")) &&
        !(await page.locator(".sudoku-options").evaluate((el) => el.open))
      )
        await page.locator(".sudoku-options > summary").click();
      await action(id).click();
    }
    const saved = async () => {
      await page.waitForFunction((k) => localStorage.getItem(k) !== null, key);
      return page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
    };
    await launch();
    assert.equal(await page.locator(".sudoku-categories button").count(), 6);
    assert.equal(await page.locator(".sudoku-levels button").count(), 20);
    assert.equal(await action("level-2").isDisabled(), true);
    await page.screenshot({ path: path.join(output, "categories.png") });
    await action("level-1").click();
    const puzzle = data.sudoku.groups[0].puzzles[0],
      index = puzzle.givens.indexOf("0");
    const cell = page.locator('[data-cell="' + index + '"]');
    await cell.focus();
    await cell.press("n");
    await cell.press("4");
    assert.equal((await saved()).drafts[puzzle.id].notes[index], 8);
    await action("undo").click();
    assert.equal((await saved()).drafts[puzzle.id].notes[index], 0);
    await action("notes").click();
    await action("hint").click();
    assert.equal(
      (await saved()).drafts[puzzle.id].values[index],
      Number(puzzle.solution[index]),
    );
    assert.equal((await saved()).drafts[puzzle.id].hints, 1);
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 1213, height: 1021 },
      { width: 1280, height: 720 },
      { width: 900, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(
        () => document.querySelector(".game-sudoku").dataset.layout === "wide",
      );
      const board = await page.locator(".sudoku-board").boundingBox();
      const tools = await page.locator(".sudoku-tools").boundingBox();
      const keypad = await page.locator(".sudoku-keypad").boundingBox();
      const content = await page.locator(".game-content").boundingBox();
      assert.ok(Math.abs(board.width - board.height) < 1, "square board");
      assert.ok(
        tools.x >= board.x + board.width - 1,
        "tools grouped right of board",
      );
      assert.ok(keypad.x >= board.x + board.width - 1, "digits right of board");
      assert.ok(
        board.y + board.height <= content.y + content.height + 1,
        "board fits available height",
      );
      assert.ok(
        board.width >= Math.min(480, viewport.height * 0.55),
        "board uses available space",
      );
      await page.screenshot({
        path: path.join(output, "layout-" + viewport.width + ".png"),
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const geometry = await page.locator(".sudoku-board").boundingBox();
    await page.locator(".sudoku-options > summary").click();
    await page.locator("[data-game-help]").click();
    assert.equal(await page.locator(".game-help-screen").isVisible(), true);
    await page.locator("[data-game-help-close]").click();
    assert.deepEqual(
      await page.locator(".sudoku-board").boundingBox(),
      geometry,
    );
    await menuAction("restart");
    await action("cancel").click();
    assert.equal((await saved()).drafts[puzzle.id].hints, 1);
    await action("pause").click();
    const paused = (await saved()).drafts[puzzle.id].elapsed;
    await page.waitForTimeout(1200);
    assert.equal((await saved()).drafts[puzzle.id].elapsed, paused);
    await action("accept").click();
    await page.waitForTimeout(1100);
    assert.ok((await saved()).drafts[puzzle.id].elapsed > paused);
    await menuAction("choose");
    await action("parity").click();
    await action("level-1").click();
    assert.ok(
      (await page.locator('.sudoku-cell[data-parity="o"]').count()) > 0,
    );
    await menuAction("choose");
    await action("thermo").click();
    await action("level-1").click();
    assert.ok((await page.locator(".sudoku-thermos polyline").count()) > 0);
    await page.screenshot({ path: path.join(output, "thermometer.png") });
    await menuAction("choose");
    await action("easy").click();
    await action("level-1").click();
    assert.equal(
      (await saved()).drafts[puzzle.id].values[index],
      Number(puzzle.solution[index]),
    );
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
      await page.evaluate(
        (lang) => WorkTimeApp.i18n.setLanguage(lang),
        language,
      );
      assert.equal(
        await page
          .locator(".game-sudoku")
          .innerText()
          .then((s) => s.includes("games.sudoku.")),
        false,
      );
      const translations = await page.evaluate(() =>
        Object.fromEntries(
          Object.entries(WorkTimeApp.data.locales).map(([lang, catalog]) => [
            lang,
            Object.entries(catalog).filter(([k]) =>
              k.startsWith("games.sudoku."),
            ),
          ]),
        ),
      );
      for (const entries of Object.values(translations)) {
        assert.equal(entries.length, 43);
        assert.ok(entries.every(([, v]) => typeof v === "string" && v.length));
      }
    }
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      // The shell and game size are delivered by ResizeObserver. Viewport
      // resizing can resolve before that callback has selected compact layout.
      await page.waitForFunction(() => {
        const game = document.querySelector(".game-sudoku"),
          board = document
            .querySelector(".sudoku-board")
            .getBoundingClientRect();
        return (
          game.dataset.layout === "compact" &&
          board.x >= 0 &&
          board.right <= innerWidth + 1
        );
      });
      const bounds = await page.locator(".sudoku-board").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      assert.equal(
        await page
          .locator(".game-content")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        true,
      );
      await page.screenshot({
        path: path.join(output, "mobile-" + width + ".png"),
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Complete through a normal final keypress, verify unlocking and replay records.
    await page.evaluate(
      ({ key, id, solution, index }) => {
        const save = JSON.parse(localStorage.getItem(key));
        save.current = id;
        save.group = "easy";
        save.drafts[id].values = Array.from(solution, Number);
        save.drafts[id].values[index] = 0;
        save.drafts[id].notes = Array(81).fill(0);
        localStorage.setItem(key + ".fixture", JSON.stringify(save));
      },
      { key, id: puzzle.id, solution: puzzle.solution, index },
    );
    await launch();
    await action("accept").click();
    const last = index;
    await page.locator('[data-cell="' + last + '"]').focus();
    await page
      .locator('[data-cell="' + last + '"]')
      .press(puzzle.solution[last]);
    assert.equal(
      await page.locator(".sudoku-cover h3").textContent(),
      "本关完成！",
    );
    assert.ok((await saved()).completed[puzzle.id]);
    await menuAction("choose");
    assert.equal(await action("level-2").isEnabled(), true);
    await action("level-1").click();
    await menuAction("restart");
    await action("accept").click();
    await launch();
    assert.ok((await saved()).completed[puzzle.id]);
    await menuAction("choose");
    assert.equal(await action("level-2").isEnabled(), true);
    assert.deepEqual(errors, []);
    await page.locator("#gameExitButton").click();
    await page.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "closed",
    );
    const before = await saved();
    await page.waitForTimeout(1100);
    assert.deepEqual(await saved(), before);
    // Corrupt saves and unavailable storage must still launch safely.
    await page.evaluate(
      (k) =>
        localStorage.setItem(
          k,
          '{"version":1,"drafts":{"easy-1":{"values":[]}}}',
        ),
      key,
    );
    await page.locator('#gamesPanel [data-game="game-sudoku"]').click();
    assert.equal(await page.locator(".sudoku-catalog").isVisible(), true);
    await context.close();
    const blocked = await browser.newContext({ reducedMotion: "reduce" });
    const noStorage = await blocked.newPage();
    await noStorage.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw Error("blocked");
      };
      Storage.prototype.setItem = () => {
        throw Error("blocked");
      };
    });
    await noStorage.route(/^https?:/, (route) => route.abort());
    await noStorage.goto(pathToFileURL(entry).href);
    await noStorage.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await noStorage.locator("#date-tab-games").click();
    await noStorage.locator('[data-game="game-sudoku"]').click();
    await noStorage.locator('[data-sudoku-action="level-1"]').click();
    await noStorage.locator('[data-sudoku-action="hint"]').click();
    assert.equal(await noStorage.locator("[data-game-error]").count(), 0);
    assert.ok(
      (await noStorage.locator(".sudoku-feedback").textContent()).length > 0,
    );
    await blocked.close();
    console.log(
      "Sudoku: 120 unique solutions, variant constraints, input, undo, drafts, progression, replay, pause, help, six languages, mobile, unavailable storage and offline loading verified.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
