"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {
  data,
  ids,
  rate,
  hard,
  signature,
  fingerprint,
} = require("./sudoku-variant-rating.cjs");
const root = path.resolve(__dirname, "..");
const reportPath = path.join(root, "scripts/sudoku-variant-difficulty.json");
const previous = fs.existsSync(reportPath)
  ? JSON.parse(fs.readFileSync(reportPath, "utf8"))
  : null;
const clone = (value) => JSON.parse(JSON.stringify(value));
const report = {
  method:
    "variant-rating-v1: rule-aware candidates, naked/hidden singles, naked pairs/triples; deterministic MRV ascending search to two solutions; score=branches+backtracks+5*depth. Program rating, not a human grade.",
  seed: 20261111,
  hard: { remainingAbove: 0, minimumDepth: 3, scoreAbove: 20 },
  untouched:
    previous?.untouched ||
    data.groups
      .filter((g) => !ids.includes(g.id))
      .map((g) => ({ id: g.id, fingerprint: fingerprint(g) })),
  groups: [],
};
let seed;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
function shuffle(values) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function metrics(p) {
  const { solutions, ...row } = rate(p);
  if (solutions.length !== 1 || solutions[0] !== p.solution)
    throw Error(p.id + " must have one matching solution");
  return { id: p.id, ...row, solutionCount: solutions.length };
}
const checkOnly = process.argv.includes("--report");
const dryRun = process.argv.includes("--check");
for (const id of ids) {
  seed = report.seed + ids.indexOf(id) * 100003;
  const group = data.groups.find((g) => g.id === id);
  const all = [...group.puzzles, ...(group.legacyPuzzles || [])];
  const oldReport = previous?.groups.find((g) => g.id === id);
  const originals = oldReport
    ? oldReport.originals.map((entry) => {
        const p = all.find((p) => p.id === entry.id);
        if (!p || fingerprint(p) !== entry.fingerprint)
          throw Error(entry.id + " original changed");
        return clone(p);
      })
    : clone(group.puzzles);
  const baseline = originals.map(metrics);
  const rows = new Map(baseline.map((row) => [row.id, row]));
  if (!checkOnly) {
    const normal = originals.filter((p) => !hard(rows.get(p.id)));
    const difficult = originals
      .filter((p) => hard(rows.get(p.id)))
      .sort(
        (a, b) =>
          rows.get(a.id).score - rows.get(b.id).score ||
          a.id.localeCompare(b.id),
      );
    // Keep ten strongest old challenges visible; surplus originals remain loadable.
    const surplus = difficult.splice(0, Math.max(0, difficult.length - 10));
    const seen = new Set(originals.map(signature));
    const usedIds = new Set(all.map((p) => p.id));
    // Reuse the same new IDs on a reproducible rebuild.
    for (const p of all)
      if (!originals.some((old) => old.id === p.id)) usedIds.delete(p.id);
    let nextId = 21,
      attempts = 0;
    function accept(p, row, target) {
      const key = signature(p);
      if (seen.has(key)) return false;
      seen.add(key);
      while (usedIds.has(id + "-" + nextId)) nextId++;
      p.id = id + "-" + nextId++;
      usedIds.add(p.id);
      row.id = p.id;
      rows.set(p.id, row);
      target.push(p);
      return true;
    }
    while (normal.length < 20 || difficult.length < 10) {
      if (++attempts > 5000) throw Error("Generation exhausted for " + id);
      const wantHard = normal.length >= 20;
      const template = originals[Math.floor(random() * originals.length)];
      const p = clone(template);
      delete p.difficulty;
      delete p.originalGivens;
      delete p.rating;
      let r;
      if (!wantHard) {
        // Adding correct givens preserves uniqueness and creates genuine easier puzzles.
        const cells = shuffle(
          Array.from({ length: 81 }, (_, i) => i).filter(
            (i) => p.givens[i] === "0",
          ),
        );
        const add = 1 + Math.floor(random() * 9);
        for (let j = 0; j < cells.length; j++) {
          const i = cells[j];
          p.givens =
            p.givens.slice(0, i) + p.solution[i] + p.givens.slice(i + 1);
          if (j + 1 < add) continue;
          r = rate(p);
          if (!hard(r)) break;
        }
      } else {
        // Vary the clue mask, then greedily remove clues with a full uniqueness check.
        const blank = shuffle(
          Array.from({ length: 81 }, (_, i) => i).filter(
            (i) => p.givens[i] === "0",
          ),
        );
        for (const i of blank.slice(0, 2 + Math.floor(random() * 5)))
          p.givens =
            p.givens.slice(0, i) + p.solution[i] + p.givens.slice(i + 1);
        for (const i of shuffle(
          Array.from({ length: 81 }, (_, i) => i).filter(
            (i) => p.givens[i] !== "0",
          ),
        )) {
          const saved = p.givens;
          p.givens = saved.slice(0, i) + "0" + saved.slice(i + 1);
          try {
            r = rate(p, 1500);
            if (r.solutions.length !== 1 || r.solutions[0] !== p.solution)
              p.givens = saved;
            else if (hard(r) && !seen.has(signature(p))) break;
          } catch (error) {
            if (!error.message.includes("search limit")) throw error;
            p.givens = saved;
          }
        }
        r = rate(p);
      }
      if (
        !r ||
        r.solutions.length !== 1 ||
        r.solutions[0] !== p.solution ||
        hard(r) !== wantHard
      )
        continue;
      const { solutions, ...row } = r;
      accept(
        p,
        { ...row, solutionCount: solutions.length },
        wantHard ? difficult : normal,
      );
    }
    difficult.sort(
      (a, b) =>
        rows.get(a.id).score - rows.get(b.id).score || a.id.localeCompare(b.id),
    );
    normal.forEach((p) => delete p.difficulty);
    difficult.forEach((p) => {
      p.difficulty = "hard";
    });
    surplus.forEach((p) => {
      p.difficulty = "hard";
    });
    group.puzzles = [...normal, ...difficult];
    const originalIds = new Set(originals.map((p) => p.id));
    const legacy = [
      ...(group.legacyPuzzles || []).filter((p) => !originalIds.has(p.id)),
      ...surplus,
    ];
    if (legacy.length) group.legacyPuzzles = legacy;
    console.log(
      id,
      "original hard",
      baseline.filter(hard).length,
      "visible",
      group.puzzles.length,
      "legacy",
      legacy.length,
    );
  }
  report.groups.push({
    id,
    originals: originals.map((p) => ({
      id: p.id,
      fingerprint: fingerprint(p),
    })),
    baseline,
    rows: group.puzzles.map(metrics),
    legacyRows: (group.legacyPuzzles || []).map(metrics),
  });
}
const catalogPath = path.join(root, "assets/data/sudoku.js");
const catalogText =
  '"use strict";\n// Imported classics and locally generated variants; see licenses/sudoku-exchange.txt.\nWorkTimeApp.data.sudoku = ' +
  JSON.stringify(data, null, 2) +
  ";\n";
const reportText = JSON.stringify(report, null, 2) + "\n";
if (dryRun) {
  if (
    (!checkOnly && fs.readFileSync(catalogPath, "utf8") !== catalogText) ||
    fs.readFileSync(reportPath, "utf8") !== reportText
  )
    throw Error("Sudoku catalog/report differs from deterministic rebuild");
  console.log("Sudoku deterministic rebuild verified without writing files.");
} else {
  if (!checkOnly) fs.writeFileSync(catalogPath, catalogText);
  fs.writeFileSync(reportPath, reportText);
}
