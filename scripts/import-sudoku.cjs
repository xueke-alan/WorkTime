"use strict";
/** Explicit, repeatable network import; never used at runtime or during a build. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/js/games/sudoku-rules.js"), "utf8"),
  context,
);
const rules = context.WorkTimeApp.games.sudokuRules;
async function main() {
  const repository = "https://github.com/grantm/sudoku-exchange-puzzle-bank";
  const base =
    "https://raw.githubusercontent.com/grantm/sudoku-exchange-puzzle-bank/master/";
  const sources = {},
    banks = {};
  for (const file of ["easy", "medium", "hard", "diabolical"]) {
    const response = await fetch(base + file + ".txt");
    if (!response.ok) throw Error("Import failed: " + response.status);
    const content = await response.text();
    sources[file] = {
      url: base + file + ".txt",
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
    };
    banks[file] = content
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const [sourceId, givens, rating] = line.trim().split(/\s+/);
        if (!/^[0-9]{81}$/.test(givens) || !Number.isFinite(Number(rating)))
          throw Error("Invalid source record");
        return { sourceId, givens, rating: Number(rating) };
      })
      .sort(
        (a, b) => a.rating - b.rating || a.sourceId.localeCompare(b.sourceId),
      );
  }
  const used = new Set();
  const groups = [];
  for (const [id, source] of [
    ["easy", "easy"],
    ["medium", "medium"],
    ["hard", "hard"],
    ["expert", "diabolical"],
    ["parity", "medium"],
    ["thermo", "medium"],
  ]) {
    const available = banks[source].filter((p) => !used.has(p.givens));
    const puzzles = [];
    for (let level = 0; level < 20; level++) {
      const original =
        available[Math.floor(((available.length - 1) * level) / 19)];
      used.add(original.givens);
      const solutions = rules.solve(original);
      if (solutions.length !== 1) throw Error("Source must have one solution");
      const puzzle = {
        id: id + "-" + (level + 1),
        ...original,
        solution: solutions[0],
      };
      if (id === "parity") {
        puzzle.parity = Array.from(puzzle.solution, (n, i) =>
          i % 3 === level % 3 ? (Number(n) % 2 ? "o" : "e") : "",
        );
      }
      if (id === "thermo") {
        const paths = [];
        const occupied = new Set();
        function grow(cells) {
          if (cells.length >= 4) return cells;
          const last = cells.at(-1),
            r = Math.floor(last / 9),
            c = last % 9;
          const adjacent = [
            [r - 1, c],
            [r + 1, c],
            [r, c - 1],
            [r, c + 1],
          ]
            .filter(([y, x]) => y >= 0 && y < 9 && x >= 0 && x < 9)
            .map(([y, x]) => y * 9 + x);
          for (const next of adjacent) {
            if (
              occupied.has(next) ||
              cells.includes(next) ||
              puzzle.solution[next] <= puzzle.solution[last]
            )
              continue;
            const result = grow([...cells, next]);
            if (result.length >= 3) return result;
          }
          return cells;
        }
        for (let i = 0; i < 81 && paths.length < 3; i++) {
          if (occupied.has(i)) continue;
          const cells = grow([i]);
          if (cells.length >= 3) {
            paths.push(cells);
            cells.forEach((cell) => occupied.add(cell));
          }
        }
        if (!paths.length) throw Error("No thermometer path");
        puzzle.thermos = paths;
      }
      if (id === "parity" || id === "thermo") {
        puzzle.originalGivens = original.givens;
        let removed = 0;
        for (let i = 0; i < 81 && removed < 10; i++) {
          if (puzzle.givens[i] === "0") continue;
          const previous = puzzle.givens;
          puzzle.givens = previous.slice(0, i) + "0" + previous.slice(i + 1);
          if (rules.solve(puzzle).length !== 1) puzzle.givens = previous;
          else removed++;
        }
      }
      if (rules.solve(puzzle).length !== 1)
        throw Error("Variant must have one solution");
      puzzles.push(puzzle);
    }
    groups.push({ id, source, puzzles });
  }
  const data = { version: 1, repository, sources, groups };
  fs.writeFileSync(
    path.join(root, "assets/data/sudoku.js"),
    '"use strict";\n// Sudoku Exchange public-domain puzzle bank. See licenses/sudoku-exchange.txt.\nWorkTimeApp.data.sudoku = ' +
      JSON.stringify(data, null, 2) +
      ";\n",
  );
  const license = await fetch(base + "LICENSE.txt");
  if (!license.ok) throw Error("Missing license");
  fs.writeFileSync(
    path.join(root, "licenses/sudoku-exchange.txt"),
    await license.text(),
  );
  console.log("Imported and verified 120 unique puzzles in six groups.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
