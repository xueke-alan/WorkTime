"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { optimal } = require("./sokoban-optimal.cjs");
const sandbox = vm.createContext({ WorkTimeApp: { data: {}, games: {} } });
for (const file of [
  "assets/js/games/sokoban-rules.js",
  "assets/data/sokoban.js",
])
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
    sandbox,
  );
const rules = sandbox.WorkTimeApp.games.sokobanRules;
// Independent elementary-move Dijkstra oracle: no push macros, heuristic,
// region merging or dead-square pruning shared with the production solver.
function oracle(map, metric) {
  const pending = [{ player: map.player, boxes: [...map.boxes], cost: 0 }],
    seen = new Set();
  let head = 0;
  while (metric === "moves" ? head < pending.length : pending.length) {
    if (metric !== "moves") pending.sort((a, b) => b.cost - a.cost);
    const cur = metric === "moves" ? pending[head++] : pending.pop();
    const key =
      cur.player + ":" + [...cur.boxes].sort((a, b) => a - b).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    if (cur.boxes.every((b) => map.goals.has(b))) return cur.cost;
    for (const delta of [1, -1, map.width, -map.width]) {
      const player = cur.player + delta,
        pushed = cur.boxes.includes(player);
      if (
        !map.floors.has(player) ||
        (pushed &&
          (!map.floors.has(player + delta) ||
            cur.boxes.includes(player + delta)))
      )
        continue;
      pending.push({
        player,
        boxes: cur.boxes.map((b) => (b === player ? b + delta : b)),
        cost: cur.cost + (metric === "moves" ? 1 : Number(pushed)),
      });
    }
  }
  return null;
}
for (const level of sandbox.WorkTimeApp.data.sokoban.levels.slice(0, 10)) {
  const map = rules.parse(level);
  for (const metric of ["moves", "pushes"]) {
    const result = optimal(map, metric, { milliseconds: 10000 });
    assert.ok(result);
    assert.equal(result.value, oracle(map, metric), level.id + " " + metric);
    assert.equal(
      result.value,
      sandbox.WorkTimeApp.data.sokoban.optima[level.id][metric].value,
    );
  }
  assert.equal(
    optimal(map, "moves", { maxNodes: 0 }),
    null,
    "budget exhaustion is never a claimed optimum",
  );
}
// Exercise matching, blocked squares and walking costs on small multi-box maps.
const fixtures = [
  ["##########", "#....... #", "#$$$$$$$ #", "#  @     #", "##########"],
  ["#########", "#...... #", "#$$$$$$ #", "#  @    #", "#########"],
  ["########", "#..... #", "#$$$$$ #", "#  @   #", "########"],
  ["#########", "# . . . #", "# $ $ $ #", "#   @   #", "#########"],
  ["#######", "# . . #", "# $ $ #", "#  @  #", "#######"],
  ["#######", "# . . #", "# $$@ #", "#     #", "#######"],
  ["#######", "# . . #", "# $$  #", "# $$@ #", "# . . #", "#######"],
];
const nativeFixtures = {};
for (const [index, rows] of fixtures.entries()) {
  const map = rules.parse({ rows });
  nativeFixtures[index] = {
    large: true,
    projection: map.boxes.length,
    width: map.width,
    player: map.player,
    boxes: [...map.boxes],
    goals: [...map.goals],
    floors: [...map.floors],
    upper: 1000,
    milliseconds: 10000,
  };
  for (const metric of map.boxes.length >= 5
    ? ["moves"]
    : ["moves", "pushes"]) {
    const expected = oracle(map, metric);
    const result = optimal(map, metric, { milliseconds: 10000 });
    assert.equal(result?.value ?? null, expected, rows.join("/") + metric);
  }
}
const exportIndex = process.argv.indexOf("--export-native-fixtures");
if (exportIndex >= 0)
  fs.writeFileSync(
    process.argv[exportIndex + 1],
    JSON.stringify(nativeFixtures),
  );
const nativeIndex = process.argv.indexOf("--check-native-fixtures");
if (nativeIndex >= 0) {
  const results = fs
    .readFileSync(process.argv[nativeIndex + 1], "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(results.length, fixtures.length);
  for (const { id, result } of results)
    assert.equal(
      result?.value ?? null,
      oracle(rules.parse({ rows: fixtures[Number(id)] }), "moves"),
    );
}
for (const level of sandbox.WorkTimeApp.data.sokoban.levels) {
  const result = sandbox.WorkTimeApp.data.sokoban.optima[level.id]?.moves;
  if (!result) continue;
  const map = rules.parse(level),
    state = rules.create();
  for (const step of result.path) assert.ok(rules.move(map, state, step));
  assert.ok(rules.won(map, state), level.id);
  assert.equal(state.moves, result.value, level.id + " minimum moves");
  assert.equal(state.pushes, result.pushes, level.id + " corresponding pushes");
}
console.log(
  "Exact solver matches elementary-move oracle for both objectives; budget handling verified.",
);
