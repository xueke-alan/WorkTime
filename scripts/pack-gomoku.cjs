"use strict";
const fs = require("node:fs");
const path = require("node:path");
const puzzles = require("./gomoku-curated.json");
if (puzzles.length !== 100) throw Error("Expected 100 verified VCT puzzles");
puzzles.forEach((p, i) => {
  p.id = "gm-vct-" + String(i + 1).padStart(3, "0");
});
puzzles.sort(
  (a, b) =>
    a.goal - b.goal ||
    a.threes - b.threes ||
    a.nodes - b.nodes ||
    a.id.localeCompare(b.id),
);
const data = puzzles.map((p, i) => ({
  id: p.id,
  group: i < 40 ? "easy" : i < 70 ? "medium" : "hard",
  goal: p.goal,
  black: p.board.flatMap((s, q) => (s === 1 ? [q] : [])),
  white: p.board.flatMap((s, q) => (s === 2 ? [q] : [])),
  solution: p.solution,
  threes: p.threes,
  nodes: p.nodes,
}));
const source = `"use strict";
// Original, reproducible VCT compositions. No third-party book content.
// Each entry has an exhaustively checked threat strategy (including every
// legal white reply at each three). IDs stay tied to their original board.
(() => {
  const legacy = WorkTimeApp.data.gomokuLegacy;
  WorkTimeApp.data.gomokuRetired = legacy;
  const puzzles = ${JSON.stringify(data)};
  WorkTimeApp.data.gomoku = [
    ...puzzles.map(({black, white, ...entry}) => {
      const board = Array(225).fill(0);
      for (const p of black) board[p] = 1;
      for (const p of white) board[p] = 2;
      return {...entry, board, vct: true};
    }),
  ];
})();
`;
fs.writeFileSync(path.join(__dirname, "../assets/data/gomoku.js"), source);
console.log("Packed 100 unique VCT puzzles; groups 40/30/30.");
console.log(
  data.reduce((out, p) => ((out[p.goal] = (out[p.goal] ?? 0) + 1), out), {}),
);
