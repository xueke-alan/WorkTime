"use strict";
/** Rebuild the bundled bank from the credited upstream text; no runtime network. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
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
  const bank = {
    author: "David W. Skinner",
    collection: "Microban",
    url,
    attributionUrl:
      "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/",
    sha256: crypto.createHash("sha256").update(text).digest("hex"),
    levels,
  };
  fs.writeFileSync(
    path.join(root, "assets/data/sokoban.js"),
    '"use strict";\nWorkTimeApp.data.sokoban = ' +
      JSON.stringify(bank, null, 2) +
      ";\n",
  );
  console.log(
    `Imported ${levels.length} verified levels, ${levels[0].minPushes}–${levels.at(-1).minPushes} minimum pushes.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
