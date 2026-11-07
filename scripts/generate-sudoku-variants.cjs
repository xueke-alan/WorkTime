"use strict";
/** Extend locally authored variants deterministically, preserving existing levels. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ WorkTimeApp: { games: {}, data: {} } });
for (const file of ["assets/data/sudoku.js", "assets/js/games/sudoku-rules.js"])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const { data, games } = context.WorkTimeApp;
const rules = games.sudokuRules;
let seed = 731924;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const adjacent = (i) =>
  [
    i - 9,
    i + 9,
    ...(i % 9 ? [i - 1] : []),
    ...(i % 9 < 8 ? [i + 1] : []),
  ].filter((j) => j >= 0 && j < 81);
function unique(puzzle, maxNodes = 2500) {
  try {
    const solutions = rules.solve(puzzle, 2, maxNodes);
    return solutions.length === 1 && solutions[0] === puzzle.solution;
  } catch (error) {
    if (!error.message.includes("search limit")) throw error;
    return false;
  }
}
function connected(cells) {
  const seen = new Set([cells[0]]),
    pending = [cells[0]];
  while (pending.length)
    for (const j of adjacent(pending.pop()))
      if (cells.includes(j) && !seen.has(j)) {
        seen.add(j);
        pending.push(j);
      }
  return seen.size === cells.length;
}
function regions(solution) {
  const result = Array.from(
    { length: 81 },
    (_, i) => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3),
  );
  let swaps = 0;
  for (const a of shuffle(Array.from({ length: 81 }, (_, i) => i))) {
    for (const b of shuffle(Array.from({ length: 81 }, (_, i) => i))) {
      if (result[a] === result[b] || solution[a] !== solution[b]) continue;
      const ra = result[a],
        rb = result[b];
      if (
        !adjacent(a).some((i) => result[i] === rb) ||
        !adjacent(b).some((i) => result[i] === ra)
      )
        continue;
      [result[a], result[b]] = [rb, ra];
      if (
        [ra, rb].every((r) =>
          connected(result.flatMap((v, i) => (v === r ? [i] : []))),
        )
      )
        swaps++;
      else [result[a], result[b]] = [ra, rb];
      if (swaps >= 5) return result;
    }
  }
  return swaps ? result : null;
}
function paths(solution, kind) {
  const found = [],
    used = new Set();
  function grow(cells, length) {
    if (cells.length === length) return cells;
    for (const next of shuffle(adjacent(cells.at(-1)))) {
      if (cells.includes(next) || used.has(next)) continue;
      const values = [...cells, next].map((i) => Number(solution[i]));
      if (
        kind === "whispers"
          ? Math.abs(values.at(-1) - values.at(-2)) < 5
          : new Set(values).size !== values.length ||
            Math.max(...values) - Math.min(...values) >= length
      )
        continue;
      const result = grow([...cells, next], length);
      if (result) return result;
    }
    return null;
  }
  for (const i of shuffle(Array.from({ length: 81 }, (_, n) => n))) {
    if (used.has(i)) continue;
    const line = grow([i], 4) || grow([i], 3);
    if (!line) continue;
    found.push(line);
    line.forEach((j) => used.add(j));
    if (found.length === 5) break;
  }
  return found;
}
function cages(puzzle) {
  let result = Array.from({ length: 81 }, (_, i) => ({
    cells: [i],
    sum: Number(puzzle.solution[i]),
  }));
  // Start with singleton sums, merge connected cages only while uniqueness holds.
  // Try singleton cages first to reduce trivial one-cell cages in empty-grid levels.
  for (let pass = 0; pass < 4; pass++) {
    for (const cell of shuffle(Array.from({ length: 81 }, (_, i) => i))) {
      const a = result.find((c) => c.cells.includes(cell));
      if (pass < 2 && a.cells.length !== 1) continue;
      for (const next of shuffle(adjacent(cell))) {
        const b = result.find((c) => c.cells.includes(next));
        if (a === b || a.cells.length + b.cells.length > 4) continue;
        const cells = [...a.cells, ...b.cells].sort((x, y) => x - y);
        if (new Set(cells.map((i) => puzzle.solution[i])).size !== cells.length)
          continue;
        const candidate = [
          ...result.filter((c) => c !== a && c !== b),
          { cells, sum: a.sum + b.sum },
        ];
        if (unique({ ...puzzle, cages: candidate }, 600)) {
          result = candidate;
          break;
        }
      }
    }
  }
  return result.sort((a, b) => a.cells[0] - b.cells[0]);
}
const ids = [
  "sandwich",
  "killer",
  "arrow",
  "jigsaw",
  "whispers",
  "renban",
  "kropki",
  "xsums",
  "skyscraper",
  "antiKnight",
];
const source = data.sudoku.groups
  .filter((g) => ["easy", "medium", "hard", "expert"].includes(g.id))
  .flatMap((g) => g.puzzles);
const groups = [];
for (const id of ids) {
  // Keep existing level IDs and layouts stable so saved games and replays survive.
  const puzzles = [
    ...(data.sudoku.groups.find((g) => g.id === id)?.puzzles || []),
  ].slice(0, 20);
  let attempt = 0;
  while (puzzles.length < 20) {
    if (++attempt > 300)
      throw Error("Could not produce 20 unique puzzles for " + id);
    seed = 731924 + ids.indexOf(id) * 100003 + puzzles.length * 1009 + attempt;
    const original =
      source[
        (ids.indexOf(id) * 19 + puzzles.length * 7 + attempt) % source.length
      ];
    const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    let solution = Array.from(
      original.solution,
      (n) => digits[Number(n) - 1],
    ).join("");
    if (id === "antiKnight") {
      const base = Array.from(
        { length: 81 },
        (_, i) =>
          digits[(Math.floor(i / 9) * 3 + Math.floor(i / 27) + (i % 9)) % 9],
      ).join("");
      const givens = Array.from(base, (n) => (random() < 0.42 ? n : "0")).join(
        "",
      );
      try {
        solution = rules.solve({ givens, antiKnight: true }, 1, 20000)[0];
      } catch (error) {
        if (!error.message.includes("search limit")) throw error;
        continue;
      }
      if (!solution) continue;
    }
    const puzzle = {
      id: id + "-" + (puzzles.length + 1),
      solution,
      givens: "0".repeat(81),
    };
    if (id === "antiKnight") puzzle.antiKnight = true;
    if (id === "skyscraper")
      puzzle.skyscrapers = [0, 1, 2, 3].map((side) =>
        Array.from({ length: 9 }, (_, line) => {
          const values = Array.from({ length: 9 }, (_, j) =>
            Number(
              solution[
                side % 2
                  ? line * 9 + (side < 2 ? j : 8 - j)
                  : (side < 2 ? j : 8 - j) * 9 + line
              ],
            ),
          );
          return values.filter((n, i) => values.slice(0, i).every((v) => v < n))
            .length;
        }),
      );
    if (id === "sandwich")
      puzzle.sandwich = [0, 1].map((side) =>
        Array.from({ length: 9 }, (_, line) => {
          const values = Array.from({ length: 9 }, (_, j) =>
            Number(solution[side ? line * 9 + j : j * 9 + line]),
          );
          const a = values.indexOf(1),
            b = values.indexOf(9);
          return values
            .slice(Math.min(a, b) + 1, Math.max(a, b))
            .reduce((x, y) => x + y, 0);
        }),
      );
    if (id === "xsums")
      puzzle.xsums = [0, 1].map((side) =>
        Array.from({ length: 9 }, (_, line) => {
          const values = Array.from({ length: 9 }, (_, j) =>
            Number(solution[side ? line * 9 + j : j * 9 + line]),
          );
          return values.slice(0, values[0]).reduce((x, y) => x + y, 0);
        }),
      );
    if (id === "killer") puzzle.cages = cages(puzzle);
    if (id === "jigsaw") {
      puzzle.regions = regions(solution);
      if (!puzzle.regions) continue;
    }
    if (id === "whispers" || id === "renban") {
      puzzle[id === "whispers" ? "whispers" : "renbans"] = paths(solution, id);
      if (puzzle[id === "whispers" ? "whispers" : "renbans"].length < 3)
        continue;
    }
    if (id === "kropki") {
      puzzle.kropki = [];
      for (let i = 0; i < 81; i++)
        for (const j of adjacent(i).filter((j) => j > i)) {
          const a = Number(solution[i]),
            b = Number(solution[j]);
          if (Math.max(a, b) === 2 * Math.min(a, b))
            puzzle.kropki.push({ cells: [i, j], kind: "black" });
          else if (Math.abs(a - b) === 1)
            puzzle.kropki.push({ cells: [i, j], kind: "white" });
        }
    }
    if (id === "arrow") {
      puzzle.arrows = [];
      const used = new Set();
      for (const circle of shuffle(Array.from({ length: 81 }, (_, i) => i))) {
        if (used.has(circle)) continue;
        for (const a of adjacent(circle)) {
          if (used.has(a)) continue;
          const b = adjacent(a).find(
            (b) =>
              b !== circle &&
              !used.has(b) &&
              Number(solution[a]) + Number(solution[b]) ===
                Number(solution[circle]),
          );
          if (b === undefined) continue;
          puzzle.arrows.push({ circle, cells: [a, b] });
          [circle, a, b].forEach((i) => used.add(i));
          break;
        }
        if (puzzle.arrows.length >= 5) break;
      }
      if (puzzle.arrows.length < 3) continue;
    }
    if (id !== "killer") {
      // Begin with a complete valid grid, remove givens while retaining one solution.
      puzzle.givens = solution;
      for (const i of shuffle(Array.from({ length: 81 }, (_, n) => n))) {
        const candidate = {
          ...puzzle,
          givens: puzzle.givens.slice(0, i) + "0" + puzzle.givens.slice(i + 1),
        };
        if (unique(candidate, 1200)) puzzle.givens = candidate.givens;
      }
    } else if (puzzles.length < 3) {
      // Include both sparse-given and genuinely empty-grid killer levels.
      puzzle.givens = Array.from(solution, (n, i) =>
        i % 19 === puzzles.length ? n : "0",
      ).join("");
    }
    if (!unique(puzzle, 20000)) throw Error("Nonunique variant: " + puzzle.id);
    puzzles.push(puzzle);
    console.log(
      puzzle.id,
      "givens",
      puzzle.givens.replace(/0/g, "").length,
      "cages",
      puzzle.cages?.length ?? "-",
    );
  }
  groups.push({ id, source: "worktime", puzzles });
}
const existingIds = new Set(data.sudoku.groups.map((g) => g.id));
const generated = new Map(groups.map((g) => [g.id, g]));
data.sudoku.groups = [
  ...data.sudoku.groups.map(
    (g) =>
      generated.get(g.id) ||
      (["parity", "thermo"].includes(g.id)
        ? { ...g, puzzles: g.puzzles.slice(0, 20) }
        : g),
  ),
  ...groups.filter((g) => !existingIds.has(g.id)),
];
fs.writeFileSync(
  path.join(root, "assets/data/sudoku.js"),
  '"use strict";\n// Imported classics and locally generated variants; see licenses/sudoku-exchange.txt.\nWorkTimeApp.data.sudoku = ' +
    JSON.stringify(data.sudoku, null, 2) +
    ";\n",
);
