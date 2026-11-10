"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { rate, signature } = require("./killer-rating.cjs");
const root = path.resolve(__dirname, "..");
const file = path.join(root, "assets/data/sudoku.js");
const original = fs.readFileSync(file, "utf8");
const ctx = { WorkTimeApp: { data: {} } };
vm.runInNewContext(original, ctx);
const data = JSON.parse(JSON.stringify(ctx.WorkTimeApp.data.sudoku));
const group = data.groups.find((g) => g.id === "killer");
const baseline = group.puzzles
  .slice(0, 20)
  .map((p) => ({ id: p.id, ...rate(p) }));
const floor = Math.max(20, ...baseline.map((r) => r.score));
let seed = 20261111;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
function shuffle(a) {
  return a
    .map((v) => ({ v, k: random() }))
    .sort((a, b) => a.k - b.k)
    .map((o) => o.v);
}
const adjacent = (a, b) =>
  Math.abs(Math.floor(a / 9) - Math.floor(b / 9)) +
    Math.abs((a % 9) - (b % 9)) ===
  1;
function merged(a, b, solution) {
  const cells = [...a.cells, ...b.cells].sort((a, b) => a - b);
  if (
    cells.length > 6 ||
    new Set(cells.map((i) => solution[i])).size !== cells.length ||
    !a.cells.some((i) => b.cells.some((j) => adjacent(i, j)))
  )
    return null;
  return { cells, sum: a.sum + b.sum };
}

function report() {
  const rows = group.puzzles.map((p) => ({ id: p.id, ...rate(p) }));
  fs.writeFileSync(
    path.join(root, "scripts/killer-difficulty.json"),
    JSON.stringify(
      {
        method:
          "killer-rating-v1: cage combinations, singles, hidden singles, naked pairs/triples, 45 innies/outies; deterministic MRV ascending search; score=branches+backtracks+5*depth. Program rating, not a human grade.",
        seed: 20261111,
        threshold: floor,
        rows: rows.map(({ solutions, ...row }) => ({
          ...row,
          solutionCount: solutions.length,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.table(
    rows.map(({ id, logicalFilled, branches, backtracks, depth, score }) => ({
      id,
      logicalFilled,
      branches,
      backtracks,
      depth,
      score,
    })),
  );
}
if (process.argv.includes("--report")) {
  report();
  process.exit(0);
}
const chosen = [],
  seen = new Set(group.puzzles.slice(0, 20).map(signature));
for (let attempt = 0; attempt < 20000 && chosen.length < 10; attempt++) {
  if (attempt % 10 === 0) console.log("search attempt", attempt);
  const solution = group.puzzles[attempt % 20].solution;
  let cages = Array.from(solution, (n, i) => ({ cells: [i], sum: +n }));
  // First remove every singleton. Then merge further while preserving uniqueness.
  for (const i of shuffle(Array.from({ length: 81 }, (_, i) => i))) {
    const a = cages.find((c) => c.cells.includes(i));
    if (a.cells.length !== 1) continue;
    const b = shuffle(cages).find((b) => b !== a && merged(a, b, solution));
    if (b)
      cages = [
        ...cages.filter((c) => c !== a && c !== b),
        merged(a, b, solution),
      ];
  }
  if (cages.some((c) => c.cells.length === 1)) continue;
  const p = { id: "candidate", givens: "0".repeat(81), solution, cages };
  let rating;
  try {
    rating = rate(p, 1000);
  } catch {
    continue;
  }
  if (rating.solutions.length !== 1) continue;
  for (const a of shuffle([...cages])) {
    if (!cages.includes(a)) continue;
    for (const b of shuffle([...cages])) {
      if (a === b) continue;
      const c = merged(a, b, solution);
      if (!c) continue;
      const candidate = [...cages.filter((c) => c !== a && c !== b), c];
      try {
        const next = rate({ ...p, cages: candidate }, 1500);
        if (next.solutions.length === 1) {
          cages = candidate;
          rating = next;
          break;
        }
      } catch {
        /* Reject bounded-out candidates rather than assume uniqueness. */
      }
    }
  }
  p.cages = cages.sort((a, b) => a.cells[0] - b.cells[0]);
  const key = signature(p);
  if (
    rating.remaining === 0 ||
    rating.score <= floor ||
    rating.depth < 3 ||
    seen.has(key)
  )
    continue;
  seen.add(key);
  chosen.push({ p, rating });
  console.log(
    "accepted",
    chosen.length,
    "attempt",
    attempt,
    "score",
    rating.score,
    "baseline max",
    floor,
  );
}
if (chosen.length !== 10) throw Error("Could not find ten hard puzzles");
group.puzzles = [
  ...group.puzzles.slice(0, 20),
  ...chosen
    .map(({ p }) => ({ p, rating: rate(p) }))
    .sort((a, b) => a.rating.score - b.rating.score)
    .map(({ p }, i) => ({
      ...p,
      id: "killer-" + (21 + i),
      difficulty: "hard",
    })),
];
fs.writeFileSync(
  file,
  original.slice(0, original.indexOf("WorkTimeApp.data.sudoku = ")) +
    "WorkTimeApp.data.sudoku = " +
    JSON.stringify(data, null, 2) +
    ";\n",
);
report();
