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
const site = path.resolve(
  process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || root,
);
const context = vm.createContext({ WorkTimeApp: { games: {}, services: {} } });
for (const file of [
  "assets/js/games/ultimate-ttt-rules.js",
  "assets/js/services/game-archive.js",
])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const R = context.WorkTimeApp.games.ultimateTttRules;
const tournament = JSON.parse(
  fs.readFileSync(
    path.join(root, "scripts/utttai/bakeoff-results.json"),
    "utf8",
  ),
);
const drawGame = tournament.games[52];
const chainGame = tournament.games[81];
function lockedResults() {
  const initial = R.create();
  const state = { ...initial, regions: [1, 1, 0, 0, 1, 1, 1, 0, 0] };
  assert.equal(R.lockedResult(state), 1);
  assert.equal(
    R.lockedResult({ ...state, regions: state.regions.map((owner) => -owner) }),
    -1,
  );
  assert.equal(
    R.lockedResult({ ...state, regions: [2, 1, 1, 2, 1, 1, 0, 0, 0] }),
    null,
    "the trailing side can still claim the bottom line",
  );
  const drawnBoards = { ...state, regions: [2, 1, 2, 1, 1, 0, 1, 0, 0] };
  assert.equal(R.lockedResult(drawnBoards), 1);
  assert.equal(
    R.lockedResult({ ...drawnBoards, chain: true }),
    null,
    "chain reset can reopen the drawn regions",
  );

  const draw = R.replay(drawGame.path.slice(0, 59));
  const snapshot = JSON.stringify(draw);
  assert.equal(R.lockedResult(draw), 0);
  assert.equal(JSON.stringify(draw), snapshot, "proof leaves the state intact");
  assert.equal(R.lockedResult(R.replay(drawGame.path)), null);
  assert.equal(R.lockedResult(initial), null);
  assert.equal(
    R.lockedResult(R.replay(chainGame.path.slice(0, 146), true)),
    -1,
  );

  // Cross-check two small trees without the production solver's early exits.
  for (const [game, length, expected] of [
    [drawGame, 58, [-1, 0]],
    [tournament.games[63], 57, [-1]],
  ]) {
    const start = R.replay(game.path.slice(0, length), game.chain);
    const outcomes = new Set();
    let visited = 0;
    function enumerate(position) {
      visited++;
      if (position.status !== "playing") outcomes.add(position.winner);
      else
        for (const p of R.legal(position))
          enumerate(R.move(position, p, false));
    }
    enumerate(start);
    assert.deepEqual([...outcomes].sort(), expected);
    assert.equal(visited > 3000, expected.length === 1);
    assert.equal(R.lockedResult(start), null);
  }
}
function unit() {
  assert.equal(R.legal(R.create()).length, 81);
  for (let i = 0; i < 81; i++) {
    const s = R.move(R.create(), i);
    assert.equal(s.target, i % 9);
    assert.equal(s.turn, -1);
    assert.equal(R.flat(R.flat(i)), i);
    assert.equal(R.encode(s)[81 + R.flat(i)], 1);
    assert.equal(R.move(s, i), null);
  }
  for (const line of R.lines)
    for (const side of [1, -1]) {
      const s = R.create();
      s.turn = side;
      s.board[line[0]] = s.board[line[1]] = side;
      assert.equal(R.move(s, line[2]).regions[0], side);
      s.regions[line[0]] = s.regions[line[1]] = side;
      const p = line[2] * 9;
      s.board[p] = s.board[p + 1] = side;
      const won = R.move(s, p + 2);
      assert.equal(won.winner, side);
      assert.equal(won.reason, "line");
    }
  const chain = R.create(true);
  chain.board[0] = chain.board[1] = 1;
  chain.board[10] = -1;
  chain.regions[1] = 2;
  chain.regions[3] = -1;
  chain.board[27] = -1;
  const cleared = R.move(chain, 2);
  assert.equal(cleared.regions[0], 1);
  assert.equal(cleared.regions[1], 0);
  assert.equal(cleared.board[10], 0);
  assert.equal(cleared.board[27], -1);
  assert.equal(cleared.target, 2);
  assert(cleared.cleared.includes(10));
  const quiet = R.move(R.create(true), 0);
  assert.equal(quiet.cleared.length, 0);
  const terminal = R.create(true);
  terminal.regions[0] = terminal.regions[1] = 1;
  terminal.board[18] = terminal.board[19] = 1;
  terminal.board[40] = -1;
  const won = R.move(terminal, 20);
  assert.equal(won.status, "won");
  assert.equal(won.board[40], -1, "line win precedes reset");
  const drawn = [1, -1, 1, 1, -1, -1, -1, 1, 1];
  for (const [regions, result] of [
    [[1, -1, 1, -1, 1, -1, -1, 2, 0], -1],
    [[1, -1, 1, -1, 2, 1, -1, 2, 0], 0],
  ]) {
    const s = R.create();
    s.regions = regions;
    s.board.splice(72, 9, ...drawn);
    s.board[80] = 0;
    const end = R.move(s, 80);
    assert.equal(end.winner, result);
    assert.equal(end.reason, "territory");
  }
  let longest = 0,
    seed = 17;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const chain of [false, true])
    for (let game = 0; game < 50; game++) {
      let s = R.create(chain);
      while (s.status === "playing") {
        const legal = R.legal(s);
        s = R.move(s, legal[Math.floor(random() * legal.length)]);
        assert(s.path.length < 811);
      }
      longest = Math.max(longest, s.path.length);
      assert.equal(JSON.stringify(R.replay(s.path, chain)), JSON.stringify(s));
      const save = {
        version: 1,
        state: {
          mode: "local",
          difficulty: "normal",
          human: 1,
          chain,
          path: s.path,
        },
      };
      assert(R.restore(save));
      assert(
        context.WorkTimeApp.services.gameArchive.normalize(
          "game-ultimate-ttt",
          save,
        ),
      );
      assert.equal(R.replay([...s.path, 0], chain), null);
    }
  assert(longest > 81, "reset histories can exceed 81 moves");
  lockedResults();
  assert.equal(tournament.games.length, 160);
  for (const game of tournament.games) {
    const final = R.replay(game.path, game.chain);
    assert(final && final.status !== "playing");
    assert.equal(final.winner, game.winner);
    assert.deepEqual(game.path.slice(0, game.opening.length), game.opening);
    assert.equal(game.stats.length, game.path.length - game.opening.length);
  }
  for (const chain of [false, true])
    for (const strong of ["normal", "hard"]) {
      const games = tournament.games.filter(
        (g) => g.chain === chain && g.strong === strong,
      );
      assert.equal(games.length, 40);
      const openings = new Map();
      for (const g of games) {
        const key = JSON.stringify(g.opening);
        if (!openings.has(key)) openings.set(key, new Set());
        openings.get(key).add(g.strongSide);
      }
      assert.equal(openings.size, 20);
      assert([...openings.values()].every((sides) => sides.size === 2));
      assert(games.reduce((n, g) => n + g.score, 0) > 20);
    }
  assert.equal(
    R.restore({
      version: 1,
      state: {
        mode: "local",
        difficulty: "normal",
        human: 1,
        chain: false,
        path: [0, 0],
      },
    }),
    null,
  );
  console.log(
    "Rules, locked outcomes, territory endings, reset, encoding, 100 complete games and >81-ply archive replay passed.",
  );
}
async function verifyLockedPrompt(page) {
  const gameId = "game-ultimate-ttt";
  const key = "worktime.games.ultimate-ttt.v1";
  const saved = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)).state, key);
  async function open(game, length, mode, human) {
    const state = {
      mode,
      human,
      difficulty: "easy",
      chain: game.chain,
      path: game.path.slice(0, length),
    };
    await page.evaluate(
      ({ key, state }) =>
        localStorage.setItem(key, JSON.stringify({ version: 1, state })),
      { key, state },
    );
    await launchGame(page, gameId);
    return state;
  }
  const root = page.locator(".game-ultimate-ttt");
  const prompt = root.locator('.uttt-stage [role="dialog"]');
  const heading = prompt.locator("h3");
  const resume = prompt.getByRole("button", { name: "继续游戏" });
  const restart = prompt.getByRole("button", { name: "重新开始" });
  const cell = (p) => root.locator(`[data-cell="${p}"]`);
  const undo = root.locator('[data-uttt-action="undo"]');

  await page.setViewportSize({ width: 390, height: 844 });
  await open(drawGame, 58, "local", 1);
  assert.equal(await prompt.count(), 0);
  await cell(drawGame.path[58]).click();
  await prompt.waitFor();
  assert.equal(await heading.textContent(), "本局已锁定平局");
  assert.equal(await root.getAttribute("data-status"), "playing");
  assert.equal(await root.locator(".uttt-result-layer").isVisible(), false);
  assert.equal(
    await resume.evaluate((button) => document.activeElement === button),
    true,
  );
  assert.equal(
    await cell(drawGame.path[59]).getAttribute("aria-disabled"),
    "true",
  );
  await cell(drawGame.path[59]).evaluate((button) => button.click());
  assert.deepEqual((await saved()).path, drawGame.path.slice(0, 59));
  await page.keyboard.press("Tab");
  assert.equal(
    await restart.evaluate((button) => document.activeElement === button),
    true,
  );
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await prompt.waitFor({ state: "hidden" });
  await cell(drawGame.path[59]).click();
  assert.equal(await prompt.count(), 0);
  await undo.click();
  assert.equal(await prompt.count(), 0);
  await undo.click();
  await cell(drawGame.path[58]).click();
  await prompt.waitFor();
  await resume.click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
  await launchGame(page, gameId);
  await prompt.waitFor();
  assert.equal(
    await resume.evaluate((button) => document.activeElement === button),
    true,
  );
  await resume.click();
  for (const p of drawGame.path.slice(59)) await cell(p).click();
  assert.equal(await root.getAttribute("data-status"), "draw");
  assert.equal(await prompt.count(), 0);

  const ai = await open(chainGame, 146, "ai", -1);
  await prompt.waitFor();
  assert.equal(await heading.textContent(), "O 已锁定胜局");
  assert.equal(
    await root.locator(".uttt-status").getAttribute("data-thinking"),
    "false",
  );
  assert.deepEqual(await saved(), ai);
  await resume.click();
  await page.waitForFunction(
    (key) => JSON.parse(localStorage.getItem(key)).state.path.length === 147,
    key,
  );
  assert.equal(await prompt.count(), 0);

  await open(chainGame, 146, "ai", -1);
  await restart.click();
  await page.waitForFunction(
    (key) => JSON.parse(localStorage.getItem(key)).state.path.length === 1,
    key,
  );
  const fresh = await saved();
  assert.deepEqual(fresh, { ...ai, path: fresh.path });
  assert.equal(await root.getAttribute("data-status"), "playing");
  assert.equal(await prompt.count(), 0);
  console.log(
    "Locked draw and win prompts, pause, continue, undo, reload and AI restart passed.",
  );
}
async function verifyEndFeedback(page) {
  const gameId = "game-ultimate-ttt";
  const root = page.locator(".game-ultimate-ttt");
  const layer = root.locator(".uttt-result-layer");
  const card = layer.locator(".uttt-result-card");
  const label = card.locator("strong");
  const status = root.locator(".uttt-status");
  const action = (id) => root.locator(`[data-uttt-action="${id}"]`);
  async function open(index, mode = "local", human = 1, finished = false) {
    const game = tournament.games[index];
    const move = game.path.at(-1);
    const state = {
      mode,
      human,
      difficulty: "easy",
      chain: game.chain,
      path: finished ? game.path : game.path.slice(0, -1),
    };
    await page.evaluate(
      (state) =>
        localStorage.setItem(
          "worktime.games.ultimate-ttt.v1",
          JSON.stringify({ version: 1, state }),
        ),
      state,
    );
    await launchGame(page, gameId);
    return root.locator(`[data-cell="${move}"]`);
  }
  async function check(text, mark) {
    await layer.waitFor();
    assert.equal(
      await card.getAttribute("aria-labelledby"),
      "uttt-result-label",
    );
    assert.equal(await layer.getAttribute("data-mark"), mark);
    assert.equal(await label.textContent(), text);
    const symbol = layer.locator(".uttt-result-symbol");
    assert.equal(await symbol.textContent(), mark);
    assert.equal(await symbol.locator("svg").count(), mark === "=" ? 0 : 1);
    assert(
      await card.evaluate((el) => {
        const layer = el.parentElement;
        const board = layer.parentElement.getBoundingClientRect();
        const region = layer.parentElement
          .querySelector(".uttt-region")
          .getBoundingClientRect();
        const card = el.getBoundingClientRect();
        const buttons = [...el.querySelectorAll("button")].map((button) =>
          button.getBoundingClientRect(),
        );
        const style = getComputedStyle(layer);
        return (
          style.overflow === "hidden" &&
          style.pointerEvents === "none" &&
          getComputedStyle(el).pointerEvents === "auto" &&
          Number(
            getComputedStyle(layer.parentElement.querySelector(".uttt-region"))
              .opacity,
          ) < 1 &&
          card.width <= board.width * 0.82 + 1 &&
          card.width > region.width &&
          card.height > region.height &&
          Math.abs(buttons[0].width - buttons[1].width) < 1 &&
          Math.abs(buttons[0].height - buttons[1].height) < 1 &&
          card.height < board.height &&
          Math.abs(card.x + card.width / 2 - board.x - board.width / 2) < 1 &&
          Math.abs(card.y + card.height / 2 - board.y - board.height / 2) < 1
        );
      }),
    );
  }
  const animation = () =>
    card.evaluate((el) => getComputedStyle(el).animationName);

  await page.setViewportSize({ width: 1440, height: 1000 });
  const finalX = await open(1);
  await finalX.focus();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.keyboard.press("Enter");
  await check("X 获胜", "X");
  assert.match(await status.textContent(), /三区连线/);
  const back = card.getByRole("button", { name: "返回" });
  const restart = card.getByRole("button", { name: "重新开始" });
  assert.equal(
    await back.evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(await animation(), "uttt-result-enter");
  await page.clock.runFor(10000);
  assert.equal(await layer.isVisible(), true);
  await page.keyboard.press("Tab");
  assert.equal(
    await restart.evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  assert.equal(await layer.isVisible(), false);
  assert.equal(
    await root
      .locator(".uttt-region")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
    "1",
  );
  assert.equal(
    await finalX.evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(await root.getAttribute("data-status"), "won");
  await page.clock.resume();
  await open(1, "local", 1, true);
  assert.equal(await root.getAttribute("data-status"), "won");
  assert.equal(await layer.isVisible(), false);

  await (await open(0)).click();
  await check("O 获胜", "O");
  await action("undo").click();
  assert.equal(await layer.isVisible(), false);
  assert.equal(await root.getAttribute("data-status"), "playing");

  await (await open(6, "ai")).click();
  await check("你赢了", "X");
  assert.match(await status.textContent(), /占领区域更多/);
  await restart.click();
  assert.equal(await layer.isVisible(), false);
  assert.equal(await root.locator(".game-restart-cover").count(), 0);
  assert.equal(await root.getAttribute("data-status"), "playing");

  await page.evaluate((move) => {
    const games = WorkTimeApp.games;
    window.utttOriginalEngine = games.createUltimateTttEngine;
    games.createUltimateTttEngine = () => ({
      search: () =>
        Promise.resolve({ move, engine: "fixture", simulations: 1 }),
      dispose() {},
    });
  }, tournament.games[0].path.at(-1));
  await open(0, "ai");
  await check("你输了", "O");
  await page.evaluate(() => {
    WorkTimeApp.games.createUltimateTttEngine = window.utttOriginalEngine;
  });
  await action("settings").click();
  assert.equal(await layer.getAttribute("hidden"), "");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    WorkTimeApp.services.preferences.page.saveMotionMode("reduce"),
  );
  await (await open(7)).click();
  await check("平局", "=");
  assert.equal(await animation(), "none");
  await page.clock.fastForward(10000);
  assert.equal(await layer.isVisible(), true);
  await back.click();
  assert.equal(await layer.isVisible(), false);
  assert.match(await status.textContent(), /本局平局/);
  console.log(
    "Board result cards, motion preference, dismissal and saved endings passed.",
  );
}
async function browser() {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await ctx.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(path.join(site, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    await launchGame(page, "game-ultimate-ttt");
    const action = (id) => page.locator(`[data-uttt-action="${id}"]`);
    await action("mode-local").click();
    await page.locator('[data-uttt-option="chain"]').check();
    await action("start-local").click();
    const cell = page.locator('.uttt-cell[data-cell="4"]');
    const title = page.locator(".uttt-controls h3");
    const frames = page.locator(".uttt-region.is-preview");
    const preview = () =>
      page.locator(".uttt-board").getAttribute("data-preview");
    const idleBackground = await cell.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await cell.hover();
    await page.waitForFunction(
      (background) =>
        getComputedStyle(document.querySelector('.uttt-cell[data-cell="4"]'))
          .backgroundColor !== background,
      idleBackground,
    );
    await title.hover();
    const clockTime = Date.now();
    await page.clock.install({ time: clockTime });
    await page.clock.pauseAt(clockTime + 1000);
    await cell.dispatchEvent("pointerenter", { pointerType: "mouse" });
    assert.equal(await preview(), "4");
    assert((await page.locator(".uttt-preview-note").textContent()).trim());
    await page.clock.runFor(99);
    assert.equal(await frames.count(), 0);
    await page.clock.runFor(1);
    assert.equal(await frames.getAttribute("data-region"), "4");
    assert.equal(await page.locator(".uttt-score .uttt-score-row").count(), 2);
    await cell.dispatchEvent("pointerleave", { pointerType: "mouse" });
    assert.equal(await frames.count(), 0);
    await cell.dispatchEvent("pointerenter", { pointerType: "mouse" });
    await page.clock.runFor(50);
    await cell.dispatchEvent("pointerleave", { pointerType: "mouse" });
    await page.clock.runFor(100);
    assert.equal(await preview(), "");
    assert.equal(await frames.count(), 0);
    await page.clock.resume();
    await cell.click();
    assert.equal(
      await page.locator('.uttt-region[data-region="4"]').getAttribute("class"),
      "uttt-region is-active",
    );
    await page.locator('.uttt-cell[data-cell="36"]').click();
    await action("undo").click();
    let save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("worktime.games.ultimate-ttt.v1")),
    );
    assert.deepEqual(save.state.path, [4]);
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    await launchGame(page, "game-ultimate-ttt");
    assert.equal(
      await page.locator('.uttt-cell[data-cell="4"]').textContent(),
      "X",
    );
    for (const locale of ["zh-CN", "en", "zh-TW", "zh-HK", "ko", "ja"]) {
      await page.evaluate(
        (locale) => WorkTimeApp.i18n.setLanguage(locale),
        locale,
      );
      assert(
        !(await page.locator(".uttt-controls").textContent()).includes(
          "games.uttt.",
        ),
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    assert(
      await page
        .locator(".uttt-board")
        .evaluate((el) => el.getBoundingClientRect().width <= innerWidth),
    );
    await page.screenshot({
      path: path.join(root, "test-results/ultimate-ttt-mobile.png"),
    });
    const result = await page.evaluate(async () => {
      const G = WorkTimeApp.games,
        e = G.createUltimateTttEngine();
      try {
        const ready = await e.load();
        const result = await e.search(G.ultimateTttRules.create(), "easy");
        return { ready, result };
      } finally {
        e.dispose();
      }
    });
    assert.equal(result.result.engine, "uttt.ai NMCTS2");
    assert(result.result.simulations > 0);
    assert(result.result.elapsed < 5000);
    const modelChecks = await page.evaluate(async () => {
      const G = WorkTimeApp.games,
        R = G.ultimateTttRules,
        e = G.createUltimateTttEngine();
      const results = [];
      try {
        await e.load();
        for (const chain of [false, true])
          for (const difficulty of ["easy", "normal", "hard"]) {
            const state = R.replay([4], chain);
            const reply = await e.search(state, difficulty);
            if (!R.legal(state).includes(reply.move))
              throw Error("Illegal model move");
            results.push({ chain, difficulty, elapsed: reply.elapsed });
          }
        let seed = 11,
          tactical;
        for (let game = 0; game < 30 && !tactical; game++) {
          let state = R.create(game % 2 === 0);
          while (state.status === "playing") {
            const legal = R.legal(state);
            if (legal.some((p) => R.move(state, p).winner === state.turn)) {
              tactical = state;
              break;
            }
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            state = R.move(state, legal[seed % legal.length]);
          }
        }
        if (!tactical) throw Error("No tactical fixture");
        const reply = await e.search(tactical, "easy");
        if (R.move(tactical, reply.move).winner !== tactical.turn)
          throw Error("Missed immediate win");
        const outstanding = e.search(R.create(), "hard").then(
          () => false,
          () => true,
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
        e.cancel();
        if (!(await outstanding)) throw Error("Cancellation failed");
        return results;
      } finally {
        e.dispose();
      }
    });
    assert.equal(modelChecks.length, 6);
    const archiveRoundTrip = await page.evaluate(async () => {
      const A = WorkTimeApp.services.gameArchive;
      const encoded = await A.encode(A.exportArchive());
      const decoded = await A.decode(encoded);
      return decoded.games["game-ultimate-ttt"];
    });
    assert.deepEqual(archiveRoundTrip.state.path, [4]);
    await page.evaluate(() => {
      const createEngine = WorkTimeApp.games.createUltimateTttEngine;
      window.utttEngineCreations = 0;
      WorkTimeApp.games.createUltimateTttEngine = () => {
        window.utttEngineCreations++;
        return createEngine();
      };
      window.utttNativeWorker = window.Worker;
      window.Worker = class {
        constructor() {
          throw Error("Intentional worker failure");
        }
      };
    });
    await action("settings").click();
    await action("mode-ai").click();
    await action("difficulty-easy").click();
    await action("human--1").click();
    await page.locator('.game-restart-cover [data-game-restart="new"]').click();
    await page.locator(".uttt-engine-error").waitFor({ state: "visible" });
    assert.equal(
      await page.evaluate(() => window.utttEngineCreations),
      1,
      "starting from setup reuses the engine created for prewarming",
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.ultimate-ttt.v1"))
            .state.path.length,
      ),
      0,
    );
    await page.evaluate(() => {
      window.Worker = window.utttNativeWorker;
    });
    await action("retry").click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.ultimate-ttt.v1")).state
          .path.length === 1,
    );
    const humanMove = await page.evaluate(() => {
      const save = JSON.parse(
        localStorage.getItem("worktime.games.ultimate-ttt.v1"),
      ).state;
      const R = WorkTimeApp.games.ultimateTttRules;
      return R.legal(R.replay(save.path, save.chain))[0];
    });
    await page.locator(`.uttt-cell[data-cell="${humanMove}"]`).click();
    await action("undo").click();
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.ultimate-ttt.v1"))
            .state.path.length,
      ),
      1,
      "undo cancels pending AI and restores player decision",
    );
    const desktop = { width: 1440, height: 1000 };
    await page.setViewportSize(desktop);
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await page.screenshot({
      path: path.join(root, "test-results/ultimate-ttt-desktop.png"),
    });
    const heights = await page
      .locator(".uttt-region")
      .evaluateAll((nodes) =>
        nodes.map((el) => el.getBoundingClientRect().height),
      );
    assert(
      Math.max(...heights) - Math.min(...heights) < 1,
      "all nine regions stay equally sized after marks appear",
    );
    const layout = await page.evaluate(() => {
      const box = (selector) =>
        document.querySelector(selector).getBoundingClientRect();
      const board = box(".uttt-board"),
        play = box(".uttt-play"),
        controls = box(".uttt-controls"),
        guide = box(".uttt-guide");
      return {
        centerOffset: Math.abs(
          (board.top + board.bottom - play.top - play.bottom) / 2,
        ),
        topOffset: Math.abs(controls.top - board.top),
        bottomGap: board.bottom - guide.bottom,
      };
    });
    assert(layout.centerOffset < 2, "board is vertically centered");
    assert(layout.topOffset < 2, "sidebar aligns with board top");
    assert(
      layout.bottomGap >= 16 && layout.bottomGap <= 28,
      "rules leave bottom breathing room",
    );
    await verifyLockedPrompt(page);
    await verifyEndFeedback(page);
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      "Offline UI, local play, undo/reload, six locales, mobile and real NMCTS2 passed:",
      result,
    );
    console.log(
      "Both rules × three real AI levels, immediate win, cancellation, archive round-trip, failure/retry and AI undo passed.",
      modelChecks,
    );
  } finally {
    await browser.close();
  }
}
unit();
if (!process.argv.includes("--unit"))
  browser().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
