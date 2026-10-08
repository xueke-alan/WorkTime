"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process");
const results = path.resolve(__dirname, "../test-results");
fs.mkdirSync(results, { recursive: true });
const directory = fs.mkdtempSync(path.join(results, "entry-artifacts-"));
const cases = [
  [
    "results",
    'fs.writeFileSync("test-results/scenario.json", "new result")',
    [],
  ],
  [
    "document",
    'fs.writeFileSync("docs/reference.md", "replaced")',
    ["docs/reference.md"],
  ],
  ["new-document", 'fs.writeFileSync("docs/new.md", "new")', ["docs/new.md"]],
  [
    "fixture",
    'fs.writeFileSync("tests/fixtures/reference.json", "replaced")',
    ["tests/fixtures/reference.json"],
  ],
  [
    "deleted-fixture",
    'fs.unlinkSync("tests/fixtures/reference.json")',
    ["tests/fixtures/reference.json"],
  ],
];
for (const [name, mutation, changed] of cases) {
  const root = path.join(directory, name);
  for (const folder of ["scripts", "docs", "tests/fixtures"])
    fs.mkdirSync(path.join(root, folder), { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, "../scripts/test.cjs"),
    path.join(root, "scripts/test.cjs"),
  );
  fs.writeFileSync(
    path.join(root, "scripts/test-manifest.cjs"),
    'module.exports = {root: require("node:path").resolve(__dirname, ".."), manifest: () => ({unit:["tests/scenario.cjs"]})};',
  );
  fs.writeFileSync(path.join(root, "docs/reference.md"), "original document");
  fs.writeFileSync(
    path.join(root, "tests/fixtures/reference.json"),
    "original fixture",
  );
  fs.writeFileSync(
    path.join(root, "tests/scenario.cjs"),
    'const fs = require("node:fs");' + mutation + ";",
  );
  const run = spawnSync(process.execPath, ["scripts/test.cjs", "--unit"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(run.error, undefined, name);
  assert.equal(
    run.status,
    changed.length ? 1 : 0,
    name + ": " + run.stdout + run.stderr,
  );
  const checks = JSON.parse(
    fs.readFileSync(path.join(root, "test-results/checks.json"), "utf8"),
  );
  assert.equal(checks[0].ok, true, "Scenario child itself succeeded");
  const guard = checks.find((check) => check.group === "artifacts");
  assert.equal(guard.ok, changed.length === 0);
  assert.deepEqual(
    guard.changedFiles.map((file) => file.replaceAll(path.sep, "/")),
    changed,
  );
}
console.log(
  "Actual test entry protects modified/added docs and modified/deleted fixtures, while allowing result artifacts.",
);
