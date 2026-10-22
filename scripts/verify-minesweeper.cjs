"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const entry = path.resolve(process.argv[2] || root, "index.html");
const output = path.resolve(root, "test-results/minesweeper");
const key = "worktime.games.minesweeper.v1";
const sandbox = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(
    path.join(root, "assets/js/games/minesweeper-rules.js"),
    "utf8",
  ),
  sandbox,
);
const rules = sandbox.WorkTimeApp.games.minesweeperRules;
const plain = (value) => JSON.parse(JSON.stringify(value));
function random(seed = 917) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const snapshot = (state, elapsed = 0) =>
  plain({
    version: 1,
    state,
    elapsed,
    manualPaused: false,
    stats: rules.emptyStats(),
  });
function verifyRules() {
  for (const difficulty of Object.keys(rules.levels)) {
    const { columns, rows, count } = rules.levels[difficulty],
      size = columns * rows;
    for (const index of [
      0,
      columns - 1,
      size - columns,
      size - 1,
      Math.floor(size / 2),
    ]) {
      const fresh = rules.create(difficulty),
        initial = JSON.stringify(fresh);
      const state = rules.reveal(fresh, index, random());
      assert.equal(
        JSON.stringify(fresh),
        initial,
        "reveal does not mutate input",
      );
      assert.equal(
        state.mines.reduce((a, b) => a + b),
        count,
      );
      for (const safe of [index, ...rules.neighbors(state, index)])
        assert.equal(state.mines[safe], 0);
      assert.ok(state.revealed[index]);
      for (let cell = 0; cell < size; cell++) {
        const x = cell % columns,
          y = Math.floor(cell / columns);
        let expected = 0;
        for (let other = 0; other < size; other++) {
          const dx = Math.abs(x - (other % columns)),
            dy = Math.abs(y - Math.floor(other / columns));
          if (other !== cell && dx <= 1 && dy <= 1)
            expected += state.mines[other];
        }
        assert.equal(
          rules.adjacent(state, cell),
          expected,
          "independent neighborhood count",
        );
      }
      assert.ok(rules.restore(snapshot(state)));
    }
  }
  let fresh = rules.create();
  assert.equal(rules.neighbors(fresh, 0).length, 3);
  assert.equal(rules.neighbors(fresh, 4).length, 5);
  assert.equal(rules.neighbors(fresh, 40).length, 8);
  fresh = rules.flag(fresh, 40);
  assert.equal(rules.reveal(fresh, 40), fresh, "flag protects before planting");
  assert.equal(fresh.mines, null);
  assert.ok(rules.restore(snapshot(fresh)));
  const state = rules.reveal(rules.create(), 40, random());
  assert.ok(state.revealed.filter(Boolean).length >= 9, "blank start expands");
  const target = state.revealed.findIndex(
    (shown, cell) =>
      shown &&
      rules.adjacent(state, cell) > 0 &&
      rules
        .neighbors(state, cell)
        .some((n) => !state.revealed[n] && !state.mines[n]),
  );
  assert.ok(target >= 0, "deterministic fixture supports chord");
  const neighbors = rules.neighbors(state, target);
  const mines = neighbors.filter((n) => state.mines[n]);
  const safe = neighbors.find((n) => !state.revealed[n] && !state.mines[n]);
  assert.equal(
    rules.chord(state, target),
    state,
    "not enough flags does nothing",
  );
  let correct = state;
  for (const mine of mines) correct = rules.flag(correct, mine);
  const opened = rules.chord(correct, target);
  assert.equal(opened.revealed[safe], true);
  assert.notEqual(opened.status, "lost");
  let wrong = rules.flag(state, safe);
  for (const mine of mines.slice(1)) wrong = rules.flag(wrong, mine);
  const lost = rules.chord(wrong, target);
  assert.equal(lost.status, "lost", "incorrect chord can explode");
  assert.ok(rules.restore(snapshot(lost, 2000)));
  assert.equal(rules.reveal(lost, 0), lost);
  assert.equal(rules.flag(lost, 0), lost);
  assert.equal(rules.chord(lost, target), lost);
  let won = state;
  for (let cell = 0; cell < won.revealed.length; cell++)
    if (!won.mines[cell]) won = rules.reveal(won, cell);
  assert.equal(won.status, "won", "no flags needed to win");
  assert.equal(won.flagged.some(Boolean), false);
  assert.equal(rules.flag(won, 0), won);
  assert.equal(rules.reveal(won, 0), won);
  assert.ok(rules.restore(snapshot(won, 3000)));
  const valid = snapshot(state, 1500);
  const bad = [
    null,
    {},
    { ...valid, version: 2 },
    { ...valid, elapsed: -1 },
    { ...valid, elapsed: Infinity },
    { ...valid, elapsed: "2" },
    { ...valid, manualPaused: 1 },
    { ...valid, stats: {} },
  ];
  for (const change of [
    { difficulty: "__proto__" },
    { revealed: [] },
    { flagged: [true] },
    { mines: Array(81).fill(0) },
    { first: -1 },
    { status: "won" },
    { exploded: 0 },
    { revealed: Array(81).fill(true) },
    { mines: null },
  ])
    bad.push({ ...valid, state: { ...valid.state, ...change } });
  for (const invalid of bad)
    assert.equal(rules.restore(invalid), null, "reject invalid save");
  assert.equal(rules.reveal(state, -1), state);
  assert.equal(rules.flag(state, 999), state);
  const restored = rules.restore(valid);
  restored.state.revealed[0] = !restored.state.revealed[0];
  assert.notDeepEqual(
    plain(restored.state.revealed),
    valid.state.revealed,
    "restored arrays owned independently",
  );
  console.log(
    "Minesweeper rules: safe starts, independent counts, flood fill, flags, chords, wins, losses and saves verified.",
  );
  return { state: plain(state), won: plain(won), lost: plain(lost) };
}
async function ready(page) {
  await page.goto(pathToFileURL(entry).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
}
async function verifyOfficialIcons(page) {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(root, "assets/icons/material-symbols.json"),
      "utf8",
    ),
  );
  const catalog = new Map(manifest.icons.map((icon) => [icon.id, icon]));
  const source = fs.readFileSync(entry, "utf8");
  const symbols = new Map(
    [...source.matchAll(/<symbol id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  const refs = await page
    .locator(
      ".game-shell svg:not(.game-menu-icon):not(.backup-hold-icon), #gamesPanel svg:not(.game-menu-icon):not(.backup-hold-icon)",
    )
    .evaluateAll((elements) =>
      elements.map((svg) =>
        svg.children.length === 1 &&
        svg.firstElementChild.tagName.toLowerCase() === "use"
          ? svg.firstElementChild.getAttribute("href")
          : "custom-svg",
      ),
    );
  assert.ok(refs.length > 0);
  for (const ref of new Set(refs)) {
    assert.ok(
      ref?.startsWith("#ms-"),
      "game control icons use the official sprite: " + ref,
    );
    const id = ref.slice(1),
      icon = catalog.get(id);
    assert.ok(icon && symbols.has(id), "official icon exists: " + id);
    assert.ok(
      icon.source.startsWith(
        "https://raw.githubusercontent.com/google/material-design-icons/",
      ),
    );
    assert.equal(
      require("node:crypto")
        .createHash("sha256")
        .update(symbols.get(id))
        .digest("hex"),
      icon.sha256,
      "game icon matches its pinned official source: " + id,
    );
  }
}
async function open(page) {
  await page.locator("#date-tab-games").click();
  await page.locator('#gamesPanel [data-game="game-minesweeper"]').click();
  await page.waitForFunction(
    () => document.getElementById("gameShell").dataset.state === "open",
  );
}
async function close(page) {
  await page.locator("#gameExitButton").click();
  await page.waitForFunction(
    () => document.getElementById("gameShell").dataset.state === "closed",
  );
}
const action = (page, name) => page.locator(`[data-mine-action="${name}"]`);
const cell = (page, index) => page.locator(`[data-mine-cell="${index}"]`);
const saved = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
async function verifyResultLayout(page) {
  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
      };
    };
    return {
      board: rect(".mine-board"),
      card: rect(".mine-result"),
      group: rect(".mine-arrangement"),
      stage: rect(".mine-scroller"),
      narrow: innerWidth <= 700,
    };
  });
  const { board, card, group, stage, narrow } = geometry;
  if (!narrow) {
    assert.ok(
      Math.abs(card.height - board.height) < 1,
      "result card matches board height",
    );
    assert.ok(
      Math.abs(card.y - board.y) < 1,
      "result card aligns with board top",
    );
  }
  assert.ok(
    narrow ? card.y >= board.bottom : card.x >= board.right,
    "result sits beside the board, or below on narrow screens",
  );
  assert.ok(
    Math.abs(group.x + group.width / 2 - stage.x - stage.width / 2) < 2,
    "board and result are centered together",
  );
  assert.ok(
    Math.abs(group.y + group.height / 2 - stage.y - stage.height / 2) < 2,
    "result group is vertically centered",
  );
}
const topGeometry = (page) =>
  page.evaluate(() =>
    [".mine-header", ".mine-toolbar", ".mine-counters", ".mine-stage"].map(
      (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return {
          selector,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        };
      },
    ),
  );
