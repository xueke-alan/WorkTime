"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { solve, Position } = require("./gomoku-search.cjs");
const input = require("./gomoku-vct.json");
const output = path.join(__dirname, "gomoku-curated.json");
const curated = fs.existsSync(output)
  ? JSON.parse(fs.readFileSync(output, "utf8"))
  : [];
curated.forEach((p, i) => {
  p.sourceIndex ??= i;
});
for (
  let index = (curated.at(-1)?.sourceIndex ?? -1) + 1;
  index < input.length && curated.length < 100;
  index++
) {
  const entry = input[index];
  const board = [...entry.board];
  // Remove isolated decoration only when an exact search still proves a VCT
  // win, and an exhaustive three-move threat search still finds no shortcut.
  const pos = new Position(board);
  const removable = board.flatMap((s, p) => {
    if (!s) return [];
    const near = board.some(
      (v, q) =>
        q !== p &&
        v === 1 &&
        Math.max(
          Math.abs((q % 15) - (p % 15)),
          Math.abs(Math.floor(q / 15) - Math.floor(p / 15)),
        ) <= 2,
    );
    return !near ? [p] : [];
  });
  for (const p of removable) {
    const stone = board[p];
    board[p] = 0;
    const short = solve(board, 3, { budget: 10000 });
    const long =
      !short.result &&
      !short.cutoff &&
      solve(board, entry.goal, { budget: 16000 });
    if (!long?.result || !long.result.threes) board[p] = stone;
  }
  let best = null,
    nodes = 0;
  for (let depth = 3; depth <= entry.goal; depth++) {
    const result = solve(board, depth, { budget: 80000 });
    if (result.cutoff) throw Error("Unproven difficulty at " + index);
    nodes += result.nodes;
    if (result.result) {
      best = result.result;
      break;
    }
  }
  if (!best || best.depth < 4 || !best.threes) {
    console.log("Excluded short/pure-four puzzle " + index);
    continue;
  }
  const fours = solve(board, best.depth, { budget: 80000, foursOnly: true });
  if (fours.cutoff) throw Error("Unproven VCF exclusion at " + index);
  if (fours.result) {
    console.log("Excluded pure VCF puzzle " + index);
    continue;
  }
  if (pos.a.includes(5) || pos.b.includes(5)) throw Error("Pre-won board");
  curated.push({
    board,
    goal: best.depth,
    solution: best.pv,
    threes: best.threes,
    nodes,
    sourceIndex: index,
  });
  fs.writeFileSync(output, JSON.stringify(curated));
  console.log(
    `${curated.length}/${input.length}: ${best.depth} moves, ${best.threes} threes, ${nodes} nodes`,
  );
}
