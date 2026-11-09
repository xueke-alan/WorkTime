"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { solve, Position } = require("./gomoku-search.cjs");
let seed = 20261109;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}
function canonical(board) {
  const forms = [];
  for (let flip = 0; flip < 2; flip++)
    for (let rot = 0; rot < 4; rot++) {
      const stones = [];
      board.forEach((s, p) => {
        if (!s) return;
        let x = p % 15,
          y = Math.floor(p / 15);
        if (flip) x = -x;
        for (let n = 0; n < rot; n++) [x, y] = [-y, x];
        stones.push([x, y, s]);
      });
      const mx = Math.min(...stones.map((p) => p[0])),
        my = Math.min(...stones.map((p) => p[1]));
      forms.push(
        stones
          .map(([x, y, s]) => [x - mx, y - my, s])
          .sort((a, b) => a[0] - b[0] || a[1] - b[1])
          .join(";"),
      );
    }
  return forms.sort()[0];
}
const output = path.resolve(__dirname, "gomoku-vct.json");
const found = fs.existsSync(output)
  ? JSON.parse(fs.readFileSync(output, "utf8"))
  : [];
seed ^= found.length * 104729;
const seen = new Set(found.map((p) => canonical(p.board)));
const target = Number(process.argv[2] ?? 90);
let attempt = 0;
while (found.length < target) {
  attempt++;
  const board = Array(225).fill(0);
  const count = 7 + Math.floor(random() * 7);
  for (let s = 1; s <= 2; s++)
    for (let n = 0; n < count;) {
      const x = 3 + Math.floor(random() * 9),
        y = 3 + Math.floor(random() * 9),
        p = y * 15 + x;
      if (!board[p]) {
        board[p] = s;
        n++;
      }
    }
  const pos = new Position(board);
  if (
    pos.wins(1).length ||
    pos.wins(2).length ||
    pos.a.includes(5) ||
    pos.b.includes(5)
  )
    continue;
  if (solve(board, 3, { budget: 1800 }).result) continue;
  const { result, cutoff } = solve(board, 6, { budget: 10000 });
  if (!result || cutoff || !result.threes || result.depth < 4) continue;
  const key = canonical(board);
  if (seen.has(key)) continue;
  seen.add(key);
  found.push({
    board,
    goal: result.depth,
    solution: result.pv,
    threes: result.threes,
  });
  fs.writeFileSync(output, JSON.stringify(found));
  console.log(
    `${found.length}/${target} #${attempt}: depth ${result.depth}, threes ${result.threes}`,
  );
}
