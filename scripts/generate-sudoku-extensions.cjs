"use strict";
/** Deterministic local puzzles: shared cells have one index across every subgrid. */
const fs = require("node:fs"),
  vm = require("node:vm");
const ctx = vm.createContext({ WorkTimeApp: { games: {}, data: {} } });
for (const f of ["assets/data/sudoku.js", "assets/js/games/sudoku-rules.js"])
  vm.runInContext(fs.readFileSync(f, "utf8"), ctx);
const { data, games } = ctx.WorkTimeApp,
  rules = games.sudokuRules;
let seed = 9112026;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const indices = (n) => Array.from({ length: n }, (_, i) => i);
const layouts = {
  windmill: [
    [6, 6],
    [0, 3],
    [3, 12],
    [12, 9],
    [9, 0],
  ],
  flower: [
    [3, 3],
    [0, 0],
    [0, 6],
    [6, 0],
    [6, 6],
  ],
  triple: [
    [0, 3],
    [3, 6],
    [6, 0],
  ],
};
const ids = [
  "inequality",
  "extraRegion",
  "palindrome",
  "quadSum",
  ...Object.keys(layouts),
  "tenBox",
];
const source = data.sudoku.groups
  .filter((g) => ["easy", "medium", "hard", "expert"].includes(g.id))
  .flatMap((g) => g.puzzles);
function unique(p, max = 1200) {
  try {
    const s = rules.solve(p, 2, max);
    return s.length === 1 && s[0] === p.solution;
  } catch (e) {
    if (!e.message.includes("search limit")) throw e;
    return false;
  }
}
for (const id of ids) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(id)) continue;
  if (
    data.sudoku.groups.some(
      (g) =>
        g.id === id &&
        (g.puzzles.length > 20 ||
          (process.argv.length === 2 &&
            g.puzzles.length === 20 &&
            (id !== "triple" ||
              g.puzzles.every((p) => p.id.startsWith("triple-compact-"))))),
    )
  )
    continue;
  seed = 9112026 + ids.indexOf(id) * 100003;
  const puzzles = [];
  for (let level = 0; level < 20; level++) {
    const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const original =
      source[(level * 13 + ids.indexOf(id) * 17) % source.length];
    const p = {
      id: id + (id === "triple" ? "-compact-" : "-") + (level + 1),
      givens: "",
      solution: Array.from(
        original.solution,
        (n) => digits[Number(n) - 1],
      ).join(""),
    };
    if (id === "tenBox") {
      p.tenBox = true;
      p.givens = "0".repeat(90);
      p.solution = rules.solve(p, 1, 1000000)[0];
      p.solution = Array.from(p.solution, (n) => digits[Number(n) - 1]).join(
        "",
      );
    }
    if (layouts[id]) {
      p.grids = layouts[id];
      p.solution = rules
        .layout(p)
        .positions.map(([r, c]) => digits[(r * 3 + Math.floor(r / 3) + c) % 9])
        .join("");
      p.givens = Array.from(p.solution, (n) =>
        random() < 0.58 ? n : "0",
      ).join("");
      // Seed a complete linked solution, then vary it without relaxing shared units.
      p.solution = rules.solve(p, 1, 20000)[0];
    }
    if (id === "extraRegion") {
      p.extraRegions = [
        [1, 1],
        [1, 5],
        [5, 1],
        [5, 5],
      ].map(([r, c]) =>
        indices(9).map((i) => (r + Math.floor(i / 3)) * 9 + c + (i % 3)),
      );
      p.givens = "0".repeat(81);
      const base = rules.solve(p, 1, 1000000)[0];
      p.solution = Array.from(base, (n) => digits[Number(n) - 1]).join("");
    }
    const v = (i) => Number(p.solution[i]);
    if (id === "inequality") {
      p.inequalities = [];
      for (const i of shuffle(indices(81)))
        for (const j of [i % 9 < 8 ? i + 1 : -1, i + 9])
          if (j >= 0 && j < 81 && random() < 0.23)
            p.inequalities.push(v(i) > v(j) ? [i, j] : [j, i]);
    }
    if (id === "quadSum") {
      p.quadSums = [];
      for (const i of indices(72).filter((i) => i % 9 < 8)) {
        const cells = [i, i + 1, i + 9, i + 10],
          values = cells.map(v);
        if (Math.max(...values) * 2 === values.reduce((a, b) => a + b, 0))
          p.quadSums.push(cells);
      }
      if (!p.quadSums.length) {
        level--;
        continue;
      }
    }
    if (id === "palindrome") {
      p.palindromes = [];
      const used = new Set();
      const near = (i) =>
        indices(81).filter(
          (j) =>
            j !== i &&
            Math.abs(Math.floor(i / 9) - Math.floor(j / 9)) <= 1 &&
            Math.abs((i % 9) - (j % 9)) <= 1,
        );
      for (const middle of shuffle(indices(81))) {
        if (used.has(middle)) continue;
        const neighbors = shuffle(near(middle).filter((i) => !used.has(i)));
        let found = false;
        for (const a of neighbors) {
          const b = neighbors.find((b) => b !== a && v(a) === v(b));
          if (b === undefined) continue;
          p.palindromes.push([a, middle, b]);
          [a, middle, b].forEach((i) => used.add(i));
          found = true;
          break;
        }
        if (found && p.palindromes.length >= 5) break;
      }
      if (p.palindromes.length < 2) {
        level--;
        continue;
      }
    }
    p.givens = p.solution;
    const target = layouts[id] ? Math.ceil(p.solution.length * 0.38) : 22;
    for (const i of shuffle(indices(p.solution.length))) {
      if (p.givens.replace(/0/g, "").length <= target) break;
      const prev = p.givens;
      p.givens = prev.slice(0, i) + "0" + prev.slice(i + 1);
      if (!unique(p, layouts[id] ? 300 : 1200)) p.givens = prev;
    }
    if (!unique(p, 20000)) throw Error(p.id + " nonunique");
    puzzles.push(p);
    console.log(
      p.id,
      p.givens.replace(/0/g, "").length + "/" + p.solution.length,
    );
  }
  const old = data.sudoku.groups.findIndex((g) => g.id === id),
    group = { id, source: "worktime", puzzles };
  if (id === "triple" && old >= 0) {
    const previous = data.sudoku.groups[old];
    const legacy = [
      ...(previous.legacyPuzzles || []),
      ...previous.puzzles.filter((p) => !p.id.startsWith("triple-compact-")),
    ];
    if (legacy.length) group.legacyPuzzles = legacy;
  }
  if (old < 0) data.sudoku.groups.push(group);
  else data.sudoku.groups[old] = group;
}
fs.writeFileSync(
  "assets/data/sudoku.js",
  '"use strict";\n// Imported classics and locally generated variants; see licenses/sudoku-exchange.txt.\nWorkTimeApp.data.sudoku = ' +
    JSON.stringify(data.sudoku, null, 2) +
    ";\n",
);
