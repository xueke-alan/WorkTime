"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const app = { games: {} };
vm.compileFunction(
  fs.readFileSync(
    path.resolve(__dirname, "../assets/js/games/2048-rules.js"),
    "utf8",
  ),
  ["WorkTimeApp"],
)(app);
const rules = app.games.rules2048;
const count = Number(process.argv[2] || 10);
assert.ok(Number.isSafeInteger(count) && count > 0 && count <= 1000);
let wins = 0;
for (let initial = 1; initial <= count; initial++) {
  let seed = initial,
    steps = 0,
    totalMs = 0,
    maxMs = 0;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  let state = rules.create(random);
  while (!rules.lost(state.board) && !rules.won(state) && steps < 10000) {
    const start = performance.now();
    const direction = rules.chooseMove(state.board);
    const ms = performance.now() - start;
    totalMs += ms;
    maxMs = Math.max(maxMs, ms);
    const result = rules.turn(state, direction, random);
    assert.ok(result, "AI must choose a legal move");
    state = result.state;
    steps++;
  }
  assert.ok(steps < 10000);
  const won = rules.won(state);
  if (won) wins++;
  console.log(
    JSON.stringify({
      seed: initial,
      won,
      score: state.score,
      max: Math.max(...state.board),
      steps,
      avgMs: Math.round(totalMs / steps),
      maxMs: Math.round(maxMs),
    }),
  );
}
console.log(
  `Reached 2048: ${wins}/${count}. Seeded samples do not guarantee every random game.`,
);
