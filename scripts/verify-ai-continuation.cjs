"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site =
  process.argv[2] && !process.argv[2].startsWith("--")
    ? path.resolve(process.argv[2])
    : root;
const copy = (value) => JSON.parse(JSON.stringify(value));
const context = vm.createContext({
  WorkTimeApp: { games: {}, data: {}, services: {} },
  window: { navigator: {} },
});
for (const name of ["xiangqi", "gomoku"]) {
  vm.runInContext(
    fs.readFileSync(path.join(root, `assets/data/${name}.js`), "utf8"),
    context,
  );
}
for (const name of ["xiangqi", "gomoku", "jungle", "ultimate-ttt"]) {
  vm.runInContext(
    fs.readFileSync(
      path.join(root, `assets/js/games/${name}-rules.js`),
      "utf8",
    ),
    context,
  );
}
vm.runInContext(
  fs.readFileSync(
    path.join(root, "assets/js/services/game-archive.js"),
    "utf8",
  ),
  context,
);
const G = context.WorkTimeApp.games;
const A = context.WorkTimeApp.services.gameArchive;
const X = G.xiangqiRules;
const empty = () => ({ version: 1, current: null, drafts: {}, completed: {} });
function xiangqi(humanRed = true, handicaps = []) {
  const board = X.parse(X.initialPosition).split("");
  const pairs = humanRed ? [0, 1, 19] : [81, 82, 64];
  ["R", "H", "C"].forEach((piece, index) => {
    if (handicaps.includes(piece)) board[pairs[index]] = ".";
  });
  return {
    difficulty: "hard",
    humanRed,
    handicaps,
    initialBoard: board.join(""),
    undosRemaining: 4 - handicaps.length,
    path: [],
  };
}
function fixtures() {
  const xq = xiangqi(true, ["R", "H"]);
  xq.path.push(X.legalMoves(xq.initialBoard, true)[0]);
  const jr = G.jungleRules;
  return {
    xiangqi: { ...empty(), match: xq },
    gomoku: {
      ...empty(),
      forbidden: true,
      match: { difficulty: "hard", human: 1, forbidden: true, path: [112] },
    },
    jungle: {
      version: 1,
      state: {
        mode: "ai",
        difficulty: "hard",
        human: 1,
        path: [copy(jr.legal(jr.create().board, 1)[0])],
      },
    },
    "ultimate-ttt": {
      version: 1,
      state: {
        mode: "ai",
        difficulty: "hard",
        human: 1,
        chain: true,
        path: [0],
      },
    },
  };
}
function unit() {
  for (const red of [true, false])
    for (const handicaps of [[], ["R"], ["R", "H", "C"]]) {
      const match = xiangqi(red, handicaps);
      assert.equal(X.restoreMatch(match).board, match.initialBoard);
      for (let step = 0; step < 5; step++) {
        const position = X.restoreMatch(match);
        match.path.push(X.legalMoves(position.board, step % 2 === 0)[0]);
        assert.ok(X.restoreMatch(match));
      }
      assert.deepEqual(
        copy(A.normalize("game-xiangqi", { ...empty(), match }).match),
        match,
      );
      for (const patch of [
        { difficulty: "invalid" },
        { humanRed: 1 },
        { handicaps: ["R", "R"] },
        { initialBoard: ".".repeat(90) },
        { path: [0] },
        { path: [1.5] },
        { undosRemaining: 5 },
        { undosRemaining: -1 },
        { undosRemaining: 0.5 },
      ])
        assert.equal(X.restoreMatch({ ...match, ...patch }), null);
    }
  for (const [name, save] of Object.entries(fixtures())) {
    const id = `game-${name}`;
    assert.deepEqual(copy(A.normalize(id, save)), save);
    assert.equal(A.hasContent(id, save), true);
    if (!["xiangqi", "gomoku"].includes(name)) continue;
    assert.deepEqual(copy(A.normalize(id, empty())).drafts, {});
    const incoming = copy(save);
    incoming.match.difficulty = "normal";
    for (const source of ["local", "incoming"]) {
      const merged = A.merge(id, save, incoming, source);
      assert.equal(merged.conflict, true);
      assert.deepEqual(
        copy(merged.value.match),
        source === "local" ? save.match : incoming.match,
      );
      assert.deepEqual(
        copy(A.merge(id, empty(), save, source).value.match),
        save.match,
      );
      assert.deepEqual(
        copy(A.merge(id, save, empty(), source).value.match),
        save.match,
      );
    }
    const blank = copy(save);
    blank.match.path = [];
    assert.equal(A.hasContent(id, blank), true);
    const owner = A.create(() => ({
      getItem: (key) => (key === A.keys[id] ? JSON.stringify(blank) : null),
    }));
    assert.equal(owner.progressSummary(id).kind, "saved");
  }
  console.log(
    "AI saves: validation, handicaps, zero-move sessions, old saves and conflict selection passed.",
  );
}
async function browser() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const errors = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const show = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function (...args) {
        const result = show.apply(this, args);
        if (this.id === "onboardingDialog") this.close();
        return result;
      };
    });
    await page.route(/^https?:/, (route) => route.abort());
    const entry = pathToFileURL(path.join(site, "index.html")).href;
    async function ready() {
      await page.goto(entry);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
        null,
        { timeout: 45000 },
      );
      await page.waitForFunction(
        () => !document.documentElement.classList.contains("app-loading"),
      );
      await page.evaluate(() =>
        WorkTimeApp.services.preferences.page.saveMotionMode("reduce"),
      );
      await page.evaluate(() =>
        WorkTimeApp.services.preferences.page.saveAutoBackupDays(0),
      );
      await page.waitForTimeout(700);
      await page.waitForFunction(
        () =>
          typeof document.getElementById("date-tab-games")?.onclick ===
          "function",
      );
    }
    async function mock(name) {
      await page.evaluate(async (name) => {
        const G = WorkTimeApp.games;
        await G.load(`game-${name}`);
        window.aiReplies = [];
        const pending = (value) =>
          new Promise((resolve) => window.aiReplies.push(() => resolve(value)));
        const base = { load: async () => {}, cancel() {}, dispose() {} };
        if (name === "xiangqi")
          G.createXiangqiEngine = () => ({
            ...base,
            search: () => {
              const match = JSON.parse(
                localStorage.getItem(
                  WorkTimeApp.services.gameArchive.keys["game-xiangqi"],
                ),
              ).match;
              const R = G.xiangqiRules,
                position = R.restoreMatch(match);
              const [from, to] = R.decode(
                R.legalMoves(position.board, match.path.length % 2 === 0)[0],
              );
              const square = (p) =>
                String.fromCharCode(97 + (p % 9)) + (9 - Math.floor(p / 9));
              return pending(square(from) + square(to));
            },
          });
        if (name === "gomoku")
          G.createGomokuEngine = () => ({
            ...base,
            search: (state) =>
              pending({ move: state.board.findIndex((piece) => !piece) }),
          });
        if (name === "ultimate-ttt")
          G.createUltimateTttEngine = () => ({
            ...base,
            search: (state) =>
              pending({
                move: G.ultimateTttRules.legal(state)[0],
                engine: "test",
                simulations: 1,
              }),
          });
        if (name === "jungle")
          G.jungleEngine.search = (state, difficulty, callbacks) => {
            window.aiReplies.push(() =>
              callbacks.onResult({
                move: G.jungleRules.legal(state.board, state.turn)[0],
                engine: "test",
                depth: 1,
                nodes: 1,
              }),
            );
            return { cancel() {} };
          };
      }, name);
    }
    async function read(name) {
      return page.evaluate(
        (name) =>
          JSON.parse(
            localStorage.getItem(
              WorkTimeApp.services.gameArchive.keys[`game-${name}`],
            ),
          ),
        name,
      );
    }
    async function exit() {
      await page.locator("#gameExitButton").click();
      await page.locator("#gameShell").waitFor({ state: "hidden" });
    }
    for (const [name, save] of Object.entries(fixtures())) {
      console.log(`Testing ${name}`);
      await ready();
      await page.evaluate(
        ({ name, save }) =>
          localStorage.setItem(
            WorkTimeApp.services.gameArchive.keys[`game-${name}`],
            JSON.stringify(save),
          ),
        { name, save },
      );
      await mock(name);
      await launchGame(page, `game-${name}`);
      await page.waitForFunction(() => window.aiReplies.length > 0);
      assert.deepEqual(
        await read(name),
        save,
        `${name}: AI search does not change saved moves`,
      );
      await exit();
      // Resolve the cancelled search deliberately: it must never mutate a departed game.
      await page.evaluate(() =>
        window.aiReplies.splice(0).forEach((resolve) => resolve()),
      );
      await page.waitForTimeout(150);
      assert.deepEqual(await read(name), save);
      await launchGame(page, `game-${name}`);
      await page.waitForFunction(() => window.aiReplies.length > 0);
      await page.evaluate(() =>
        window.aiReplies.splice(0).forEach((resolve) => resolve()),
      );
      await page.waitForFunction(
        ({ name, before }) => {
          const save = JSON.parse(
            localStorage.getItem(
              WorkTimeApp.services.gameArchive.keys[`game-${name}`],
            ),
          );
          return (save.match ?? save.state).path.length === before + 1;
        },
        { name, before: (save.match ?? save.state).path.length },
      );
      const after = await read(name);
      await exit();
      await ready();
      await mock(name);
      await launchGame(page, `game-${name}`);
      assert.deepEqual(
        await read(name),
        after,
        `${name}: reload preserves settings and moves`,
      );
      await page.waitForTimeout(200);
      assert.equal(
        await page.evaluate(() => window.aiReplies.length),
        0,
        `${name}: human turn does not search`,
      );
      await exit();
      console.log(
        `${name}: pending AI exit, stale reply cancellation, one resumed move and page reload passed.`,
      );
    }
    // No moves have been played yet when the human chooses the second side.
    for (const [name, base] of Object.entries(fixtures())) {
      await ready();
      const save = copy(base);
      const match = save.match ?? save.state;
      match.path = [];
      if (name === "xiangqi") Object.assign(match, xiangqi(false, ["C"]));
      else match.human = name === "gomoku" ? 2 : -1;
      await page.evaluate(
        ({ name, save }) =>
          localStorage.setItem(
            WorkTimeApp.services.gameArchive.keys[`game-${name}`],
            JSON.stringify(save),
          ),
        { name, save },
      );
      await mock(name);
      await launchGame(page, `game-${name}`);
      await page.waitForFunction(() => window.aiReplies.length > 0);
      assert.deepEqual(await read(name), save);
      await exit();
      await ready();
      await mock(name);
      await launchGame(page, `game-${name}`);
      await page.waitForFunction(() => window.aiReplies.length > 0);
      await page.evaluate(() =>
        window.aiReplies.splice(0).forEach((resolve) => resolve()),
      );
      await page.waitForFunction((name) => {
        const save = JSON.parse(
          localStorage.getItem(
            WorkTimeApp.services.gameArchive.keys[`game-${name}`],
          ),
        );
        return (save.match ?? save.state).path.length === 1;
      }, name);
      await exit();
      console.log(
        `${name}: zero-move second-side session survives reload and resumes AI opening.`,
      );
    }
    // Real controls must save the new board and update undo allowances immediately.
    for (const name of ["xiangqi", "gomoku"]) {
      await ready();
      const save = copy(fixtures()[name]);
      if (name === "xiangqi") save.match = xiangqi();
      else save.match.path = [];
      await page.evaluate(
        ({ name, save }) =>
          localStorage.setItem(
            WorkTimeApp.services.gameArchive.keys[`game-${name}`],
            JSON.stringify(save),
          ),
        { name, save },
      );
      await mock(name);
      await launchGame(page, `game-${name}`);
      assert.deepEqual(await read(name), save);
      if (name === "xiangqi") {
        await page.locator('.xiangqi-cell[data-square="54"]').click();
        await page.locator('.xiangqi-cell[data-square="45"]').click();
      } else await page.locator(".gomoku-cell").nth(112).click();
      await page.waitForFunction(() => window.aiReplies.length > 0);
      assert.equal((await read(name)).match.path.length, 1);
      await page.locator(`[data-${name}-action="undo"]`).click();
      assert.equal((await read(name)).match.path.length, 0);
      if (name === "xiangqi")
        assert.equal((await read(name)).match.undosRemaining, 3);
      await page.locator(`[data-${name}-action="choose"]`).click();
      await page
        .locator(
          `[data-${name}-action="start-${name === "xiangqi" ? "red" : "black"}"]`,
        )
        .click();
      assert.equal((await read(name)).match.path.length, 0);
      if (name === "xiangqi")
        assert.equal((await read(name)).match.undosRemaining, 4);
      await exit();
    }
    for (const name of ["xiangqi", "gomoku"]) {
      await ready();
      await mock(name);
      await page.evaluate((name) => {
        const level = WorkTimeApp.data[name][0];
        const A = WorkTimeApp.services.gameArchive;
        const save = JSON.parse(localStorage.getItem(A.keys[`game-${name}`]));
        save.current = level.id;
        save.drafts[level.id] = { path: [] };
        localStorage.setItem(A.keys[`game-${name}`], JSON.stringify(save));
      }, name);
      await launchGame(page, `game-${name}`);
      const category = await page
        .locator(`.game-${name}`)
        .getAttribute(name === "xiangqi" ? "data-mode" : "data-category");
      assert.notEqual(category, name === "xiangqi" ? "versus" : "ai");
      assert.equal(await page.evaluate(() => window.aiReplies.length), 0);
      await exit();
    }
    for (const name of ["xiangqi", "gomoku"]) {
      await ready();
      const save = copy(fixtures()[name]);
      if (name === "gomoku") {
        save.match.forbidden = false;
        save.match.path = [105, 0, 106, 1, 107, 2, 108, 3, 109];
      } else {
        save.match = xiangqi();
        const moves = [
          [82, 63],
          [1, 18],
          [63, 82],
          [18, 1],
        ];
        save.match.path = [...moves, ...moves].map(([from, to]) =>
          X.encode(from, to),
        );
        assert.equal(X.restoreMatch(save.match).status, "draw");
      }
      await page.evaluate(
        ({ name, save }) =>
          localStorage.setItem(
            WorkTimeApp.services.gameArchive.keys[`game-${name}`],
            JSON.stringify(save),
          ),
        { name, save },
      );
      await mock(name);
      await launchGame(page, `game-${name}`);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.aiReplies.length), 0);
      assert.deepEqual(await read(name), save);
      await exit();
    }
    const roundTrip = await page.evaluate(async () => {
      const A = WorkTimeApp.services.gameArchive;
      const archive = A.exportArchive();
      const decoded = await A.decode(await A.encode(archive));
      return { expected: archive.games, actual: decoded.games };
    });
    assert.deepEqual(roundTrip.actual, roundTrip.expected);
    console.log(
      "Player moves, undo allowances, new games, puzzle priority, terminal restores and archive round trip passed.",
    );
    for (const name of ["xiangqi", "gomoku"]) {
      await ready();
      const save = copy(fixtures()[name]);
      save.match.path = [];
      await page.evaluate(
        ({ name, save }) =>
          localStorage.setItem(
            WorkTimeApp.services.gameArchive.keys[`game-${name}`],
            JSON.stringify(save),
          ),
        { name, save },
      );
      await mock(name);
      await launchGame(page, `game-${name}`);
      await page.evaluate((name) => {
        const key = WorkTimeApp.services.gameArchive.keys[`game-${name}`];
        window.aiOriginalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key) throw Error("Storage full");
          return window.aiOriginalSetItem.call(this, name, value);
        };
      }, name);
      if (name === "xiangqi") {
        await page.locator('.xiangqi-cell[data-square="54"]').click();
        await page.locator('.xiangqi-cell[data-square="45"]').click();
      } else await page.locator('.gomoku-cell[data-square="112"]').click();
      assert.equal(await page.locator(`.${name}-warning`).isVisible(), true);
      assert.deepEqual(
        await read(name),
        save,
        "failed writes retain the previous saved game",
      );
      await page.evaluate(() => {
        Storage.prototype.setItem = window.aiOriginalSetItem;
      });
      await exit();
    }
    console.log(
      "Storage failures keep games playable and show the existing save warning.",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
(async () => {
  unit();
  if (!process.argv.includes("--unit")) await browser();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
