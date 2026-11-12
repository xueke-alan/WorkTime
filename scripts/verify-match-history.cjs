"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) || root,
);
const copy = (value) => JSON.parse(JSON.stringify(value));
const scope = vm.createContext({
  WorkTimeApp: { games: {}, data: {}, services: {} },
  window: { navigator: {}, crypto: webcrypto },
});
for (const name of ["xiangqi", "gomoku", "jungle", "ultimate-ttt"])
  vm.runInContext(
    fs.readFileSync(
      path.join(root, "assets/js/games", name + "-rules.js"),
      "utf8",
    ),
    scope,
  );
for (const name of ["xiangqi", "gomoku"])
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/data", name + ".js"), "utf8"),
    scope,
  );
vm.runInContext(
  fs.readFileSync(
    path.join(root, "assets/js/services/game-archive.js"),
    "utf8",
  ),
  scope,
);
const G = scope.WorkTimeApp.games,
  A = scope.WorkTimeApp.services.gameArchive;
const xqPath = [
  6307, 727, 5761, 1, 8090, 2648, 7901, 2320, 5269, 463, 7277, 198, 6935, 1175,
  4905, 6364, 6441, 1792, 7372, 718, 7444, 8006, 7736, 154, 7533, 5823, 4086,
  5706, 7817, 3277, 7636, 3412, 5633, 2466, 6926, 7466, 7016, 566, 7825, 3194,
  4814, 3467, 5087, 3285, 7736, 2382, 4450, 2830, 4657, 3806, 6117, 2382, 5451,
  3806, 4632, 2382, 7825, 283, 7736, 363, 4268, 1658, 7825, 3438, 7726, 3806,
  7897, 1191, 6113, 2382, 6925, 274, 4003, 463, 3912, 3012, 7734, 1175, 7645,
  373, 7736, 3649, 7533, 1174, 7825, 4468, 5717, 373, 7736, 1622, 7817, 4096,
  4293, 1192, 5717, 4187, 7016, 463, 7825, 4276, 7734, 2003, 7635, 5277, 6834,
  1175, 7645, 202, 7726, 2018, 6915, 3442, 6834, 5196, 7645, 6007, 7734, 2018,
  7645, 4187, 7734, 4278, 7645, 6098, 7736, 4377, 7825, 2084, 7726, 6197, 6925,
  3438, 7734, 1283, 7645, 5196, 7734, 2092,
];
const junglePath = [],
  route = [42, 35, 28, 21, 14, 15, 22, 23, 24, 17, 10, 3];
