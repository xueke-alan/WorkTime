"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const failures = [];
// Explicit per-release scope also applies inside the immutable pre-push snapshot.
const focusedFeatures = process.env.WORKTIME_RELEASE_FEATURES?.split(",")
  .map((feature) => feature.trim())
  .filter(Boolean);
if (focusedFeatures) {
  if (!focusedFeatures.length) throw Error("Release feature scope is empty");
  for (const feature of focusedFeatures)
    if (
      !/^[a-z0-9-]+$/.test(feature) ||
      !require("node:fs").existsSync(
        path.join(root, "scripts", "verify-" + feature + ".cjs"),
      )
    )
      throw Error("Unknown release feature: " + feature);
  console.log("Focused release checks: " + focusedFeatures.join(", "));
}
const publishedFeatures =
  process.env.WORKTIME_RELEASE_PUBLISHED_FEATURES?.split(",")
    .map((feature) => feature.trim())
    .filter(Boolean);
if (publishedFeatures) {
  if (
    !focusedFeatures ||
    !publishedFeatures.length ||
    publishedFeatures.some((feature) => !focusedFeatures.includes(feature))
  )
    throw Error(
      "Published checks must be a nonempty subset of the focused scope",
    );
  console.log("Published release checks: " + publishedFeatures.join(", "));
}
function run(
  script,
  args = [],
  cwd = root,
  { preload = false, env = process.env } = {},
) {
  console.log("\nChecking " + script + " " + args.join(" "));
  const result = spawnSync(
    process.execPath,
    [
      ...(preload
        ? ["--require", path.join(root, "scripts/lib/browser-test-setup.cjs")]
        : []),
      script,
      ...args,
    ],
    {
      cwd,
      env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("Release check failed: " + script);
}
function verify(feature, published = false, required = false) {
  if (process.env.WORKTIME_REVIEW_SKIP_READER === "1" && feature === "reader") {
    console.log(
      "Explicitly excluded dormant reader internals for this review.",
    );
    return;
  }
  try {
    run(
      path.join(root, "scripts", "verify-" + feature + ".cjs"),
      published ? [path.join(root, "_site")] : [],
      published ? path.join(root, "_site") : root,
      {
        preload: ![
          "onboarding",
          "auto-backup-folder",
          "runtime-folder",
          "runtime-migration",
          "review-browser",
          "performance-budget",
          "lunar-runtime",
          "startup-critical",
          "secondary-startup",
        ].includes(feature),
        env: {
          ...process.env,
          WORKTIME_TEST_DISABLE_AUTO_BACKUP:
            /backup|onboarding|runtime-folder|review-browser/.test(feature)
              ? "0"
              : "1",
        },
      },
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
  "agenda-week-to-fortnight-motion",
  "agenda-more-motion",
  "agenda-status-motion",
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
  "view-focus",
];
try {
  if (!focusedFeatures)
    run(path.join(root, "scripts/verify-review-regressions.cjs"));
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
  if (focusedFeatures) {
    // Some focused fixtures compare offline and published entries themselves.
    // Build first so a fresh commit snapshot never relies on an old _site.
    run(path.join(root, "scripts/prepare-site.cjs"));
    for (const feature of focusedFeatures)
      if (feature !== "startup") verify(feature);
    for (const feature of publishedFeatures || focusedFeatures)
      if (
        ![
          "offline",
          "xiangqi-engine",
          "onboarding",
          "sudoku-celebration",
          "startup-critical",
          "secondary-startup",
        ].includes(feature)
      )
        verify(feature, true);
  } else {
    // Catch broken entries and resource-budget regressions before long UI/game runs.
    for (const feature of [
      "lunar-runtime",
      "offline",
      "loading",
      "media-loading",
      "motion-settings",
      "runtime-folder",
      "runtime-migration",
      "review-browser",
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
      "music",
      "reader",
      "game-archive",
      "backup-clipboard",
      "backup-cache",
      "auto-backup",
      "auto-backup-folder",
      "settings-tabs",
      "minesweeper",
      "snake",
      "sudoku",
      "sudoku-variants",
      "sokoban",
      "xiangqi",
      "gomoku",
      "jungle",
      "ultimate-ttt",
      "sliding-puzzle",
      "lights-out",
      "ai-thinking",
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
      "startup-critical",
      "secondary-startup",
      "loading",
      "media-loading",
      "motion-settings",
      "runtime-folder",
      "runtime-migration",
      "review-browser",
      "performance-budget",
    ])
      verify(feature, true, true);
    for (const feature of [
      ...agendaChecks,
      "calendar-date",
      "minesweeper",
      "game-menu",
      "music",
      "reader",
      "game-archive",
      "backup-clipboard",
      "backup-cache",
      "auto-backup",
      "auto-backup-folder",
      "settings-tabs",
      "games",
      "analysis",
      "analysis-summary",
      "analysis-persistence",
      "analysis-sidebar",
      "performance",
      "snake",
      "sudoku",
      "sudoku-variants",
      "sokoban",
      "xiangqi",
      "gomoku",
      "ai-thinking",
      "jungle",
      "ultimate-ttt",
      "sliding-puzzle",
      "lights-out",
      "jump",
      "link",
      "garden",
      "tank",
    ])
      verify(feature, true);
  }
  if (failures.length)
    throw Error("Release checks failed: " + failures.join(", "));
  console.log("\nAll release checks passed.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
