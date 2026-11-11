"use strict";
// Offline, deterministic CSP rating. This is not a human difficulty grade.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ WorkTimeApp: { data: {}, games: {} } });
for (const file of ["assets/data/sudoku.js", "assets/js/games/sudoku-rules.js"])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const rules = context.WorkTimeApp.games.sudokuRules;
const ids = [
  "kropki",
  "arrow",
  "whispers",
  "renban",
  "thermo",
  "antiKnight",
  "jigsaw",
  "sandwich",
  "xsums",
  "skyscraper",
  "parity",
  "inequality",
  "extraRegion",
  "palindrome",
  "quadSum",
];
const digits = Array.from({ length: 512 }, (_, mask) =>
  Array.from({ length: 9 }, (_, i) => i + 1).filter(
    (n) => mask & (1 << (n - 1)),
  ),
);
const single = (m) => m && !(m & (m - 1));
function unitsFor(p) {
  const units = [];
  for (let n = 0; n < 9; n++) {
    units.push(Array.from({ length: 9 }, (_, j) => n * 9 + j));
    units.push(Array.from({ length: 9 }, (_, j) => j * 9 + n));
    units.push(
      p.regions
        ? Array.from({ length: 81 }, (_, i) => i).filter(
            (i) => p.regions[i] === n,
          )
        : Array.from(
            { length: 9 },
            (_, j) =>
              (Math.floor(n / 3) * 3 + Math.floor(j / 3)) * 9 +
              (n % 3) * 3 +
              (j % 3),
          ),
    );
  }
  return [...units, ...(p.extraRegions || [])];
}
function rate(p, maxNodes = 20000) {
  const units = unitsFor(p);
  const initial = Array.from(p.givens, Number);
  const result = {
    givens: initial.filter(Boolean).length,
    logicalFilled: 0,
    remaining: 81,
    nodes: 0,
    branches: 0,
    backtracks: 0,
    depth: 0,
    score: 0,
    solutions: [],
  };
  if (
    initial.length !== 81 ||
    initial.some(
      (n, i) =>
        !Number.isInteger(n) ||
        n < 0 ||
        n > 9 ||
        (n && !rules.allowed(initial, i, n, p)),
    )
  )
    return result;
  function propagate(board, masks) {
    for (;;) {
      let changed = false;
      for (let i = 0; i < 81; i++) {
        if (board[i]) {
          masks[i] = 1 << (board[i] - 1);
          continue;
        }
        let mask = 0;
        for (const n of digits[masks[i]])
          if (rules.allowed(board, i, n, p)) mask |= 1 << (n - 1);
        if (!mask) return false;
        if (mask !== masks[i]) changed = true;
        masks[i] = mask;
        if (single(mask)) {
          board[i] = digits[mask][0];
          changed = true;
        }
      }
      for (const unit of units) {
        for (let bit = 1; bit <= 256; bit *= 2) {
          const places = unit.filter((i) => masks[i] & bit);
          if (!places.length) return false;
          if (places.length === 1 && masks[places[0]] !== bit) {
            masks[places[0]] = bit;
            changed = true;
          }
        }
        const empty = unit.filter(
          (i) => !board[i] && digits[masks[i]].length <= 3,
        );
        function subset(cells) {
          const union = cells.reduce((m, i) => m | masks[i], 0);
          if (digits[union].length < cells.length) return false;
          if (digits[union].length !== cells.length) return true;
          for (const i of unit) {
            if (board[i] || cells.includes(i)) continue;
            const mask = masks[i] & ~union;
            if (!mask) return false;
            if (mask !== masks[i]) {
              masks[i] = mask;
              changed = true;
            }
          }
          return true;
        }
        for (let a = 0; a < empty.length; a++)
          for (let b = a + 1; b < empty.length; b++) {
            if (!subset([empty[a], empty[b]])) return false;
            for (let c = b + 1; c < empty.length; c++)
              if (!subset([empty[a], empty[b], empty[c]])) return false;
          }
      }
      // Hidden singles/subsets can restrict a previously processed cell.
      for (let i = 0; i < 81; i++)
        if (!board[i] && single(masks[i])) {
          const n = digits[masks[i]][0];
          if (!rules.allowed(board, i, n, p)) return false;
          board[i] = n;
          changed = true;
        }
      if (!changed) return true;
    }
  }
  function visit(board, masks, depth) {
    if (++result.nodes > maxNodes)
      throw Error("Sudoku rating search limit exceeded: " + p.id);
    result.depth = Math.max(result.depth, depth);
    if (!propagate(board, masks)) return;
    if (!depth) {
      result.logicalFilled = board.filter(Boolean).length;
      result.remaining = 81 - result.logicalFilled;
    }
    let index = -1;
    for (let i = 0; i < 81; i++)
      if (
        !board[i] &&
        (index < 0 || digits[masks[i]].length < digits[masks[index]].length)
      )
        index = i;
    if (index < 0) {
      if (board.every((n, i) => rules.allowed(board, i, n, p)))
        result.solutions.push(board.join(""));
      return;
    }
    for (const n of digits[masks[index]]) {
      result.branches++;
      const before = result.solutions.length;
      const next = board.slice(),
        nextMasks = masks.slice();
      next[index] = n;
      nextMasks[index] = 1 << (n - 1);
      visit(next, nextMasks, depth + 1);
      if (result.solutions.length === before) result.backtracks++;
      if (result.solutions.length >= 2) break;
    }
  }
  visit(
    initial,
    initial.map((n) => (n ? 1 << (n - 1) : 511)),
    0,
  );
  result.score = result.branches + result.backtracks + 5 * result.depth;
  return result;
}
const hard = (r) => r.remaining > 0 && r.depth >= 3 && r.score > 20;
// Conservative duplicate check: reject equal clue masks under all eight square
// symmetries, regardless of digits or constraint decorations. Therefore digit
// relabellings and rotated/reflected copies cannot enter as new puzzles.
function signature(p) {
  const masks = [];
  for (let mirror = 0; mirror < 2; mirror++)
    for (let turn = 0; turn < 4; turn++) {
      const out = Array(81);
      for (let i = 0; i < 81; i++) {
        let r = Math.floor(i / 9),
          c = i % 9;
        if (mirror) c = 8 - c;
        for (let n = 0; n < turn; n++) [r, c] = [c, 8 - r];
        out[r * 9 + c] = p.givens[i] === "0" ? "0" : "1";
      }
      masks.push(out.join(""));
    }
  return masks.sort()[0];
}
function fingerprint(p) {
  const copy = { ...p };
  delete copy.difficulty;
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}
module.exports = {
  rate,
  hard,
  signature,
  fingerprint,
  ids,
  data: context.WorkTimeApp.data.sudoku,
};
