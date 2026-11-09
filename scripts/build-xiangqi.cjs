"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const output = path.join(root, "assets/data/xiangqi.js");
const app = { games: {} };
vm.compileFunction(
  fs.readFileSync(path.join(root, "assets/js/games/xiangqi-rules.js"), "utf8"),
  ["WorkTimeApp"],
)(app);
const rules = app.games.xiangqiRules;

function solver() {
  const cache = new Map();
  // Distance counts red moves. Infinity means black can avoid mate in budget.
  function distance(board, red, budget) {
    if (red && !budget) return Infinity;
    if (!red && !budget)
      return rules.checked(board, false) &&
        rules.result(board, false) === "mate"
        ? 0
        : Infinity;
    const key = board + Number(red) + budget;
    if (cache.has(key)) return cache.get(key);
    const moves = rules.legalMoves(board, red, red && budget === 1);
    let result = Infinity;
    if (red) {
      const checks = [];
      const quiet = [];
      for (const move of moves) {
        const after = rules.apply(board, move);
        (budget === 1 || rules.checked(after, false) ? checks : quiet).push(
          after,
        );
      }
      for (const after of [...checks, ...quiet]) {
        // Spend this red move and search only for a faster mate.
        const remaining = Math.min(budget, result - 1) - 1;
        result = Math.min(result, 1 + distance(after, false, remaining));
        if (result === 1) break;
      }
    } else if (!moves.length) {
      if (rules.checked(board, false)) result = 0;
    } else if (budget) {
      result = 0;
      for (const move of moves) {
        result = Math.max(
          result,
          distance(rules.apply(board, move), true, budget),
        );
        if (!Number.isFinite(result)) break;
      }
    }
    cache.set(key, result);
    return result;
  }

  function tree(board, budget) {
    const branches = {};
    for (const move of rules.legalMoves(board, true)) {
      const after = rules.apply(board, move);
      const length = distance(after, false, budget - 1);
      if (length === 0) branches[move] = null;
      else if (Number.isFinite(length))
        branches[move] = Object.fromEntries(
          rules
            .legalMoves(after, false)
            .map((reply) => [
              reply,
              tree(rules.apply(after, reply), budget - 1),
            ]),
        );
    }
    return [distance(board, true, budget), branches];
  }

  return { distance, tree };
}

function build(levels) {
  assert.equal(levels.length, 200);
  const positions = new Set();
  const ids = new Set();
  const certificates = require("./xiangqi-classics-solutions.json");
  const source = require("./xiangqi-classics-source.json");
  for (const goal of [1, 2, 3])
    assert.equal(
      levels.filter((level) => level.goal === goal).length,
      goal === 1 ? 20 : 30,
    );
  assert.equal(levels.filter(({ title }) => title).length, 120);
  for (const [test, total] of [
    [(g) => g >= 4 && g <= 5, 45],
    [(g) => g >= 6 && g <= 8, 60],
    [(g) => g >= 9, 15],
  ])
    assert.equal(levels.filter(({ goal }) => test(goal)).length, total);
  const generated = levels.map(
    ({ id, position, goal, title, sourceIndex }, index) => {
      const board = rules.parse(position);
      assert(
        board && !rules.checked(board, false),
        id + " has an invalid starting position",
      );
      assert(!ids.has(id), "Duplicate level ID: " + id);
      ids.add(id);
      assert.equal(index < 80, goal <= 3);
      assert(!positions.has(board), id + " is duplicated");
      assert(Number.isInteger(goal) && goal >= 1);
      assert.equal(goal >= 4, typeof title === "string" && !!title.trim());
      positions.add(board);
      let tree;
      if (title) {
        const original = source[sourceIndex];
        assert(original, id + " is missing its source");
        assert.equal(
          original.fen
            .split(" ")[0]
            .replace(
              /[nbNB]/g,
              (piece) => ({ n: "h", b: "e", N: "H", B: "E" })[piece],
            ),
          position,
        );
        assert.equal(
          original.name
            .replace(/^第\d+局\s*/, "")
            .replace(/\s*-\s*适情雅趣$/, ""),
          title,
        );
        const certificate = certificates[id];
        assert.equal(
          certificate?.goal,
          goal,
          id + " has the wrong certificate",
        );
        tree = certificate.tree;
        verifyTree(board, tree);
        assert.equal(tree[0], goal);
      } else {
        const search = solver();
        assert.equal(
          search.distance(board, true, goal),
          goal,
          id + " has the wrong mate distance",
        );
        tree = search.tree(board, goal);
      }
      return title
        ? { id, position, goal, title, tree }
        : { id, position, goal, tree };
    },
  );
  const retired = require("./xiangqi-retired.json");
  assert.equal(retired.length, 20);
  for (const entry of retired) {
    assert(!ids.has(entry.id), "Retired IDs must never be reused");
    assert(rules.parse(entry.position));
    assert(entry.goal <= 3);
  }
  for (let n = 101; n <= 110; n++)
    assert(ids.has("xq-" + n), "Preserve original classics");
  assert(
    generated.some(({ tree }) => Object.keys(tree[1]).length > 1),
    "Include multiple solutions",
  );
  assert(
    generated.some(({ tree }) =>
      Object.values(tree[1]).some(
        (replies) => replies && Object.keys(replies).length > 1,
      ),
    ),
    "Include multiple black replies",
  );
  return (
    '"use strict";\n// Generated by scripts/build-xiangqi.cjs from scripts/xiangqi-positions.json.\n' +
    "/*! Includes positions adapted from dffge552/xiangqi-pwa-offline (MIT). See licenses/xiangqi-puzzles.txt. */\n" +
    "WorkTimeApp.data.xiangqi = [\n" +
    generated.map((level) => JSON.stringify(level)).join(",\n") +
    "\n];\nWorkTimeApp.data.xiangqiRetired = " +
    JSON.stringify(retired) +
    ";\n"
  );
}

function verifyTree(board, tree) {
  assert(Array.isArray(tree) && tree.length === 2);
  const branches = Object.entries(tree[1]);
  assert(branches.length > 0, "Empty red continuation");
  const legal = rules.legalMoves(board, true);
  const distances = branches.map(([code, replies]) => {
    const move = Number(code);
    assert(legal.includes(move), "Illegal red continuation");
    const after = rules.apply(board, move);
    if (replies === null) {
      assert.equal(rules.result(after, false), "mate");
      return 1;
    }
    const black = rules.legalMoves(after, false);
    assert(black.length > 0);
    assert.deepEqual(
      Object.keys(replies)
        .map(Number)
        .sort((a, b) => a - b),
      black.sort((a, b) => a - b),
      "Missing black defense",
    );
    return (
      1 +
      Math.max(
        ...black.map((reply) =>
          verifyTree(rules.apply(after, reply), replies[reply]),
        ),
      )
    );
  });
  assert.equal(
    tree[0],
    Math.min(...distances),
    "Incorrect certificate distance",
  );
  return tree[0];
}

function check() {
  assert.equal(
    fs.readFileSync(output, "utf8").replace(/\r\n/g, "\n"),
    build(require("./xiangqi-positions.json")),
    "Regenerate the Xiangqi puzzle bank with node scripts/build-xiangqi.cjs",
  );
}

if (require.main === module) {
  if (process.argv.includes("--check")) check();
  else fs.writeFileSync(output, build(require("./xiangqi-positions.json")));
}

module.exports = { rules, check, verifyTree, solver };
