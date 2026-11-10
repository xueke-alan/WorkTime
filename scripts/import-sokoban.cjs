"use strict";
/** Rebuild the bundled bank from the credited upstream text; no runtime network. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const {
  originals,
  signature,
  solveAdvanced,
  assess,
} = require("./sokoban-bank.cjs");
const assert = require("node:assert/strict");
const sandbox = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/js/games/sokoban-rules.js"), "utf8"),
  sandbox,
);
const rules = sandbox.WorkTimeApp.games.sokobanRules;
// Breadth-first search over pushes, merging equivalent reachable player regions.
function solve(map, limit = 80000) {
  const offsets = Object.entries(rules.directions).map(([key, [x, y]]) => [
    key,
    x + y * map.width,
  ]);
  function reachable(player, boxes) {
    const paths = new Map([[player, ""]]),
      pending = [player];
    for (let i = 0; i < pending.length; i++)
      for (const [key, delta] of offsets) {
        const next = pending[i] + delta;
        if (map.floors.has(next) && !boxes.includes(next) && !paths.has(next)) {
          paths.set(next, paths.get(pending[i]) + key);
          pending.push(next);
        }
      }
    return paths;
  }
  const queue = [
    {
      player: map.player,
      boxes: [...map.boxes].sort((a, b) => a - b),
      parent: null,
      segment: "",
      pushes: 0,
    },
  ];
  const seen = new Set();
  for (let i = 0; i < queue.length && queue.length <= limit; i++) {
    const current = queue[i];
    if (current.boxes.every((box) => map.goals.has(box))) {
      let solution = "",
        step = current;
      while (step.parent) {
        solution = step.segment + solution;
        step = step.parent;
      }
      return { solution, minPushes: current.pushes };
    }
    const paths = reachable(current.player, current.boxes);
    const signature = current.boxes.join(",") + ":" + Math.min(...paths.keys());
    if (seen.has(signature)) continue;
    seen.add(signature);
    for (const box of current.boxes)
      for (const [key, delta] of offsets) {
        const destination = box + delta;
        if (
          !paths.has(box - delta) ||
          !map.floors.has(destination) ||
          current.boxes.includes(destination)
        )
          continue;
        const boxes = current.boxes
          .map((b) => (b === box ? destination : b))
          .sort((a, b) => a - b);
        if (rules.deadlocked(map, { history: [{ player: box, boxes }] }))
          continue;
        queue.push({
          player: box,
          boxes,
          parent: current,
          segment: paths.get(box - delta) + key,
          pushes: current.pushes + 1,
        });
      }
  }
  return null;
}
async function main() {
  // Example: node scripts/import-sokoban.cjs --solve sasquatch-4 23
  // Diagnostic search only: does not alter the frozen selection or bank.
  const solveIndex = process.argv.indexOf("--solve");
  if (solveIndex >= 0) {
    const source = process.argv[solveIndex + 1];
    assert.match(source, /^sasquatch-[1-7]$/);
    const rows = originals(
      fs.readFileSync(
        path.join(root, "assets/data/sources", source + ".txt"),
        "utf8",
      ),
    ).get(Number(process.argv[solveIndex + 2]));
    assert.ok(rows, "Unknown source level");
    const map = rules.parse({ rows });
    const result = solveAdvanced(map, rules);
    if (!result) throw Error("Search budget exhausted; solvability is unknown");
    const state = rules.create();
    for (const direction of result.solution)
      assert.ok(rules.move(map, state, direction));
    assert.ok(rules.won(map, state));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const url =
    "https://raw.githubusercontent.com/sebnozzi/minimicro-sokoban/master/microban.txt";
  const sourceFile = path.join(root, "assets/data/sources/microban.txt");
  if (process.argv.includes("--fetch")) {
    const response = await fetch(url);
    if (!response.ok) throw Error("Source download failed: " + response.status);
    fs.writeFileSync(sourceFile, await response.text());
  }
  const text = fs.readFileSync(sourceFile, "utf8");
  const levels = [];
  const blocks = text.split(/^;[ \t]*(\d+)[^\r\n]*\r?\n/m);
  for (let i = 1; i < blocks.length && Number(blocks[i]) <= 100; i += 2) {
    const rows = blocks[i + 1]
      .split(/\r?\n/)
      .filter((line) => line.includes("#"))
      .map((line) => line.trimEnd());
    const level = {
      id: "microban-" + blocks[i],
      sourceNumber: Number(blocks[i]),
      rows,
    };
    const result = solve(rules.parse(level));
    if (result) levels.push({ ...level, ...result });
    if (levels.length === 60) break;
  }
  if (levels.length !== 60) throw Error("Expected 60 verified levels");
  levels.sort(
    (a, b) =>
      a.minPushes - b.minPushes ||
      a.solution.length - b.solution.length ||
      a.sourceNumber - b.sourceNumber,
  );
  const attributionUrl =
    "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/";
  const digest = (value) =>
    crypto.createHash("sha256").update(value).digest("hex");
  const sources = [
    {
      id: "microban",
      collection: "Microban",
      author: "David W. Skinner",
      file: "microban.txt",
      url,
      sha256: digest(text),
      attributionUrl,
    },
  ];
  levels.forEach((level) => {
    level.source = "microban";
  });
  const selection = require("./sokoban-selection.json");
  assert.equal(
    digest(JSON.stringify(levels.map(({ source, ...level }) => level))),
    selection.legacySha256,
    "Preserve all legacy level fields and their order",
  );
  const sourceMaps = new Map([["microban", originals(text)]]);
  for (const id of [
    ...new Set(selection.levels.map((level) => level.source)),
  ].sort()) {
    if (id === "microban") continue;
    const file = id + ".txt",
      sourceText = fs.readFileSync(
        path.join(root, "assets/data/sources", file),
        "utf8",
      );
    const number = Number(id.split("-")[1]);
    sources.push({
      id,
      collection: number === 2 ? "Mas Sasquatch" : "Sasquatch " + number,
      author: "David W. Skinner",
      file,
      url: attributionUrl + "s" + number + ".txt",
      sha256: digest(sourceText),
      attributionUrl,
    });
    sourceMaps.set(id, originals(sourceText));
  }
  for (const entry of selection.levels) {
    assert.ok(
      !selection.excluded.includes(entry.id),
      "Exclude third-party derivations",
    );
    const level = {
      ...entry,
      rows: sourceMaps.get(entry.source).get(entry.sourceNumber),
    };
    const map = rules.parse(level),
      state = rules.create();
    for (const direction of level.solution)
      assert.equal(rules.move(map, state, direction), true, level.id);
    assert.ok(rules.won(map, state), level.id);
    assert.equal(state.pushes, level.solutionPushes);
    levels.push(level);
  }
  assert.equal(levels.length, 140);
  const lookup = new Map(levels.map((level) => [level.id, level]));
  for (const { id, sha256 } of selection.previousLevels) {
    const level = lookup.get(id);
    assert.ok(level, "Preserve previous level: " + id);
    assert.equal(
      digest(
        JSON.stringify({
          rows: level.rows,
          solution: level.solution,
          minPushes: level.minPushes,
        }),
      ),
      sha256,
      "Preserve previous geometry and solution: " + id,
    );
  }
  const order = new Map(selection.order.map((id, index) => [id, index]));
  assert.equal(order.size, 140);
  for (const level of levels) {
    const assessment = assess(level, rules);
    level.difficultyMetrics = assessment.metrics;
    level.difficultyScore = assessment.score;
  }
  levels.sort(
    (a, b) => a.difficultyScore - b.difficultyScore || a.id.localeCompare(b.id),
  );
  assert.deepEqual(
    levels.map((level) => level.id),
    selection.order,
    "Frozen seven-tier ordering",
  );
  assert.equal(
    new Set(levels.map((level) => signature(level.rows))).size,
    140,
    "No rotated or mirrored duplicates",
  );
  const chapters = [
    { id: "beginner", skin: "forest", ratingRange: [1, 2.5] },
    { id: "initiate", skin: "desert", ratingRange: [3, 4.5] },
    { id: "amateur", skin: "greenhouse", ratingRange: [5, 6.5] },
    { id: "expert", skin: "glacier", ratingRange: [7, 7.5] },
    { id: "expertPlus", skin: "space", ratingRange: [8, 8.5] },
    { id: "fanatic", skin: "forge", ratingRange: [9, 9.5] },
    { id: "master", skin: "palace", ratingRange: [10, 10] },
  ].map((chapter, index) => ({ ...chapter, start: index * 20, count: 20 }));
  for (const chapter of chapters) {
    assert.equal(
      levels.slice(chapter.start, chapter.start + chapter.count).length,
      20,
    );
    for (const level of levels.slice(
      chapter.start,
      chapter.start + chapter.count,
    )) {
      level.difficulty = chapter.id;
      const map = rules.parse(level);
      assert.ok(map.width <= 20 && map.height <= 20, "Mobile map size limit");
    }
  }
  const bank = {
    author: "David W. Skinner",
    collection: "Microban / Sasquatch",
    url,
    attributionUrl,
    sha256: digest(text),
    sources,
    chapters,
    ratingSystem: {
      reference: "https://aymericdupeloux.wixsite.com/sokoban/post/welcome",
      assessment:
        "Local replay-based assessment using the seven Cosmos labels and score ranges, not original author ratings. " +
        selection.ranking,
    },
    solutionSource: {
      url: "https://github.com/guylangston/SokoSolve/blob/4045224e65832e5475d9c1c781251b5c3c4d6ac0/data/Lib/solutions.json",
      file: "sasquatch-solutions.json",
      sha256: digest(
        fs.readFileSync(
          path.join(root, "assets/data/sources/sasquatch-solutions.json"),
        ),
      ),
    },
    optima: require("./sokoban-optima.json"),
    levels,
  };

  const output = path.join(root, "assets/data/sokoban.js");
  const contents =
    '\"use strict\";\nWorkTimeApp.data.sokoban = ' +
    JSON.stringify(bank, null, 2) +
    ";\n";
  if (process.argv.includes("--check"))
    assert.equal(
      fs.readFileSync(output, "utf8"),
      contents,
      "Bank regeneration must be identical",
    );
  else fs.writeFileSync(output, contents);
  console.log(
    `Verified ${levels.length} puzzles, seven chapters; all previous level IDs, geometry and solutions preserved.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
