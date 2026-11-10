"use strict";

const assert = require("node:assert/strict");
const { rules } = require("./build-xiangqi.cjs");

function board(pieces) {
  const squares = Array(90).fill(".");
  for (const [square, piece] of Object.entries(pieces)) squares[square] = piece;
  return squares.join("");
}
const moves = (pairs) => pairs.map(([from, to]) => rules.encode(from, to));
function replay(initial, path) {
  let value = initial;
  path.forEach((move, index) => {
    assert(rules.legalMoves(value, index % 2 === 0).includes(move));
    value = rules.apply(value, move);
  });
  return value;
}

const blackChecks = board({ 3: "k", 40: "P", 67: "r", 85: "K" });
const blackCycle = moves([
  [85, 86],
  [67, 68],
  [86, 85],
  [68, 67],
]);
const blackPath = [...blackCycle, ...blackCycle];
assert.equal(replay(blackChecks, blackPath), blackChecks);
assert.equal(rules.repetition(blackChecks, blackCycle), null);
assert.equal(rules.repetition(blackChecks, blackPath.slice(0, -1)), null);
assert.deepEqual(rules.repetition(blackChecks, blackPath), {
  outcome: "perpetualCheck",
  loser: false,
});
const before = blackPath.slice(0, -1);
const proposed = blackPath.at(-1);
const alternative = rules.avoidPerpetualCheck(blackChecks, before, proposed);
assert.notEqual(alternative, proposed, "AI must change its perpetual check");
replay(blackChecks, [...before, alternative]);
assert.notEqual(
  rules.repetition(blackChecks, [...before, alternative])?.loser,
  false,
);
assert.equal(
  rules.avoidPerpetualCheck(blackChecks, [], blackCycle[0]),
  blackCycle[0],
);
const earlyPath = blackCycle.slice(0, -1);
const earlyMove = rules.avoidPerpetualCheck(blackChecks, earlyPath, proposed);
assert.notEqual(earlyMove, proposed, "AI changes on the second occurrence");
replay(blackChecks, [...earlyPath, earlyMove]);

const redChecks = board({ 3: "k", 22: "R", 40: "P", 85: "K" });
const redCycle = moves([
  [22, 21],
  [3, 4],
  [21, 22],
  [4, 3],
]);
const redPath = [...redCycle, ...redCycle];
assert.equal(replay(redChecks, redPath), redChecks);
assert.deepEqual(rules.repetition(redChecks, redPath), {
  outcome: "perpetualCheck",
  loser: true,
});

const quiet = board({ 3: "k", 40: "P", 85: "K" });
const quietCycle = moves([
  [85, 86],
  [3, 4],
  [86, 85],
  [4, 3],
]);
const quietPath = [...quietCycle, ...quietCycle];
assert.equal(replay(quiet, quietPath), quiet);
assert.deepEqual(rules.repetition(quiet, quietPath), {
  outcome: "repetition",
  loser: null,
});
assert.equal(
  rules.repetition(quiet, quietPath.slice(0, -1)),
  null,
  "undo must remove the repetition result",
);
console.log(
  "Xiangqi perpetual check, AI avoidance, repetition draw and undo verified.",
);

async function verifyInterface() {
  const { chromium } = require("playwright");
  const { pathToFileURL } = require("node:url");
  const path = require("node:path");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(async () => {
      await WorkTimeApp.i18n.setLanguage("zh-CN");
      await WorkTimeApp.games.load("game-xiangqi");
    });
    for (const [initial, cycle, expected] of [
      [redChecks, redCycle, "轮到你走棋"],
      [quiet, quietCycle, "重复局面，和棋"],
      [blackChecks, blackCycle, null],
    ]) {
      await page.evaluate(
        ({ initial, cycle }) => {
          const app = WorkTimeApp;
          const rules = app.games.xiangqiRules;
          const parse = rules.parse;
          let replies = 0;
          app.games.createXiangqiEngine = () => ({
            load: async () => {},
            search: async () => {
              const [from, to] = rules.decode(cycle[(replies++ % 2) * 2 + 1]);
              const square = (value) =>
                String.fromCharCode(97 + (value % 9)) +
                (9 - Math.floor(value / 9));
              return square(from) + square(to);
            },
            dispose() {},
          });
          const mount = document.createElement("div");
          document.body.append(mount);
          const controller = new AbortController();
          window.repetitionTest = { mount, controller };
          app.games
            .list()
            .find(({ id }) => id === "game-xiangqi")
            .create({ container: mount, signal: controller.signal });
          mount.querySelector('[data-xiangqi-action="versus"]').click();
          rules.parse = () => initial;
          mount.querySelector('[data-xiangqi-action="start-red"]').click();
          rules.parse = parse;
        },
        { initial, cycle },
      );
      const turns = initial === blackChecks ? 2 : initial === redChecks ? 6 : 4;
      for (let turn = 0; turn < turns; turn++) {
        await page.evaluate(
          (move) => {
            const [from, to] = WorkTimeApp.games.xiangqiRules.decode(move);
            for (const square of [from, to])
              window.repetitionTest.mount
                .querySelector(`[data-square="${square}"]`)
                .click();
          },
          cycle[(turn % 2) * 2],
        );
        const count = (turn + 1) * 2;
        await page.waitForFunction(
          (count) =>
            window.repetitionTest.mount
              .querySelector(".xiangqi-controls")
              .textContent.includes(`已落子 ${count} 步`),
          count,
        );
      }
      const status = await page.evaluate(
        () =>
          window.repetitionTest.mount.querySelector(".xiangqi-status")
            .textContent,
      );
      if (expected) assert.equal(status, expected);
      else {
        assert(
          !status.includes("判负"),
          "AI changes its check instead of losing",
        );
        assert.equal(
          await page.evaluate(
            () =>
              window.repetitionTest.mount.querySelector(
                '[data-square="67"] .xiangqi-piece',
              ).textContent,
          ),
          "",
        );
      }
      await page.evaluate(() => {
        window.repetitionTest.controller.abort();
        window.repetitionTest.mount.remove();
      });
    }
    console.log(
      "Offline Xiangqi UI: unrestricted human checks, repetition draw and early AI change of move verified.",
    );
  } finally {
    await browser.close();
  }
}
if (process.argv.includes("--browser"))
  verifyInterface().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
