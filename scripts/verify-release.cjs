"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function run(script, args = [], cwd = root) {
  console.log("\nChecking " + script + " " + args.join(" "));
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("Release check failed: " + script);
}
function verify(feature, published = false) {
  run(
    path.join(root, "scripts", "verify-" + feature + ".cjs"),
    published ? [path.join(root, "_site")] : [],
    published ? path.join(root, "_site") : root,
  );
}
try {
  run(path.join(root, "scripts/check-site.cjs"));
  run(path.join(root, "node_modules/typescript/bin/tsc"), [
    "-p",
    "jsconfig.json",
  ]);
  run(
    path.join(
      path.dirname(require.resolve("eslint/package.json")),
      "bin/eslint.js",
    ),
    [
      "assets/js",
      "scripts",
      "tools",
      "eslint.config.cjs",
      "--max-warnings",
      "0",
    ],
  );
  run(
    path.join(
      path.dirname(require.resolve("prettier/package.json")),
      "bin/prettier.cjs",
    ),
    [
      "--check",
      "assets/js/**/*.js",
      "scripts/**/*.cjs",
      "tools/**/*.js",
      "eslint.config.cjs",
    ],
  );
  for (const feature of [
    "offline",
    "loading",
    "performance-budget",
    "calendar-date",
    "batch-month",
    "reset-state",
    "rest-overtime",
    "source-priority",
    "games",
    "game-menu",
    "game-archive",
    "minesweeper",
    "snake",
    "sudoku",
    "sokoban",
    "analysis",
    "performance",
    "jump",
    "link",
    "garden",
    "tank",
  ])
    verify(feature);
  run(path.join(root, "scripts/prepare-site.cjs"));
  for (const feature of [
    "startup",
    "loading",
    "performance-budget",
    "calendar-date",
    "minesweeper",
    "game-menu",
    "game-archive",
    "games",
    "analysis",
    "performance",
    "snake",
    "sudoku",
    "sokoban",
    "jump",
    "link",
    "garden",
    "tank",
  ])
    verify(feature, true);
  console.log("\nAll release checks passed.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