async function verifyBoardTransitions(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const choose = (level) =>
    page.evaluate((level) => {
      const select = document.getElementById("mineDifficulty");
      select.value = level;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, level);
  const settled = () =>
    page.waitForFunction(
      () =>
        !document
          .querySelector(".game-minesweeper")
          .hasAttribute("data-board-changing"),
    );
  await choose("easy");
  const fixedTop = await topGeometry(page);
  assert.equal(await page.locator(".mine-header .game-stat").count(), 4);
  assert.equal(await page.locator(".mine-footer .mine-records").count(), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const start = await page.locator(".mine-board").boundingBox();
  await choose("hard");
  const transition = await page.locator(".mine-board").evaluate((board) => ({
    moving: board
      .getAnimations()
      .some(
        (animation) =>
          animation.effect?.target === board &&
          animation.playState === "running",
      ),
    inert: board.inert,
    endWidth: board.offsetWidth,
  }));
  assert.ok(
    transition.moving && transition.inert,
    "board size changes animate and prevent accidental opens during motion",
  );
  assert.ok(transition.endWidth > start.width);
  assert.deepEqual(
    await topGeometry(page),
    fixedTop,
    "header, cards, controls and stage stay fixed during board motion",
  );
  await page.evaluate(() =>
    document.querySelector('[data-mine-cell="0"]').click(),
  );
  assert.equal((await saved(page)).state.status, "ready");
  await settled();
  assert.deepEqual(await topGeometry(page), fixedTop);
  assert.equal(
    await page
      .locator(".mine-board")
      .evaluate((board) => board.inert || board.getAnimations().length > 0),
    false,
  );
  for (const level of ["easy", "hard", "medium"]) await choose(level);
  await settled();
  assert.equal(await page.locator(".mine-cell").count(), 256);
  assert.equal((await saved(page)).state.difficulty, "medium");
  assert.deepEqual(
    await topGeometry(page),
    fixedTop,
    "rapid difficulty changes preserve the header and final board",
  );
  await choose("hard");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settled();
  await choose("easy");
  assert.equal(
    await page
      .locator(".mine-board")
      .evaluate((board) => board.getAnimations().length),
    0,
    "reduced motion changes size immediately",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await choose("hard");
  await page.setViewportSize({ width: 1366, height: 768 });
  await settled();
  assert.equal(
    await page.locator(".mine-board").evaluate((board) => board.inert),
    false,
    "resize cancels board motion and releases input",
  );
  await page.evaluate(() => {
    window.mineNativeAnimate = Element.prototype.animate;
    Element.prototype.animate = undefined;
  });
  await choose("easy");
  await settled();
  assert.equal(
    await page.locator(".mine-cell").count(),
    81,
    "missing animation API still completes a difficulty change",
  );
  await page.evaluate(() => {
    Element.prototype.animate = window.mineNativeAnimate;
    delete window.mineNativeAnimate;
  });
  await choose("hard");
  await close(page);
  assert.equal(
    await page.locator(".mine-board").count(),
    0,
    "leaving during size motion releases the board",
  );
  await open(page);
  assert.equal(await page.locator(".mine-cell").count(), 480);
  assert.equal(
    await page.locator(".game-minesweeper[data-board-changing]").count(),
    0,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
}
async function seed(page, state, elapsed = 0) {
  await close(page);
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key, value: snapshot(state, elapsed) },
  );
  await open(page);
}
async function verifyHoverFeedback(browser, fixtures) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  await page.route(/^https?:/, (route) => route.abort());
  try {
    await ready(page);
    await open(page);
    const style = (element) =>
      element.evaluate((node) => {
        const css = getComputedStyle(node);
        return {
          border: css.borderColor,
          background: css.backgroundColor,
          transform: css.transform,
          shadow: css.boxShadow,
          filter: css.filter,
        };
      });
    async function checkHover(element, moving = true) {
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
      const before = await style(element);
      await element.hover();
      await page.waitForTimeout(200);
      const after = await style(element);
      assert.equal(
        after.border,
        before.border,
        "hover preserves border colors",
      );
      assert.equal(
        after.transform,
        "none",
        "flat hover never moves or scales controls",
      );
      assert.equal(after.shadow, "none", "flat hover has no raised shadow");
      if (moving) {
        assert.ok(
          after.background !== before.background ||
            after.filter !== before.filter,
          "flat hover remains visible through color or brightness",
        );
        await page.mouse.down();
        const pressed = await style(element);
        assert.equal(
          pressed.transform,
          "none",
          "flat press never moves or scales controls",
        );
        assert.equal(pressed.shadow, "none", "flat press has no inset shadow");
        assert.equal(pressed.border, before.border);
        await page.mouse.move(0, 0);
        await page.mouse.up();
      } else
        assert.deepEqual(
          after,
          before,
          "finished boards have no hover feedback",
        );
    }
    for (const name of ["restart", "difficulty"])
      await checkHover(action(page, name));
    await checkHover(cell(page, 0));
    await cell(page, 0).click({ button: "right" });
    await checkHover(cell(page, 0));
    await action(page, "difficulty").click();
    await checkHover(page.locator('[data-game-option="medium"]'), "menu");
    await page.keyboard.press("Escape");
    for (const outcome of [fixtures.won, fixtures.lost]) {
      await seed(page, outcome, 42000);
      await checkHover(cell(page, 0), false);
      await checkHover(action(page, "again"));
      const contrast = await action(page, "again").evaluate((element) => {
        const css = getComputedStyle(element);
        return {
          color: css.color,
          background: css.backgroundColor,
          paper: getComputedStyle(document.documentElement).getPropertyValue(
            "--paper",
          ),
        };
      });
      assert.notEqual(
        contrast.background,
        "rgb(255, 255, 255)",
        "primary hover retains its colored fill",
      );
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await action(page, "again").hover();
    assert.equal((await style(action(page, "again"))).transform, "none");
    await action(page, "again").click();
    await cell(page, 0).hover();
    assert.equal(
      (await style(cell(page, 0))).transform,
      "none",
      "reduced motion keeps hovered tiles still",
    );
    console.log(
      "Minesweeper hover: flat color feedback, stable borders, presses, flags, primary controls, completed boards and reduced motion verified.",
    );
  } finally {
    await context.close();
  }
}
async function verifyBrowser(fixtures) {
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
      hasTouch: true,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await ready(page);
    await open(page);
    const workBefore = await page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(
          ([key]) => !key.startsWith("worktime.games."),
        ),
      ),
    );
    assert.equal(await page.locator(".mine-cell").count(), 81);
    assert.equal(await page.locator('.mine-cell[tabindex="0"]').count(), 1);
    await verifyOfficialIcons(page);
    // The difficulty picker follows the site's listbox keyboard and focus model.
    await action(page, "difficulty").focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await action(page, "difficulty").getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.gameOption),
      "easy",
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.gameOption),
      "medium",
    );
    await page.keyboard.press("End");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.gameOption),
      "hard",
    );
    await page.keyboard.press("Home");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.gameOption),
      "easy",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await action(page, "difficulty").getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(await page.locator(".game-minesweeper").count(), 1);
    await action(page, "difficulty").click();
    await page.locator(".mine-counters").click();
    assert.equal(
      await action(page, "difficulty").getAttribute("aria-expanded"),
      "false",
    );
    await action(page, "difficulty").click();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.mineAction),
      "restart",
    );
    assert.equal(
      await action(page, "difficulty").getAttribute("aria-expanded"),
      "false",
    );
    const sharedControls = await page.evaluate(() => {
      const game = getComputedStyle(
        document.querySelector(".game-select-trigger"),
      );
      const web = getComputedStyle(
        document.querySelector(".panel-head .ui-button"),
      );
      return {
        game: [game.height, game.borderRadius, game.fontSize, game.fontWeight],
        web: [web.height, web.borderRadius, web.fontSize, web.fontWeight],
      };
    });
    assert.deepEqual(
      sharedControls.game,
      sharedControls.web,
      "game controls use the website's shared dimensions and typography",
    );
    await action(page, "difficulty").click();
    const pickerBounds = await page
      .locator(".game-select-options")
      .boundingBox();
    const triggerBounds = await action(page, "difficulty").boundingBox();
    assert.ok(Math.abs(pickerBounds.width - triggerBounds.width) < 1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator(".mine-cell").count(),
      256,
      "keyboard selection starts the chosen difficulty",
    );
    await action(page, "difficulty").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".mine-cell").count(), 81);
    await action(page, "difficulty").click();
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    assert.equal(
      await action(page, "difficulty").getAttribute("aria-expanded"),
      "false",
      "resize closes the picker cleanly",
    );
    await cell(page, 10).click({ button: "right" });
    assert.equal((await saved(page)).state.status, "ready");
    assert.equal((await saved(page)).elapsed, 0);
    await cell(page, 10).click();
    assert.equal((await saved(page)).state.mines, null);
    await cell(page, 10).focus();
    await page.keyboard.press("f");
    assert.equal((await saved(page)).state.flagged[10], false);
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.mineCell),
      "9",
    );
    await page.keyboard.press("Enter");
    assert.equal((await saved(page)).state.first, 9);
    const stableBoard = await page.locator(".mine-board").boundingBox();
    assert.equal(await page.locator(".game-minesweeper .ui-button").count(), 0);
    assert.equal(
      await page.locator("[data-game-help], .game-help-screen").count(),
      0,
    );
    assert.equal(await page.locator(".game-minesweeper").count(), 1);
    assert.deepEqual(
      await page.locator(".mine-board").boundingBox(),
      stableBoard,
    );
    await page.waitForTimeout(1100);
    await action(page, "pause").click();
    assert.deepEqual(
      await page.locator(".mine-board").boundingBox(),
      stableBoard,
      "pause does not move the board",
    );
    assert.deepEqual(
      await page.locator(".mine-cover").boundingBox(),
      stableBoard,
      "pause cover stays within the board",
    );
    await page.locator(".mine-cover").screenshot({
      path: path.join(output, "paused.png"),
    });
    const paused = await saved(page);
    assert.ok(paused.elapsed >= 1000);
    assert.equal(
      await page.locator('.mine-board[aria-hidden="true"]').count(),
      1,
    );
    assert.equal(
      await cell(page, 9).evaluate(
        (element) => getComputedStyle(element).visibility,
      ),
      "hidden",
    );
    await page.waitForTimeout(1100);
    await close(page);
    const stopped = await saved(page);
    assert.equal(stopped.elapsed, paused.elapsed, "pause freezes elapsed time");
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await open(page);
    assert.equal(await page.locator(".mine-cover:not([hidden])").count(), 1);
    await action(page, "resume").click();
    const beforeNew = (await saved(page)).state;
    const beforeConfirmation = await page.locator(".mine-board").boundingBox();
    await action(page, "difficulty").click();
    await page.locator('[data-game-option="hard"]').click();
    assert.deepEqual(
      await page.locator(".mine-cover").boundingBox(),
      beforeConfirmation,
      "restart confirmation stays within the board",
    );
    assert.deepEqual(
      await page.locator(".mine-board").boundingBox(),
      beforeConfirmation,
      "confirmation does not resize or move board",
    );
    await page.locator(".mine-cover").screenshot({
      path: path.join(output, "confirmation.png"),
    });
    assert.equal(await page.locator(".mine-cell").count(), 81);
    await action(page, "cancel").click();
    assert.deepEqual((await saved(page)).state, beforeNew);
    await action(page, "restart").click();
    await action(page, "confirm").click();
    assert.equal((await saved(page)).state.status, "ready");
    assert.equal((await saved(page)).elapsed, 0);
    await cell(page, 40).click();
    await page.screenshot({ path: path.join(output, "desktop.png") });
    // Lifecycle pause/resume is idempotent and does not create duplicate clocks.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const background = await saved(page);
    await page.waitForTimeout(1100);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await action(page, "pause").click();
    assert.ok(
      (await saved(page)).elapsed - background.elapsed < 400,
      "background does not count",
    );
    await action(page, "resume").click();
    await close(page);
    const departed = await saved(page);
    await page.waitForTimeout(1100);
    assert.deepEqual(
      await saved(page),
      departed,
      "disposed game has no writing timer",
    );
    await page.locator('#gamesPanel [data-game="game-2048"]').click();
    await page.locator(".game-2048").waitFor();
    assert.equal(await page.locator(".game-2048").count(), 1);
    await verifyOfficialIcons(page);
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#gameShell [data-game]").count(),
      await page.evaluate(() => WorkTimeApp.games.list().length),
    );
    await page.locator('#gameShell [data-game="game-minesweeper"]').click();
    assert.deepEqual((await saved(page)).state, departed.state);
    await seed(page, fixtures.state, 61000);
    const chordTarget = fixtures.state.revealed.findIndex(
      (shown, index) =>
        shown &&
        rules.adjacent(fixtures.state, index) > 0 &&
        rules
          .neighbors(fixtures.state, index)
          .some((neighbor) => !fixtures.state.revealed[neighbor]),
    );
    await cell(page, chordTarget).focus();
    assert.ok(
      (await page.locator(".mine-cell.is-neighbor").count()) > 0,
      "keyboard focus previews covered neighbors",
    );
    const beforeChord = (await saved(page)).state;
    await cell(page, chordTarget).click();
    assert.deepEqual(
      (await saved(page)).state,
      beforeChord,
      "incomplete flags never reveal neighbors",
    );
    assert.equal(
      await page.locator(".mine-status").textContent(),
      await page.evaluate(() => WorkTimeApp.i18n.t("games.mine.chordHint")),
    );
    const mineIndex = fixtures.state.mines.indexOf(1);
    const wrongFlag = fixtures.state.revealed.findIndex(
      (shown, i) => !shown && !fixtures.state.mines[i],
    );
    await cell(page, wrongFlag).click({ button: "right" });
    await cell(page, mineIndex).click();
    assert.equal((await saved(page)).state.status, "lost");
    await verifyResultLayout(page);
    assert.equal(await page.locator(".mine-cell.is-exploded").count(), 1);
    const lossColors = await page.evaluate(() => ({
      hit: getComputedStyle(document.querySelector(".mine-cell.is-exploded"))
        .backgroundColor,
      safe: getComputedStyle(
        document.querySelector(".mine-cell.is-open:not(.is-exploded)"),
      ).backgroundColor,
    }));
    assert.notEqual(
      lossColors.hit,
      lossColors.safe,
      "the exploded mine stays visibly highlighted after reveal",
    );
    assert.equal(await page.locator(".mine-cell.is-wrong").count(), 1);
    await verifyOfficialIcons(page);
    assert.equal((await saved(page)).stats.easy.wins, 0);
    await page.screenshot({ path: path.join(output, "lost.png") });
    const almost = plain(fixtures.won);
    const finalCell = almost.revealed.findIndex(
      (shown, i) =>
        shown && i !== almost.first && rules.adjacent(almost, i) > 0,
    );
    almost.revealed[finalCell] = false;
    almost.status = "playing";
    await seed(page, almost, 42400);
    await cell(page, finalCell).click();
    await verifyResultLayout(page);
    assert.equal(
      await page.locator(".mine-celebration").count(),
      0,
      "reduced motion suppresses confetti",
    );
    const victory = await saved(page);
    assert.equal(victory.state.status, "won");
    assert.equal(victory.stats.easy.wins, 1);
    assert.equal(
      await page.locator('[data-mine-counter="remaining"]').textContent(),
      "0",
      "victory secures every mine",
    );
    assert.equal(await page.locator(".mine-cell.is-flagged").count(), 10);
    assert.equal(
      await page.locator(".mine-result-copy > strong").textContent(),
      await page.evaluate(() => WorkTimeApp.i18n.t("games.mine.newRecord")),
    );
    assert.ok(victory.stats.easy.best >= 42400);
    assert.equal(
      await page.locator('[data-mine-counter="wins"]').textContent(),
      "1",
    );
    assert.equal(
      await page.locator('[data-mine-counter="best"]').textContent(),
      "00:42",
    );
    await close(page);
    await open(page);
    await cell(page, finalCell).click();
    assert.equal(
      (await saved(page)).stats.easy.wins,
      1,
      "restored win not counted twice",
    );
    await page.screenshot({ path: path.join(output, "won.png") });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await seed(page, almost, 42400);
    await cell(page, finalCell).click();
    assert.equal(await page.locator(".mine-confetti").count(), 120);
    const effects = await page.evaluate(() => ({
      board: document.querySelector(".mine-board").getAnimations().length,
      card: document.querySelector(".mine-result").getAnimations().length,
      layer: document
        .querySelector(".mine-celebration")
        .getBoundingClientRect()
        .toJSON(),
      pointerEvents: getComputedStyle(
        document.querySelector(".mine-celebration"),
      ).pointerEvents,
      width: innerWidth,
      height: innerHeight,
    }));
    assert.ok(
      effects.board && effects.card,
      "board and result animate together",
    );
    assert.equal(effects.layer.width, effects.width);
    assert.equal(effects.layer.height, effects.height);
    assert.equal(effects.pointerEvents, "none");
    await page.waitForTimeout(650);
    await verifyResultLayout(page);
    await page.screenshot({ path: path.join(output, "celebration.png") });
    await page.waitForFunction(
      () => !document.querySelector(".mine-celebration"),
    );
    await action(page, "again").click();
    assert.equal(await page.locator(".mine-celebration").count(), 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await close(page);
    const workAfter = await page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(
          ([key]) => !key.startsWith("worktime.games."),
        ),
      ),
    );
    assert.deepEqual(workAfter, workBefore, "games never alter work storage");
    await open(page);
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ko", "ja"]) {
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      assert.equal(
        await page.locator("#gameTitle").textContent(),
        await page.evaluate(() => WorkTimeApp.i18n.t("games.mine.name")),
      );
      assert.ok(
        !(await cell(page, 0).getAttribute("aria-label")).includes("{row}"),
      );
    }
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
      assert.equal(
        await cell(page, 0).evaluate(
          (element) => getComputedStyle(element).animationName,
        ),
        "none",
      );
    }
    await page.evaluate(() => {
      WorkTimeApp.i18n.setLanguage("zh-CN");
      document.documentElement.dataset.theme = "green";
    });
    // Mobile: native taps, long hold, drag cancellation and scrollable large board.
    await action(page, "restart").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.ok(
      await page
        .locator(".mine-scroller")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      "beginner fits mobile",
    );
    await cell(page, 0).tap();
    assert.equal((await saved(page)).state.first, 0);
    let mobileState = (await saved(page)).state;
    const hidden = mobileState.revealed.findIndex((shown) => !shown);
    const point = await cell(page, hidden).boundingBox();
    const cdp = await context.newCDPSession(page);
    const touchPoint = {
      x: point.x + point.width / 2,
      y: point.y + point.height / 2,
    };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touchPoint],
    });
    await page.waitForTimeout(550);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(150);
    mobileState = (await saved(page)).state;
    assert.equal(mobileState.flagged[hidden], true);
    assert.equal(
      mobileState.revealed[hidden],
      false,
      "long press does not also reveal",
    );
    const another = mobileState.revealed.findIndex(
      (shown, index) => !shown && index !== hidden,
    );
    const drag = await cell(page, another).boundingBox();
    const start = { x: drag.x + drag.width / 2, y: drag.y + drag.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start.x + 20, y: start.y + 10 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal((await saved(page)).state.revealed[another], false);
    await page.screenshot({ path: path.join(output, "mobile.png") });
    await action(page, "difficulty").tap();
    await page.locator('[data-game-option="hard"]').tap();
    await action(page, "confirm").tap();
    assert.equal(await page.locator(".mine-cell").count(), 480);
    assert.ok(
      await page
        .locator(".mine-scroller")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    );
    assert.ok((await cell(page, 0).boundingBox()).width >= 32);
    await page
      .locator(".mine-scroller")
      .evaluate((element) => (element.scrollLeft = 2000));
    assert.ok(
      await page
        .locator(".mine-scroller")
        .evaluate((element) => element.scrollLeft > 0),
    );
    await page.screenshot({ path: path.join(output, "mobile-expert.png") });
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(50);
      const geometry = await page.evaluate(() => {
        const shell = document
          .getElementById("gameShell")
          .getBoundingClientRect();
        const game = document.querySelector(".game-minesweeper");
        return {
          left: shell.left,
          right: shell.right,
          width: game.clientWidth,
          scrollWidth: game.scrollWidth,
        };
      });
      assert.ok(
        geometry.left >= 0 && geometry.right <= width + 1,
        JSON.stringify(geometry),
      );
      assert.ok(
        geometry.scrollWidth <= geometry.width + 1,
        "game content stays within its shell",
      );
    }
    await cdp.detach();
    // Dense boards must fit the actual game viewport in both dimensions.
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      let fixedTop;
      for (const level of ["easy", "medium", "hard"]) {
        await action(page, "difficulty").click();
        await page.locator(`[data-game-option="${level}"]`).click();
        await page.waitForTimeout(50);
        const top = await topGeometry(page);
        fixedTop ||= top;
        assert.deepEqual(
          top,
          fixedTop,
          "difficulty changes only the board geometry, not the header",
        );
        const fit = await page.evaluate(() => {
          const content = document.querySelector(".game-content");
          const viewport = document.querySelector(".mine-scroller");
          const board = document
            .querySelector(".mine-board")
            .getBoundingClientRect();
          return {
            contentHeight: content.clientHeight,
            contentScrollHeight: content.scrollHeight,
            width: viewport.clientWidth,
            scrollWidth: viewport.scrollWidth,
            height: viewport.clientHeight,
            scrollHeight: viewport.scrollHeight,
            boardWidth: board.width,
            boardHeight: board.height,
          };
        });
        assert.ok(
          fit.contentScrollHeight <= fit.contentHeight + 1,
          JSON.stringify({ viewport, level, ...fit }),
        );
        if (viewport.width > 540)
          assert.ok(
            fit.scrollWidth <= fit.width + 1 &&
              fit.scrollHeight <= fit.height + 1,
            JSON.stringify({ viewport, level, ...fit }),
          );
        if (viewport.width === 1440)
          await page.screenshot({
            path: path.join(output, `fit-${level}.png`),
          });
        if (viewport.width === 390)
          await page.screenshot({
            path: path.join(output, `fit-${level}-mobile.png`),
          });
      }
    }
    // Long translated result messages must remain readable on narrow phones.
    await page.setViewportSize({ width: 320, height: 844 });
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      for (const outcome of [fixtures.won, fixtures.lost]) {
        await seed(page, outcome, 42400);
        const fits = await page.locator(".mine-result").evaluate((element) => {
          const parent = element.getBoundingClientRect();
          return [
            ...element.querySelectorAll(
              "strong, .mine-result-copy > span, button",
            ),
          ].every((child) => {
            const bounds = child.getBoundingClientRect();
            return (
              bounds.bottom <= parent.bottom + 1 &&
              bounds.right <= parent.right + 1 &&
              bounds.left >= parent.left - 1
            );
          });
        });
        assert.ok(
          fits,
          `${language} ${outcome.status} result fits a narrow phone`,
        );
        await verifyResultLayout(page);
      }
    }
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await page.screenshot({ path: path.join(output, "mobile-result.png") });
    for (const width of [1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      for (const difficulty of Object.keys(rules.levels)) {
        let complete = rules.reveal(rules.create(difficulty), 0, random());
        for (let index = 0; index < complete.revealed.length; index++) {
          if (!complete.mines[index]) complete = rules.reveal(complete, index);
        }
        await seed(page, plain(complete), 42400);
        await verifyResultLayout(page);
        const fits = await page
          .locator(".mine-scroller")
          .evaluate(
            (element) =>
              element.scrollWidth <= element.clientWidth + 1 &&
              element.scrollHeight <= element.clientHeight + 1,
          );
        assert.ok(fits, `${difficulty} result fits ${width}px desktop`);
      }
    }
    await verifyBoardTransitions(page);
    await close(page);
    await page.evaluate(
      (key) => localStorage.setItem(key, '{"version":99}'),
      key,
    );
    await open(page);
    assert.equal(
      await page.locator(".mine-cell").count(),
      81,
      "corrupt save resets safely",
    );
    await page.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw Error("Storage unavailable");
      };
    });
    await cell(page, 40).click();
    assert.equal(
      await page.locator(".mine-save-warning:not([hidden])").count(),
      1,
    );
    assert.ok((await page.locator(".mine-cell.is-open").count()) > 1);
    await close(page);
    assert.deepEqual(errors, []);
    await context.close();
    await verifyHoverFeedback(browser, fixtures);
    console.log(
      "Minesweeper browser: mouse, keyboard, touch, drag, pause, lifecycle, saves, records, themes, six languages, mobile and storage failures verified.",
    );
  } finally {
    await browser.close();
  }
}
const fixtures = verifyRules();
verifyBrowser(fixtures).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
