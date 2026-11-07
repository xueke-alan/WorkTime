"use strict";
const { launchGame } = require("./game-test-helpers.cjs");
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
const groupById = (id) => data.sudoku.groups.find((group) => group.id === id);
function verifyBank() {
  assert.equal(data.sudoku.groups.length, 16);
  const seen = new Set();
  for (const group of data.sudoku.groups) {
    assert.equal(group.puzzles.length, 20);
    let lastRating = 0;
    for (const puzzle of group.puzzles) {
      assert.equal(
        seen.has(
          puzzle.originalGivens ||
            (group.source === "worktime"
              ? JSON.stringify(puzzle)
              : puzzle.givens),
        ),
        false,
        "distinct source puzzles",
      );
      seen.add(
        puzzle.originalGivens ||
          (group.source === "worktime"
            ? JSON.stringify(puzzle)
            : puzzle.givens),
      );
      if (puzzle.rating !== undefined) {
        assert.ok(puzzle.rating >= lastRating);
        lastRating = puzzle.rating;
      }
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
      if (puzzle.skyscrapers) {
        assert.equal(rules.solve({ givens: puzzle.givens }).length, 2);
        for (let line = 0; line < 9; line++) {
          const row = solved.values.slice(line * 9, line * 9 + 9);
          const column = solved.values.filter((_, i) => i % 9 === line);
          for (const [side, heights] of [
            column,
            row,
            [...column].reverse(),
            [...row].reverse(),
          ].entries()) {
            const clue = puzzle.skyscrapers[side][line];
            if (clue)
              assert.equal(
                clue,
                heights.filter((height, i) =>
                  heights.slice(0, i).every((earlier) => earlier < height),
                ).length,
              );
          }
        }
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
  const draft = rules.create(puzzle);
  let replay = rules.startReplay(puzzle, draft);
  for (let step = 0; step < 2048; step++) {
    assert.ok(rules.enter(puzzle, draft, index, 4, true));
    replay = rules.recordEdit(replay, index, 4, true);
  }
  assert.equal(rules.restoreReplay(puzzle, replay, draft).moves.length, 6144);
  assert.ok(rules.enter(puzzle, draft, index, 4, true));
  assert.equal(rules.recordEdit(replay, index, 4, true), null);
  assert.equal(rules.restoreReplay(puzzle, replay, draft), null);
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
      await launchGame(page, "game-sudoku");
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
    async function assertActionRow() {
      const buttons = await Promise.all(
        ["undo", "notes", "erase"].map((name) => action(name).boundingBox()),
      );
      assert.equal(await page.locator(".sudoku-actions button").count(), 3);
      assert.ok(buttons.every((box) => Math.abs(box.y - buttons[0].y) < 1));
      assert.ok(buttons[0].x < buttons[1].x && buttons[1].x < buttons[2].x);
    }
    await launch();
    assert.equal(await page.locator(".sudoku-categories button").count(), 16);
    assert.equal(await page.locator(".sudoku-levels button").count(), 20);
    assert.equal(
      await page.locator(".sudoku-levels button:enabled").count(),
      20,
    );
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const categories = await page.locator(".sudoku-categories").boundingBox();
      const levels = await page.locator(".sudoku-levels").boundingBox();
      assert.ok(categories.x + categories.width <= levels.x);
      assert.ok(Math.abs(categories.y - levels.y) < 4);
      assert.ok(levels.x + levels.width <= width);
      const tiles = await page
        .locator(".sudoku-levels button")
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const { width, height } = button.getBoundingClientRect();
            return {
              width,
              height,
              radius: parseFloat(getComputedStyle(button).borderRadius),
            };
          }),
        );
      assert.ok(
        tiles.every(
          ({ width, height, radius }) =>
            Math.abs(Math.max(44, (width * 3) / 4) - height) < 1 && radius > 0,
        ),
      );
      await page.screenshot({
        path: path.join(output, "categories-" + width + ".png"),
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await action("thermo").click();
    await action("level-20").click();
    const laterPuzzle = groupById("thermo").puzzles.at(-1);
    const laterIndex = laterPuzzle.givens.indexOf("0");
    const laterDigit = laterPuzzle.solution[laterIndex];
    await action("digit-" + laterDigit).click();
    const laterSave = await saved();
    assert.equal(laterSave.current, laterPuzzle.id);
    assert.equal(
      laterSave.drafts[laterPuzzle.id].values[laterIndex],
      Number(laterDigit),
    );
    assert.deepEqual(laterSave.completed, {});
    assert.equal(
      await page.evaluate(
        (save) =>
          WorkTimeApp.services.gameArchive.normalize("game-sudoku", save)
            .current,
        laterSave,
      ),
      laterPuzzle.id,
    );
    await launch();
    assert.equal(await page.locator(".sudoku-catalog").isVisible(), false);
    assert.equal((await saved()).current, laterPuzzle.id);
    await menuAction("choose");
    await action("easy").click();
    await action("level-1").click();
    const puzzle = data.sudoku.groups[0].puzzles[0],
      index = puzzle.givens.indexOf("0");
    const digit = Number(puzzle.solution[index]);
    const cell = page.locator('[data-cell="' + index + '"]');
    await cell.focus();
    await cell.press("n");
    await cell.press("4");
    assert.equal((await saved()).drafts[puzzle.id].notes[index], 8);
    await action("undo").click();
    assert.equal((await saved()).drafts[puzzle.id].notes[index], 0);
    await action("notes").click();
    await action("digit-" + digit).click();
    assert.equal((await saved()).drafts[puzzle.id].values[index], digit);
    await action("erase").click();
    assert.equal((await saved()).drafts[puzzle.id].values[index], 0);
    await action("undo").click();
    assert.equal((await saved()).drafts[puzzle.id].values[index], digit);
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
      await assertActionRow();
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
    const optionsToggle = page.locator(".sudoku-options > summary");
    const menu = page.locator(".sudoku-controls");
    const title = page.locator(".sudoku-hud .game-title");
    async function assertToolbar() {
      const [heading, timer, pause, more] = await Promise.all(
        [
          title,
          page.locator(".sudoku-time strong"),
          action("pause"),
          optionsToggle,
        ].map((element) => element.boundingBox()),
      );
      assert.ok(heading.x + heading.width <= timer.x);
      assert.ok(
        timer.x + timer.width < pause.x && pause.x + pause.width < more.x,
      );
      const centerY = (box) => box.y + box.height / 2;
      assert.ok(Math.abs(centerY(timer) - centerY(pause)) < 1);
      assert.ok(Math.abs(centerY(pause) - centerY(more)) < 1);
      const panel = await menu.boundingBox();
      assert.ok(Math.abs(panel.x + panel.width - more.x - more.width) < 1);
    }
    const hud = await page.locator(".sudoku-hud").boundingBox();
    assert.ok(Math.abs(hud.x - geometry.x) < 1);
    assert.ok(Math.abs(hud.width - geometry.width) < 1);
    await optionsToggle.click();
    await assertToolbar();
    await action("choose").press("Escape");
    assert.equal(await menu.isVisible(), false);
    assert.equal(
      await optionsToggle.evaluate((el) => el === document.activeElement),
      true,
    );
    await optionsToggle.click();
    await title.click();
    assert.equal(await menu.isVisible(), false);
    await optionsToggle.click();
    await page.screenshot({ path: path.join(output, "options-desktop.png") });
    await page.locator("[data-game-help]").click();
    assert.equal(await page.locator(".game-help-screen").isVisible(), true);
    await page.locator("[data-game-help-close]").click();
    assert.deepEqual(
      await page.locator(".sudoku-board").boundingBox(),
      geometry,
    );
    await menuAction("restart");
    await action("cancel").click();
    assert.equal((await saved()).drafts[puzzle.id].values[index], digit);
    await action("pause").click();
    const cover = page.locator(".sudoku-cover");
    assert.equal(await page.locator(".sudoku-board").isVisible(), false);
    assert.deepEqual(await cover.boundingBox(), geometry);
    const heading = await cover.locator("h3").boundingBox();
    const resume = await action("accept").boundingBox();
    assert.ok(
      Math.abs(heading.x + heading.width / 2 - (resume.x + resume.width / 2)) <
        1,
    );
    assert.ok(
      Math.abs(
        (heading.y + resume.y + resume.height) / 2 -
          (geometry.y + geometry.height / 2),
      ) < 1,
    );
    await page.screenshot({ path: path.join(output, "paused-desktop.png") });
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
    assert.equal(await action("fog").count(), 0);
    await action("skyscraper").click();
    assert.equal(
      await page.locator(".sudoku-levels button:visible").count(),
      20,
    );
    await action("level-1").click();
    const sky = groupById("skyscraper").puzzles[0];
    for (const [side, name] of ["top", "left", "bottom", "right"].entries())
      assert.deepEqual(
        await page.locator(".sudoku-sky-" + name + " > span").allTextContents(),
        Array.from(sky.skyscrapers[side], (clue) => (clue ? String(clue) : "")),
      );
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const grid = await page.locator(".sudoku-board").boundingBox();
      const top = await page.locator(".sudoku-sky-top").boundingBox();
      const left = await page.locator(".sudoku-sky-left").boundingBox();
      assert.ok(
        Math.abs(grid.x - top.x) < 1 && Math.abs(grid.width - top.width) < 1,
      );
      assert.ok(
        Math.abs(grid.y - left.y) < 1 &&
          Math.abs(grid.height - left.height) < 1,
      );
      await page.screenshot({
        path: path.join(output, "skyscraper-" + width + ".png"),
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await menuAction("choose");
    await action("easy").click();
    assert.equal(
      await action("level-1")
        .locator(".game-level-badge")
        .getAttribute("data-state"),
      "draft",
    );
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
        assert.equal(entries.length, 78);
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
      await assertActionRow();
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
      await optionsToggle.click();
      await assertToolbar();
      const menuBounds = await menu.boundingBox();
      assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width);
      await page.screenshot({
        path: path.join(output, "options-mobile-" + width + ".png"),
      });
      await optionsToggle.press("Escape");
      await action("pause").click();
      assert.equal(await page.locator(".sudoku-board").isVisible(), false);
      assert.deepEqual(await cover.boundingBox(), bounds);
      await page.screenshot({
        path: path.join(output, "paused-mobile-" + width + ".png"),
      });
      await action("accept").click();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Complete through a normal final keypress and verify the replay record.
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
    assert.equal(await page.locator(".game-celebration").count(), 0);
    const firstResult = (await saved()).completed[puzzle.id];
    assert.ok(firstResult.replay.base, "old draft starts at its saved board");
    await action("replay").click();
    assert.ok(await page.getByText("从旧存档接续处开始。").isVisible());
    await page.getByText("第 1 / 1 步", { exact: true }).waitFor();
    assert.equal(await action("replay-toggle").isDisabled(), true);
    assert.equal(
      await action("cell-" + last)
        .locator(".sudoku-digit")
        .textContent(),
      puzzle.solution[last],
    );
    await action("replay-exit").click();
    assert.ok(
      await action("replay").evaluate((el) => el === document.activeElement),
    );
    await menuAction("choose");
    assert.equal(
      await action("level-1")
        .locator(".game-level-badge")
        .getAttribute("data-state"),
      "complete",
    );
    assert.match(await action("level-1").getAttribute("aria-label"), /已通关/);
    assert.equal(await action("level-2").isEnabled(), true);
    await action("level-1").click();
    await menuAction("restart");
    await action("accept").click();
    {
      const noted = rules.peers[index].find((i) => puzzle.givens[i] === "0");
      const digit = Number(puzzle.solution[index]);
      const wrong = rules.peers[index]
        .map((i) => Number(puzzle.givens[i]))
        .find(Boolean);
      await action("cell-" + noted).click();
      await action("notes").click();
      await action("digit-" + digit).click();
      await page.evaluate(
        ({ key, id }) => {
          const save = JSON.parse(localStorage.getItem(key));
          save.drafts[id].elapsed = 1000;
          localStorage.setItem(key + ".fixture", JSON.stringify(save));
        },
        { key, id: puzzle.id },
      );
      await launch();
      await action("accept").click();
      await action("cell-" + index).click();
      await action("digit-" + wrong).click();
      await action("erase").click();
      await action("undo").click();
      await action("digit-" + digit).click();
      await action("cell-" + index).press("Control+z");
      await action("digit-" + digit).click();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(
        ({ index, puzzle }) => {
          for (let i = 0; i < 81; i++) {
            if (i === index || puzzle.givens[i] !== "0") continue;
            const cell = document.querySelector('[data-cell="' + i + '"]');
            cell.click();
            cell.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: puzzle.solution[i],
                bubbles: true,
                cancelable: true,
              }),
            );
          }
        },
        { index, puzzle },
      );
      assert.equal(await page.locator(".game-confetti").count(), 120);
      const winningSave = await saved();
      const latest = winningSave.completed[puzzle.id];
      assert.equal(latest.elapsed, firstResult.elapsed);
      assert.ok(latest.replay.finishedAt > firstResult.replay.finishedAt);
      assert.equal(latest.replay.base, undefined);
      await action("replay").click();
      assert.equal(await page.locator(".game-celebration").count(), 0);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const progress = page.locator(".sudoku-replay > p").first();
      const pausedAt = await progress.textContent();
      await page.waitForTimeout(300);
      assert.equal(
        await progress.textContent(),
        pausedAt,
        "background pauses playback",
      );
      await page.evaluate(() => {
        document.querySelector('[data-sudoku-action="replay-restart"]').click();
        document.querySelector('[data-sudoku-action="replay-toggle"]').click();
      });
      assert.match(await progress.textContent(), /第 0 \/ /);
      const cell = action("cell-" + index);
      const note = action("cell-" + noted).locator(".sudoku-notes");
      assert.equal(await cell.isDisabled(), true);
      await action("replay-next").click();
      assert.equal(await note.textContent(), String(digit));
      await action("replay-next").click();
      assert.match(await cell.getAttribute("class"), /is-conflict/);
      await action("replay-next").click();
      assert.equal(await cell.locator(".sudoku-digit").textContent(), "");
      await action("replay-next").click();
      assert.equal(
        await cell.locator(".sudoku-digit").textContent(),
        String(wrong),
      );
      await action("replay-next").click();
      assert.equal(await note.textContent(), "");
      await action("replay-next").click();
      assert.equal(await note.textContent(), String(digit));
      await action("replay-previous").click();
      assert.equal(await note.textContent(), "");
      await page.setViewportSize({ width: 320, height: 800 });
      assert.ok(
        await page
          .locator(".game-content")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await action("replay-exit").press("Escape");
      assert.deepEqual(await saved(), winningSave);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await launch();
      assert.equal(await page.locator(".game-celebration").count(), 0);
      await menuAction("restart");
      await action("accept").click();
      await menuAction("menu-replay");
      await action("replay-exit").click();
      assert.ok(
        await page
          .locator(".sudoku-options > summary")
          .evaluate((el) => el === document.activeElement),
      );
      assert.deepEqual((await saved()).completed[puzzle.id], latest);
    }
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
    await launchGame(page, "game-sudoku");
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
    await launchGame(noStorage, "game-sudoku");
    await noStorage.locator('[data-sudoku-action="level-1"]').click();
    await noStorage.locator('[data-sudoku-action="digit-1"]').click();
    assert.equal(await noStorage.locator("[data-game-error]").count(), 0);
    assert.ok(
      (await noStorage.locator(".sudoku-feedback").textContent()).length > 0,
    );
    await blocked.close();
    console.log(
      "Sudoku: 320 unique solutions, variant constraints, free level selection, input, undo, drafts, replay, pause, help, six languages, mobile, unavailable storage and offline loading verified.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
