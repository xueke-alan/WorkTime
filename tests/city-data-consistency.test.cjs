"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const generated = path.join(root, "assets/data/weather-cities.js");
const before = fs.readFileSync(generated);
const checked = spawnSync(
  process.execPath,
  ["scripts/sync-weather-cities.cjs", "--check"],
  {
    cwd: root,
    encoding: "utf8",
  },
);
assert.equal(checked.status, 0, checked.stderr || checked.stdout);
assert.deepEqual(
  fs.readFileSync(generated),
  before,
  "Consistency check never writes the generated file",
);
console.log(
  "City authority passed: JSON source matches generated namespaced directory; check mode leaves bytes unchanged.",
);