for (let i = 0; i < route.length - 1; i++) {
  junglePath.push([route[i], route[i + 1]]);
  if (i < route.length - 2) junglePath.push(i % 2 ? [5, 6] : [6, 5]);
}
const tournament = JSON.parse(
  fs.readFileSync(
    path.join(root, "scripts/utttai/bakeoff-results.json"),
    "utf8",
  ),
).games;
const ttt = tournament.find(
  (game) =>
    game.chain && G.ultimateTttRules.replay(game.path, true).status === "won",
);
const fixtures = [
  {
    name: "xiangqi",
    config: {
      difficulty: "hard",
      humanRed: false,
      handicaps: [],
      undosRemaining: 4,
      initialBoard: G.xiangqiRules.parse(G.xiangqiRules.initialPosition),
    },
    path: xqPath,
  },
  {
    name: "gomoku",
    config: { difficulty: "hard", human: 1, forbidden: true },
    path: [105, 0, 106, 1, 107, 2, 108, 3, 109],
  },
  {
    name: "ultimate-ttt",
    config: { mode: "local", difficulty: "hard", human: 1, chain: true },
    path: ttt.path,
  },
  {
    name: "jungle",
    config: { mode: "local", difficulty: "hard", human: 1 },
    path: junglePath,
  },
].map((fixture) => ({
  ...fixture,
  id: "game-" + fixture.name,
  key: A.keys["game-" + fixture.name],
}));
function saveFor(fixture, path = fixture.path.slice(0, -1)) {
  const state = { ...copy(fixture.config), path: copy(path) };
  return ["xiangqi", "gomoku"].includes(fixture.name)
    ? { version: 1, current: null, drafts: {}, completed: {}, match: state }
    : { version: 1, state };
}
function unit() {
  for (const fixture of fixtures) {
    const { id, config, path } = fixture;
    const saved = saveFor(fixture);
    assert(A.normalize(id, saved));
    A.recordMatch(saved, id, config, []);
    assert.equal(
      saved.matchHistory,
      undefined,
      "incomplete games are excluded",
    );
    saved.matchHistory = Array.from({ length: 10 }, (_, i) => ({
      id: "old-" + (i + 1),
      finishedAt: i + 1,
      config: copy(config),
      path: copy(path),
    }));
    saved.matchHistory = copy(A.normalizeMatches(id, saved.matchHistory));
    A.recordMatch(saved, id, config, path);
    assert.equal(saved.matchHistory.length, 10);
    assert(!saved.matchHistory.some((record) => record.id === "old-1"));
    const completed = copy(saved.matchHistory);
    A.recordMatch(saved, id, config, path);
    assert.deepEqual(
      copy(saved.matchHistory),
      completed,
      "undo and re-win cannot record the same session twice",
    );
    const restored = A.normalize(id, copy(saved));
    restored.matchSession.recorded = false;
    A.recordMatch(restored, id, config, path);
    assert.deepEqual(
      copy(restored.matchHistory),
      completed,
      "dedup survives persistence",
    );
    const merged = A.merge(
      id,
      A.normalize(id, saveFor(fixture)),
      restored,
    ).value;
    assert.equal(merged.matchHistory.length, 10);
    assert.equal(A.merge(id, restored, restored).value.matchHistory.length, 10);
    assert.throws(
      () => A.normalizeMatches(id, [{ ...completed[0], path: [] }]),
      "unfinished history is rejected",
    );
    assert.throws(
      () => A.normalizeMatches(id, [{ ...completed[0], winner: 0 }]),
      "outcome is derived from replay",
    );
    const alt = copy(config);
    if (fixture.name === "xiangqi") alt.humanRed = !alt.humanRed;
    else alt.human = fixture.name === "gomoku" ? 3 - alt.human : -alt.human;
    assert(
      A.normalizeMatches(id, [
        {
          id: "other-perspective",
          finishedAt: 1,
          config: alt,
          path: copy(path),
        },
      ]),
    );
    saved.matchSession = A.newMatchSession();
    A.recordMatch(saved, id, config, path);
    assert.notEqual(
      saved.matchHistory[0].id,
      completed[0].id,
      "a new session can earn a new record",
    );
  }
  for (const side of [1, -1]) {
    const game = tournament.find(
      (game) =>
        !game.chain && G.ultimateTttRules.replay(game.path).winner === side,
    );
    assert(game);
    assert.equal(
      A.normalizeMatches("game-ultimate-ttt", [
        {
          id: "winner-" + side,
          finishedAt: 1,
          config: { mode: "local", difficulty: "hard", human: 1, chain: false },
          path: game.path,
        },
      ])[0].winner,
      side,
    );
  }
  const draw = tournament.find(
    (game) =>
      G.ultimateTttRules.replay(game.path, game.chain).status === "draw",
  );
  const drawSave = {};
  A.recordMatch(
    drawSave,
    "game-ultimate-ttt",
    { mode: "local", difficulty: "hard", human: 1, chain: draw.chain },
    draw.path,
  );
  assert.equal(drawSave.matchHistory, undefined, "draws are excluded");
  assert.throws(() =>
    A.normalizeMatches("game-ultimate-ttt", [
      {
        id: "draw",
        finishedAt: 1,
        config: {
          mode: "local",
          difficulty: "hard",
          human: 1,
          chain: draw.chain,
        },
        path: draw.path,
      },
    ]),
  );
}
async function browserTest() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const fixture of [
      ...fixtures,
      {
        ...fixtures[1],
        config: { ...fixtures[1].config, human: 2 },
        aiFinal: true,
      },
    ]) {
      const { name, id, key, config, path: fullPath } = fixture;
      const context = await browser.newContext({
        locale: "zh-CN",
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(path.join(site, "index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(
        async ({ id, aiFinal, final }) => {
          await WorkTimeApp.games.load(id);
          await WorkTimeApp.services.preferences.page.saveMotionMode("reduce");
          const G = WorkTimeApp.games;
          const base = { load: async () => {}, cancel() {}, dispose() {} };
          window.matchEngineCalls = 0;
          G.createXiangqiEngine = () => ({
            ...base,
            search: () => {
              window.matchEngineCalls++;
              return new Promise(() => {});
            },
          });
          G.createGomokuEngine = () => ({
            ...base,
            search: () => {
              window.matchEngineCalls++;
              if (aiFinal) return Promise.resolve({ move: final });
              return new Promise(() => {});
            },
          });
          G.createUltimateTttEngine = () => ({
            ...base,
            search: () => {
              window.matchEngineCalls++;
              return new Promise(() => {});
            },
          });
        },
        { id, aiFinal: !!fixture.aiFinal, final: fullPath.at(-1) },
      );
      const seed = saveFor(fixture);
      seed.matchSession = { id: "current-" + name, recorded: false };
      seed.matchHistory = A.normalizeMatches(
        id,
        Array.from({ length: 10 }, (_, i) => ({
          id: "old-" + (i + 1),
          finishedAt: i + 1,
          config: copy(config),
          path: copy(fullPath),
        })),
      );
      await page.evaluate(
        ({ key, seed }) => localStorage.setItem(key, JSON.stringify(seed)),
        { key, seed: copy(seed) },
      );
      await launchGame(page, id);
      const game = page.locator(".game-" + name);
      const dialog = game.locator(
        '.game-restart-cover:not([hidden]) [data-game-restart="continue"]',
      );
      if (await dialog.isVisible()) await dialog.click();
      const read = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
      const boardSnapshot = () =>
        game.evaluate((el) =>
          [...el.querySelectorAll("[data-square], [data-cell]")].map((cell) => [
            cell.dataset.square ?? cell.dataset.cell,
            cell.querySelector(".xiangqi-piece")?.textContent,
            cell.dataset.stone,
            cell.dataset.side,
            cell.querySelector(".jungle-piece")?.hidden,
            cell.querySelector(".jungle-piece")?.dataset.side,
            cell.querySelector(".jungle-animal")?.dataset.kind,
          ]),
        );
      const final = fullPath.at(-1);
      async function finish() {
        if (name === "xiangqi") {
          const [from, to] = G.xiangqiRules.decode(final);
          await game.locator(`[data-square="${from}"]`).click();
          await game.locator(`[data-square="${to}"]`).click();
        } else if (name === "gomoku")
          await game.locator(`[data-square="${final}"]`).click();
        else if (name === "ultimate-ttt")
          await game.locator(`[data-cell="${final}"]`).click();
        else {
          await game.locator(`[data-square="${final[0]}"]`).click();
          await game.locator(`[data-square="${final[1]}"]`).click();
        }
      }
      if (!fixture.aiFinal) await finish();
      await page.waitForFunction(
        (key) =>
          JSON.parse(localStorage.getItem(key)).matchHistory?.[0].id.startsWith(
            "current-",
          ),
        key,
      );
      const finished = await read();
      assert.equal(finished.matchHistory.length, 10);
      assert(finished.matchSession.recorded);
      const actionPrefix = name === "ultimate-ttt" ? "uttt" : name;
      if (!fixture.aiFinal) {
        await game.locator(`[data-${actionPrefix}-action="undo"]`).click();
        if (await dialog.isVisible()) await dialog.click();
        await finish();
      }
      assert.deepEqual(
        (await read()).matchHistory,
        finished.matchHistory,
        "rewinning does not duplicate the match",
      );
      const finalBoard = await boardSnapshot();
      const choose = ["xiangqi", "gomoku"].includes(name)
        ? "choose"
        : "settings";
      await game.locator(`[data-${actionPrefix}-action="${choose}"]`).click();
      const panel = game.locator(".game-match-history");
      await panel.waitFor({ state: "visible" });
      const row = panel.locator(".game-completion-row").first();
      assert.match(
        await row.textContent(),
        fixture.aiFinal
          ? /对局记录-\d{8}-困难-失败/
          : /对局记录-\d{8}-(困难|人人对战)-.*胜利/,
      );
      assert.equal(await panel.locator(".game-completion-row").count(), 10);
      const snapshot = await read();
      const engineCalls = await page.evaluate(() => window.matchEngineCalls);
      await row.locator("button").click();
      const transport = game.locator(".game-replay-controls:visible");
      const action = (name) =>
        transport.locator(`[data-replay-action="${name}"]`);
      await action("play").click();
      assert.equal(
        await transport.locator(".game-replay-progress").textContent(),
        `0 / ${fullPath.length}`,
      );
      const initialBoard = await boardSnapshot();
      await action("next").click();
      await action("previous").click();
      assert.deepEqual(await boardSnapshot(), initialBoard);
      await transport
        .locator('[data-replay-action="next"]')
        .evaluate((button, length) => {
          for (let i = 0; i < length; i++) button.click();
        }, fullPath.length);
      assert.deepEqual(
        await boardSnapshot(),
        finalBoard,
        name + " final replay board",
      );
      assert.deepEqual(await read(), snapshot, "replay never writes");
      await action("play").click();
      await page.waitForTimeout(800);
      assert.notEqual(
        await transport.locator(".game-replay-progress").textContent(),
        `0 / ${fullPath.length}`,
      );
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const progress = await transport
        .locator(".game-replay-progress")
        .textContent();
      await page.waitForTimeout(800);
      assert.equal(
        await transport.locator(".game-replay-progress").textContent(),
        progress,
      );
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await action("exit").click();
      assert.equal(
        await page.evaluate(() => window.matchEngineCalls),
        engineCalls,
        "replay does not start AI searches",
      );
      assert(await panel.isVisible());
      assert.deepEqual(await read(), snapshot);
      const restored = await page.evaluate(async (id) => {
        const A = WorkTimeApp.services.gameArchive;
        const owner = A.create(() => ({
          getItem: (key) =>
            key === A.keys[id] ? localStorage.getItem(key) : null,
        }));
        return (await A.decode(await A.encode(owner.exportArchive()))).games[id]
          .matchHistory;
      }, id);
      assert.deepEqual(restored, snapshot.matchHistory);
      const output = path.join(root, "test-results/match-history");
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, name + "-desktop.png") });
      await page.setViewportSize({ width: 390, height: 900 });
      assert(await row.locator("button").isVisible());
      assert(
        (await panel.boundingBox()).height > 100,
        "history gets a scrollable area on mobile",
      );
      await page.screenshot({ path: path.join(output, name + "-mobile.png") });
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        name +
          ": complete match recording, ten-record retention, playback, restoration, transport and responsive list passed",
      );
    }
  } finally {
    await browser.close();
  }
}
unit();
(process.argv.includes("--unit") ? Promise.resolve() : browserTest())
  .then(() => console.log("Match history checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
