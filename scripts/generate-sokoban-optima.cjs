"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { optimal } = require("./sokoban-optimal.cjs");
const root = path.resolve(__dirname, "..");
const sandbox = vm.createContext({ WorkTimeApp: { data: {}, games: {} } });
for (const file of [
  "assets/data/sokoban.js",
  "assets/js/games/sokoban-rules.js",
])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox);
const { levels } = sandbox.WorkTimeApp.data.sokoban;
const rules = sandbox.WorkTimeApp.games.sokobanRules;
const file = path.join(__dirname, "sokoban-optima.json");
const records = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {};
const exportIndex = process.argv.indexOf("--export-native");
if (exportIndex >= 0) {
  const batch = {};
  for (const level of levels) {
    if (records[level.id]?.moves) continue;
    const map = rules.parse(level);
    batch[level.id] = {
      large:
        process.argv.includes("--large-patterns") ||
        process.argv.includes("--near-full-projections"),
      projection: process.argv.includes("--near-full-projections")
        ? Math.min(map.boxes.length, Math.max(4, map.boxes.length - 2))
        : 0,
      memoryGiB: Number(process.env.SOKOBAN_NATIVE_MEMORY_GIB || 0),
      width: map.width,
      player: map.player,
      boxes: [...map.boxes],
      goals: [...map.goals],
      floors: [...map.floors],
      upper: Math.min(
        level.solution.length,
        records[level.id]?.pushes?.path.length ?? Infinity,
      ),
      milliseconds: Number(process.env.SOKOBAN_SEARCH_MS || 120000),
    };
  }
  fs.writeFileSync(process.argv[exportIndex + 1], JSON.stringify(batch));
  console.log("Exported", Object.keys(batch).length, "unproven levels");
  process.exit(0);
}
const importIndex = process.argv.indexOf("--import-native");
if (importIndex >= 0) {
  const inputs = JSON.parse(
    fs.readFileSync(process.argv[importIndex + 2], "utf8"),
  );
  for (const line of fs
    .readFileSync(process.argv[importIndex + 1], "utf8")
    .trim()
    .split(/\r?\n/)) {
    if (!line) continue;
    const { id, result } = JSON.parse(line);
    if (!result) continue;
    const level = levels.find((level) => level.id === id);
    assert.ok(level, "Imported level exists");
    const map = rules.parse(level),
      input = inputs[id];
    assert.deepEqual(input.boxes, [...map.boxes]);
    assert.deepEqual(input.goals, [...map.goals]);
    assert.deepEqual(input.floors, [...map.floors]);
    assert.equal(input.player, map.player);
    assert.equal(input.width, map.width);
    const state = rules.create();
    for (const step of result.path) assert.ok(rules.move(map, state, step));
    assert.ok(rules.won(map, state), id);
    assert.equal(state.moves, result.value);
    const record = records[id];
    assert.ok(record);
    if (record.moves) assert.equal(record.moves.value, result.value);
    else
      record.moves = {
        value: result.value,
        path: result.path,
        pushes: state.pushes,
      };
  }
}
const check = process.argv.includes("--check");
for (const level of levels) {
  const rowsHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(level.rows))
    .digest("hex");
  const record = records[level.id] ?? { rowsHash };
  assert.equal(record.rowsHash, rowsHash, level.id + " optimum geometry");
  const map = rules.parse(level);
  for (const metric of ["moves"]) {
    if (!check && importIndex < 0 && !record[metric]) {
      record[metric] = optimal(map, metric, {
        milliseconds: Number(process.env.SOKOBAN_SEARCH_MS || 300),
        maxNodes: Number(process.env.SOKOBAN_SEARCH_NODES || 150000),
      });
    }
    if (!record[metric]) continue;
    const state = rules.create();
    for (const step of record[metric].path)
      assert.ok(rules.move(map, state, step));
    assert.ok(rules.won(map, state), level.id + " optimum witness");
    assert.equal(state[metric], record[metric].value);
    if (check) assert.equal(record[metric].pushes, state.pushes);
    else record[metric].pushes = state.pushes;
    if (metric === "pushes" && level.minPushes != null)
      assert.equal(record[metric].value, level.minPushes);
  }
  if (check)
    assert.ok(
      records[level.id],
      "Every level has an explicit verification status",
    );
  else {
    records[level.id] = record;
    fs.writeFileSync(file, JSON.stringify(records, null, 2) + "\n");
    console.log(
      level.id,
      record.moves?.value ?? "?",
      record.moves?.pushes ?? "?",
    );
  }
}
console.log(
  "Move benchmarks:",
  Object.values(records).filter((r) => r.moves).length,
  "corresponding push counts:",
  levels.filter((l) => records[l.id]?.moves?.pushes != null).length,
);

const missing = levels.filter((level) => !records[level.id]?.moves);
console.log(
  "Missing move benchmarks:",
  missing.map((level) => level.id).join(", ") || "none",
);
if (process.argv.includes("--require-complete"))
  assert.equal(missing.length, 0, "All levels must have move benchmarks");
