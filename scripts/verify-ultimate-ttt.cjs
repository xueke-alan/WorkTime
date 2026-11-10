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
  const tournament = JSON.parse(
    fs.readFileSync(
      path.join(root, "scripts/utttai/bakeoff-results.json"),
      "utf8",
    ),
  );
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
    "Rules, territory endings, reset, encoding, 100 complete games and >81-ply archive replay passed.",
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
    await action("start").click();
    await page.locator('.uttt-cell[data-cell="4"]').hover();
    assert.equal(
      await page.locator(".uttt-board").getAttribute("data-preview"),
      "4",
    );
    assert.equal(await page.locator(".uttt-region.is-preview").count(), 1);
    assert.equal(await page.locator(".uttt-score .uttt-score-row").count(), 2);
    await page.locator(".uttt-controls h3").hover();
    assert.equal(await page.locator(".uttt-region.is-preview").count(), 0);
    await page.locator('.uttt-cell[data-cell="4"]').click();
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
    await action("start").click();
    await page.locator('[data-game-restart="new"]').click();
    await page.locator(".uttt-engine-error").waitFor({ state: "visible" });
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
