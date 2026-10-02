"use strict";
const globals = require("globals");
// Runtime namespaces are classic-script contracts declared by the ordered entry point.
const runtime = Object.fromEntries(
  [
    "WorkTimeValues",
    "WorkState",
    "WorkMigrations",
    "WorkCalendar",
    "WorkRecords",
    "WorkStatistics",
    "WorkObservations",
    "WorkValidation",
    "WorkTime",
    "WorkStorage",
    "WorkImports",
    "WorkBackup",
    "WorkUI",
    "WorkApplication",
    "WorkDerived",
    "WorkImportIndex",
    "WorkBootstrap",
    "WorkClock",
    "WorkCalendarData",
    "WorkClipboard",
    "WorkDownloads",
    "WorkYear",
    "UIAlignment",
  ].map((name) => [name, "readonly"]),
);
const rules = {
  "no-undef": "error",
  "no-dupe-args": "error",
  "no-dupe-keys": "error",
  "no-unreachable": "error",
  "valid-typeof": "error",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-unused-vars": [
    "warn",
    {
      vars: "local",
      args: "none",
      caughtErrors: "none",
      ignoreRestSiblings: true,
    },
  ],
};
module.exports = [
  {
    ignores: [
      "node_modules/**",
      ".refactor-backups/**",
      "assets/vendor/**",
      "assets/data/**",
      "scripts/vendor/**",
    ],
  },
  {
    files: ["assets/js/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, ...runtime },
    },
    rules,
  },
  {
    files: ["scripts/**/*.cjs", "tests/**/*.cjs", "eslint.config.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.browser, ...runtime },
    },
    rules,
  },
];
