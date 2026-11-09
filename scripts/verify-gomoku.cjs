"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? root,
);
const context = vm.createContext({
  WorkTimeApp: { games: {}, data: {}, services: {} },
  window: { navigator: {} },
});
for (const file of [
  "assets/data/gomoku-legacy.js",
  "assets/data/gomoku.js",
  "assets/js/games/gomoku-search.js",
  "assets/js/games/gomoku-rules.js",
  "assets/js/services/game-archive.js",
])
  vm.runInContext(fs.readFileSync(path.join(site, file), "utf8"), context);
const app = context.WorkTimeApp,
  rules = app.games.gomokuRules,
  levels = app.data.gomoku;
const copy = (v) => JSON.parse(JSON.stringify(v));
const solutions = new Map();
function canonical(board) {
  const forms = [];
  for (let flip = 0; flip < 2; flip++)
    for (let rot = 0; rot < 4; rot++) {
      const stones = board.flatMap((s, p) => {
        if (!s) return [];
        let x = p % 15,
          y = Math.floor(p / 15);
        if (flip) x = -x;
        for (let n = 0; n < rot; n++) [x, y] = [-y, x];
        return [[x, y, s]];
      });
      const x0 = Math.min(...stones.map((p) => p[0])),
        y0 = Math.min(...stones.map((p) => p[1]));
      forms.push(
        stones
          .map(([x, y, s]) => [x - x0, y - y0, s])
          .sort((a, b) => a[0] - b[0] || a[1] - b[1])
          .join(";"),
      );
    }
  return forms.sort()[0];
}
function verifyRules() {
  const unlimited = {
    id: "unlimited",
    board: Array(225).fill(0),
    goal: 1,
    vct: true,
    solution: [],
  };
  const latePath = [105, 0, 106, 1, 107, 2, 108, 3];
  const lateState = rules.restore(unlimited, latePath);
  assert.equal(lateState.status, "playing", "exceeding optimum is not a loss");
  const lateWin = rules.move(unlimited, lateState, 109);
  assert.equal(lateWin.status, "won", "wins beyond optimum still count");
  assert.deepEqual(copy(rules.restore(unlimited, lateWin.path)), copy(lateWin));
  assert.equal(
    rules.restore(unlimited, [105]).path.length,
    2,
    "old cutoff saves receive White's missing reply",
  );
  const ai = app.games.gomokuAI;
  for (const difficulty of ["normal", "hard", "master"]) {
    const board = Array(225).fill(0);
    assert.equal(ai(board, 1, difficulty), 112);
    for (const p of [106, 107, 108, 109]) board[p] = 2;
    board[105] = 1;
    assert.equal(ai(board, 2, difficulty), 110, difficulty + " takes win");
    assert.equal(ai(board, 1, difficulty), 110, difficulty + " blocks win");
    assert.equal(board[110], 0, "AI does not mutate its input");
  }
  const fork = Array(225).fill(0);
  for (const p of [110, 111, 97, 127]) fork[p] = 2;
  assert.equal(ai(fork, 2, "master"), 112, "Master creates a double four");
  const match = { difficulty: "master", human: 2, path: [112, 113, 97, 128] };
  assert.equal(rules.restoreMatch(match).path.length, 4);
  assert.equal(rules.restoreMatch({ ...match, path: [112, 112] }), null);
  assert.equal(rules.restoreMatch({ ...match, difficulty: "invalid" }), null);
  assert.equal(rules.restoreMatch({ ...match, path: [225] }), null);
  const winningPath = [105, 0, 106, 1, 107, 2, 108, 3, 109];
  assert.equal(
    rules.restoreMatch({ ...match, human: 1, path: winningPath }).status,
    "won",
  );
  assert.equal(
    rules.restoreMatch({ ...match, path: winningPath }).status,
    "lost",
  );
  assert.equal(
    rules.restoreMatch({ ...match, path: [...winningPath, 4] }),
    null,
  );
  const fullBoard = Array.from({ length: 225 }, (_, p) =>
    ((p % 15) + 2 * Math.floor(p / 15)) % 4 < 2 ? 1 : 2,
  );
  const black = [],
    white = [];
  fullBoard.forEach((s, p) => (s === 1 ? black : white).push(p));
  const drawPath = black.flatMap((p, i) =>
    i < white.length ? [p, white[i]] : [p],
  );
  assert.equal(rules.restoreMatch({ ...match, path: drawPath }).status, "draw");
  const matchSave = {
    version: 1,
    current: null,
    drafts: {},
    completed: {},
    match,
  };
  assert.deepEqual(
    copy(app.services.gameArchive.normalize("game-gomoku", matchSave)),
    matchSave,
  );
  assert.equal(levels.length, 100);
  assert.equal(new Set(levels.map((p) => p.board.join(""))).size, 100);
  assert.equal(levels.filter((p) => p.group === "basic").length, 0);
  for (const group of ["easy", "medium", "hard"])
    assert.equal(
      levels.filter((p) => p.group === group).length,
      group === "easy" ? 40 : 30,
    );
  assert(levels.every((p) => p.goal >= 4));
  const vct = levels.filter((p) => p.vct);
  assert.equal(
    new Set(vct.map((p) => canonical(p.board))).size,
    100,
    "no shifted/reflected/rotated duplicates",
  );
  assert.equal(
    new Set(vct.map((p) => canonical(p.board.map((s) => (s === 1 ? 1 : 0)))))
      .size,
    100,
    "100 distinct attacking shapes, independent of white decoration",
  );
  for (const level of levels) {
    const board = [...level.board];
    assert.equal(rules.winningLine(board, 1).length, 0);
    assert.equal(rules.winningLine(board, 2).length, 0);
    const immediate = rules.threats(board, 1);
    assert.equal(immediate.length, 0, level.id);
    if (level.vct) {
      const search = app.games.gomokuSearch;
      if (!process.argv.includes("--ui")) {
        const fours = search.solve(board, level.goal, {
          budget: 80000,
          foursOnly: true,
        });
        assert.equal(fours.cutoff, false, level.id);
        assert.equal(fours.result, null, level.id + " is not pure VCF");
        const short = search.solve(board, 3, { budget: 80000 });
        assert.equal(short.cutoff, false, level.id);
        assert.equal(
          short.result,
          null,
          level.id + " has no short forcing win",
        );
        const proof = search.solve(board, level.goal, { budget: 80000 });
        assert.equal(proof.cutoff, false, level.id);
        assert(
          proof.result?.threes > 0,
          level.id + " requires a non-four threat",
        );
        assert.equal(proof.result.depth, level.goal, level.id);
        assert.deepEqual(copy(proof.result.pv), copy(level.solution));
      }
    } else if (level.goal === 3) {
      assert.equal(
        rules.winInTwo(board),
        null,
        level.id + " is not a two-move puzzle",
      );
      board[level.center] = 1;
      // Check every legal white reply, not just the engine's preferred reply.
      for (let p = 0; p < 225; p++) {
        if (board[p]) continue;
        board[p] = 2;
        assert.equal(rules.winningLine(board, 2).length, 0);
        assert.notEqual(rules.winInTwo(board), null, level.id + " reply " + p);
        board[p] = 0;
      }
    } else if (level.goal === 2) {
      const first = rules.winInTwo(board);
      assert.notEqual(first, null, level.id);
      board[first] = 1;
      for (let p = 0; p < 225; p++) {
        if (board[p]) continue;
        board[p] = 2;
        assert(rules.threats(board, 1).length > 0, level.id + " reply " + p);
        assert.equal(rules.winningLine(board, 2).length, 0);
        board[p] = 0;
      }
    }
    let state = rules.create(level);
    for (let n = 0; n < level.goal && state.status === "playing"; n++) {
      const p = level.vct
        ? level.solution[n * 2]
        : !n
          ? level.center
          : rules.winInTwo(state.board);
      assert.notEqual(p, null);
      const old = copy(state);
      const next = rules.move(level, state, p);
      assert.deepEqual(copy(state), old, "moves are immutable");
      state = next;
    }
    assert.equal(state.status, "won", level.id);
    solutions.set(level.id, [...state.path]);
    assert.deepEqual(copy(rules.restore(level, state.path)), copy(state));
    assert.equal(rules.restore(level, [...state.path, 0]), null);
    assert.equal(rules.restore(level, [225]), null);
    assert.equal(rules.restore(level, ["112"]), null);
    assert.equal(
      rules.move(level, rules.create(level), level.board.findIndex(Boolean)),
      null,
    );
  }
  const level = levels[10],
    round = rules.move(level, rules.create(level), level.solution[0]);
  const archive = app.services.gameArchive;
  const retired = app.data.gomokuRetired.find((p) => p.id === "gm-1");
  const retiredWin = rules.move(
    retired,
    rules.create(retired),
    rules.threats(retired.board, 1)[0],
  );
  const saved = {
    version: 1,
    current: level.id,
    drafts: { [level.id]: { path: round.path } },
    completed: { "gm-1": { path: retiredWin.path } },
  };
  assert.deepEqual(copy(archive.normalize("game-gomoku", saved)), copy(saved));
  const tampered = copy(saved);
  tampered.drafts[level.id].path[1] = tampered.drafts[level.id].path[0];
  assert.throws(() => archive.normalize("game-gomoku", tampered));
  const oldSelection = {
    ...saved,
    current: "gm-1",
    drafts: { "gm-1": { path: [] } },
  };
  assert.equal(archive.normalize("game-gomoku", oldSelection).current, null);
  const store = new Map([[archive.keys["game-gomoku"], JSON.stringify(saved)]]);
  const owner = archive.create(() => ({
    getItem: (key) => store.get(key) ?? null,
  }));
  assert.equal(
    owner.progressSummary("game-gomoku").kind,
    "saved",
    "retired achievements excluded from menu",
  );
  assert.equal(
    rules.restore(level, round.path.slice(0, 1)),
    null,
    "reject missing white reply",
  );
  const rowWrap = Array(225).fill(0);
  for (const p of [13, 14, 15, 16, 17]) rowWrap[p] = 1;
  assert.equal(rules.winningLine(rowWrap, 1).length, 0, "rows do not wrap");
  for (const p of [105, 106, 107, 108, 109, 110]) rowWrap[p] = 1;
  assert.equal(
    rules.winningLine(rowWrap, 1).length,
    5,
    "overlines win in freestyle",
  );
}
async function verifyUI(browser) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    hasTouch: true,
  });
  const errors = [];
  await page.addInitScript(() => {
    const show = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function (...args) {
      const result = show.apply(this, args);
      if (this.id === "onboardingDialog") this.close();
      return result;
    };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  const entry = pathToFileURL(path.join(site, "index.html")).href;
  async function launch() {
    await page.goto(entry);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.waitForFunction(
      () => !document.documentElement.classList.contains("app-loading"),
    );
    // Let the restored workspace selection finish before opening a game.
    await page.waitForTimeout(700);
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await page.waitForFunction(
      () =>
        typeof document.getElementById("date-tab-games")?.onclick ===
        "function",
    );
    await page.evaluate(() => WorkTimeApp.ui.dateInfo.selectTab("games"));
    await page.locator("#gamesPanel").waitFor({ state: "visible" });
    try {
      await launchGame(page, "game-gomoku");
    } catch (error) {
      fs.mkdirSync(path.join(root, "test-results/gomoku"), { recursive: true });
      await page.screenshot({
        path: path.join(root, "test-results/gomoku/launch-failure.png"),
      });
      console.log(
        await page.evaluate(() => ({
          tab: document.getElementById("date-tab-games").outerHTML,
          panel: document
            .getElementById("gamesPanel")
            .getBoundingClientRect()
            .toJSON(),
          parent: document
            .getElementById("gamesPanel")
            .parentElement.outerHTML.slice(0, 400),
          dialogs: [...document.querySelectorAll("dialog[open]")].map(
            (d) => d.id,
          ),
        })),
      );
      throw error;
    }
    await page.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "open",
    );
  }
  const action = (name) => page.locator(`[data-gomoku-action="${name}"]`);
  const square = (p) => page.locator(`.gomoku-cell[data-square="${p}"]`);
  const saved = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("worktime.games.gomoku.v1")),
    );
  await launch();
  await page.clock.install();
  assert.equal(await page.locator(".gomoku-levels:visible button").count(), 40);
  assert.equal(await action("basic").count(), 0);
  assert.equal(await action("goal1").count(), 0);
  assert.equal(await action("goal2").count(), 0);
  for (const name of ["easy", "medium", "hard"]) {
    await action(name).click();
    assert.equal(
      await page.locator(".gomoku-levels:visible button").count(),
      name === "easy" ? 40 : 30,
    );
  }
  await action("easy").click();
  const easy = levels[0];
  await action(easy.id).click();
  for (const p of solutions.get(easy.id).filter((_, i) => i % 2 === 0)) {
    await square(p).focus();
    await page.keyboard.press("Enter");
    await page.clock.fastForward(3100);
  }
  assert.equal(await page.locator(".gomoku-cell.is-winning").count(), 5);
  assert((await saved()).completed[easy.id]);
  await action("undo").click();
  assert.equal(
    (await saved()).drafts[easy.id].path.length,
    (easy.goal - 1) * 2,
  );
  await action("restart").click();
  await action("choose").click();
  await action("hard").click();
  const vct = levels.findLast((entry) => entry.group === "hard");
  await action(vct.id).click();
  const solution = solutions.get(vct.id);
  await square(solution[0]).click();
  assert.equal((await saved()).drafts[vct.id].path.length, 2);
  await launch();
  assert.equal(await square(solution[0]).getAttribute("data-stone"), "1");
  assert.equal(await square(solution[1]).getAttribute("data-stone"), "2");
  const exported = await page.evaluate(async () => {
    await WorkTimeApp.games.prepareArchive();
    const archive = WorkTimeApp.services.gameArchive;
    return archive.decode(await archive.encode(archive.exportArchive()));
  });
  assert(exported.games["game-gomoku"].drafts[vct.id]);
  for (let i = 2; i < solution.length; i += 2) {
    await square(solution[i]).click();
    await page.clock.fastForward(3100);
  }
  assert((await saved()).completed[vct.id]);
  await action("choose").click();
  assert.equal(
    await action(vct.id).getAttribute("data-level-status"),
    "complete",
  );
  const nextVct = levels.find(
    (entry) => entry.group === "hard" && entry.id !== vct.id,
  );
  await action(nextVct.id).click();
  for (const [width, height] of [
    [1280, 900],
    [768, 900],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.locator(".gomoku-board").boundingBox();
    fs.mkdirSync(path.join(root, "test-results/gomoku"), { recursive: true });
    await page.screenshot({
      path: path.join(root, "test-results/gomoku/board-" + width + ".png"),
    });
    assert(
      bounds.width > 180 &&
        bounds.x >= 0 &&
        bounds.x + bounds.width <= width + 1,
      JSON.stringify({ width, height, bounds }),
    );
    assert(Math.abs(bounds.width - bounds.height) < 2);
    await action("restart").scrollIntoViewIfNeeded();
    assert(await action("restart").isVisible());
  }
  await square(solutions.get(nextVct.id)[0]).tap();
  assert.equal((await saved()).drafts[nextVct.id].path.length, 2);
  await action("undo").tap();
  assert.equal((await saved()).drafts[nextVct.id].path.length, 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await square(solutions.get(nextVct.id)[0]).click();
  await page.locator(".gomoku-board[data-replying]").waitFor();
  await action("undo").click();
  assert.equal((await saved()).drafts[nextVct.id].path.length, 0);
  assert.equal(await page.locator(".gomoku-board[data-replying]").count(), 0);
  await square(112).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await square(113).evaluate((cell) => cell === document.activeElement),
    true,
  );
  for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
    await page.evaluate(
      (value) => WorkTimeApp.i18n.setLanguage(value),
      language,
    );
    assert(
      !(await page.locator(".gomoku-status").textContent()).includes("games."),
    );
  }
  await action("choose").click();
  await action("ai").click();
  assert.equal(await action("ai").textContent(), "人机对战");
  assert.equal(await page.locator(".gomoku-difficulties button").count(), 3);
  assert.equal(
    await page
      .locator(".gomoku-match-setup select, .gomoku-match-setup p")
      .count(),
    0,
  );
  for (const difficulty of ["normal", "hard", "master"]) {
    await action("difficulty-" + difficulty).click();
    assert.equal(
      await action("difficulty-" + difficulty).getAttribute("aria-pressed"),
      "true",
    );
    await action("start-black").click();
    assert.equal(await page.locator('.gomoku-cell[data-stone="1"]').count(), 0);
    await square(112).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.gomoku-cell[data-stone="2"]').length === 1,
    );
    assert.equal((await saved()).match.path.length, 2);
    assert.equal((await saved()).match.difficulty, difficulty);
    await action("undo").click();
    assert.equal((await saved()).match.path.length, 0);
    await action("choose").click();
  }
  await action("start-red").click();
  await page.waitForFunction(
    () =>
      document.querySelector('.gomoku-cell[data-square="112"]').dataset
        .stone === "1",
  );
  await square(113).click();
  await action("undo").click(); // Cancel a live worker before its reply.
  assert.deepEqual((await saved()).match.path, [112]);
  await square(113).click();
  await page.waitForFunction(
    () => !document.querySelector(".gomoku-board[data-replying]"),
  );
  const pathBeforeReload = (await saved()).match.path;
  await launch();
  await action("ai").click();
  assert.equal(await action("continue-match").count(), 0);
  await page.locator(".game-level-return").click();
  assert.deepEqual((await saved()).match.path, pathBeforeReload);
  const archiveWithMatch = await page.evaluate(async () => {
    await WorkTimeApp.games.prepareArchive();
    const archive = WorkTimeApp.services.gameArchive;
    return archive.decode(await archive.encode(archive.exportArchive()));
  });
  assert.deepEqual(
    archiveWithMatch.games["game-gomoku"].match.path,
    pathBeforeReload,
  );
  await action("restart").click();
  await page.locator('[data-game-restart="new"]').click();
  await action("choose").click(); // Cancel the computer's opening move.
  const pathAfterLeaving = (await saved()).match.path;
  await page.waitForTimeout(500);
  assert.deepEqual((await saved()).match.path, pathAfterLeaving);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.locator(".gomoku-match-setup").boundingBox();
    assert(
      bounds.width > 160 &&
        bounds.x >= 0 &&
        bounds.x + bounds.width <= width + 1,
    );
    const categories = await Promise.all(
      ["easy", "medium", "hard", "ai"].map((name) =>
        action(name).boundingBox(),
      ),
    );
    assert(
      Math.abs(categories[0].y - categories[1].y) < 1 &&
        Math.abs(categories[0].y - categories[2].y) < 1,
    );
    assert(categories[3].y > categories[0].y + categories[0].height);
    assert(
      Math.abs(
        categories[3].width -
          (categories[2].x + categories[2].width - categories[0].x),
      ) < 2,
    );
    const difficultiesBounds = await page
      .locator(".gomoku-difficulties")
      .boundingBox();
    const startsBounds = await page
      .locator(".gomoku-start-options")
      .boundingBox();
    assert(Math.abs(difficultiesBounds.width - startsBounds.width) < 1);
    assert(Math.abs(difficultiesBounds.x - startsBounds.x) < 1);
    for (const difficulty of ["normal", "hard", "master"]) {
      const box = await action("difficulty-" + difficulty).boundingBox();
      assert(
        Math.abs(box.width - box.height) < 2 && box.width <= 82,
        JSON.stringify({ width, box }),
      );
    }
    await page.screenshot({
      path: path.join(
        root,
        "test-results/gomoku/match-setup-" + width + ".png",
      ),
    });
  }
  for (const name of ["start-red", "start-black"]) {
    await page.mouse.move(0, 0);
    const normal = await action(name).evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await action(name).hover();
    await page.waitForTimeout(250);
    const hovered = await action(name).evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    assert.notEqual(normal, hovered, name + " changes on hover");
    assert.equal(
      await action(name).evaluate((element) => getComputedStyle(element).color),
      "rgb(255, 255, 255)",
    );
    assert.equal(await action(name).locator("strong").textContent(), "开始");
  }
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(root, "test-results/gomoku/match-setup.png"),
  });
  const extendedLevel = levels[0];
  const extendedBoard = [...extendedLevel.board],
    extendedPath = [];
  for (let n = 0; n < (extendedLevel.goal + 1) * 2; n++) {
    const side = (n % 2) + 1;
    const p = extendedBoard.findIndex((stone, p) => {
      if (stone) return false;
      extendedBoard[p] = side;
      const safe = !rules.winningLine(extendedBoard, side).length;
      extendedBoard[p] = 0;
      return safe;
    });
    assert(p >= 0);
    extendedBoard[p] = side;
    extendedPath.push(p);
  }
  const extendedSave = {
    version: 1,
    current: extendedLevel.id,
    drafts: { [extendedLevel.id]: { path: extendedPath } },
    completed: {},
  };
  assert.equal(
    app.services.gameArchive.normalize("game-gomoku", extendedSave).drafts[
      extendedLevel.id
    ].path.length,
    extendedPath.length,
  );
  const oldCutoff = copy(extendedSave);
  oldCutoff.drafts[extendedLevel.id].path = extendedPath.slice(
    0,
    extendedLevel.goal * 2 - 1,
  );
  assert.equal(
    app.services.gameArchive.normalize("game-gomoku", oldCutoff).drafts[
      extendedLevel.id
    ].path.length,
    extendedLevel.goal * 2,
  );
  await page.evaluate(
    (value) =>
      localStorage.setItem("worktime.games.gomoku.v1", JSON.stringify(value)),
    extendedSave,
  );
  await launch();
  assert(
    (await page.locator(".gomoku-objective").textContent()).includes("最优解"),
  );
  assert(
    (await page.locator(".gomoku-status").textContent()).includes("轮到黑方"),
  );
  const nextEmpty = extendedBoard.indexOf(0);
  await square(nextEmpty).click();
  assert(
    (await saved()).drafts[extendedLevel.id]?.path.length >
      extendedPath.length || (await saved()).completed[extendedLevel.id],
  );
  assert.deepEqual(errors, []);
  await page.close();
}
(async () => {
  verifyRules();
  console.log(
    "100 VCT puzzles: all white defenses, winning replays, 40/30/30 categories and legacy archives passed.",
  );
  if (process.argv.includes("--rules")) return;
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    if (!process.argv.includes("--results")) await verifyUI(browser);
    await require("./verify-gomoku-results.cjs")(browser, site);
  } catch (error) {
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        await page
          .screenshot({
            path: path.join(root, "test-results/gomoku/result-failure.png"),
          })
          .catch(() => {});
        console.log(
          await page
            .evaluate(() => {
              const button = document.querySelector(
                '[data-gomoku-action="choose"]',
              );
              const r = button?.getBoundingClientRect();
              return {
                choose: r?.toJSON(),
                hit: r
                  ? document
                      .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
                      ?.outerHTML.slice(0, 200)
                  : null,
              };
            })
            .catch(() => null),
        );
      }
    throw error;
  } finally {
    await browser.close();
  }
  console.log(
    "Offline Gomoku: mouse/keyboard, responsive board, continuation, undo, animation cancellation, languages and archive export passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
