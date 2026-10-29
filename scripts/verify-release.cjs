"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const failures = [];
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
function verify(feature, published = false, required = false) {
  try {
    run(
      path.join(root, "scripts", "verify-" + feature + ".cjs"),
      published ? [path.join(root, "_site")] : [],
      published ? path.join(root, "_site") : root,
    );
  } catch (error) {
    if (required) throw error;
    failures.push(feature + (published ? " (published)" : " (source)"));
    console.error(error.message);
  }
}
const agendaChecks = [
  "popover",
  "agenda",
  "agenda-week",
  "agenda-week-selection",
  "agenda-timetable-status",
  "agenda-timetable-resize",
  "agenda-break-edges",
  "agenda-timetable",
  "agenda-timetable-save",
  "agenda-dual-regressions",
  "agenda-seven-fixes",
  "agenda-three-week",
  "calendar-navigation",
  "year-transitions",
  "agenda-today",
  "agenda-span",
  "agenda-range",
  "agenda-drag",
  "agenda-drag-order",
  "agenda-resize",
  "agenda-edit-motion",
  "agenda-editor-ux",
  "agenda-move-landing",
  "agenda-preview-regressions",
  "agenda-resize-cross-week",
  "agenda-resize-left-start",
  "agenda-resize-preview-motion",
  "agenda-resize-reorder",
  "agenda-resize-stable-order",
  "agenda-workspace",
  "agenda-motion",
  "agenda-entry-motion",
  "toolbar-motion",
  "agenda-border",
  "agenda-text",
  "agenda-status",
  "agenda-states",
  "agenda-completion",
  "agenda-selection",
  "agenda-position",
  "analysis-ratio",
];
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
  // Catch broken entries and resource-budget regressions before long UI/game runs.
  for (const feature of [
    "lunar-runtime",
    "offline",
    "loading",
    "rescue",
    "performance-budget",
  ])
    verify(feature, false, true);
  for (const feature of [
    ...agendaChecks,
    "calendar-date",
    "batch-month",
    "reset-state",
    "rest-overtime",
    "source-priority",
    "games",
    "game-menu",
    "game-archive",
    "backup-clipboard",
    "backup-cache",
    "auto-backup",
    "minesweeper",
    "snake",
    "sudoku",
    "sokoban",
    "analysis",
    "analysis-summary",
    "analysis-persistence",
    "analysis-sidebar",
    "performance",
    "jump",
    "link",
    "garden",
    "tank",
  ])
    verify(feature);
  run(path.join(root, "scripts/prepare-site.cjs"));
  for (const feature of [
    "lunar-runtime",
    "startup",
    "loading",
    "rescue",
    "performance-budget",
  ])
    verify(feature, true, true);
  for (const feature of [
    ...agendaChecks,
    "calendar-date",
    "minesweeper",
    "game-menu",
    "game-archive",
    "backup-clipboard",
    "backup-cache",
    "auto-backup",
    "games",
    "analysis",
    "analysis-summary",
    "analysis-persistence",
    "analysis-sidebar",
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
  if (failures.length)
    throw Error("Release checks failed: " + failures.join(", "));
  console.log("\nAll release checks passed.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
