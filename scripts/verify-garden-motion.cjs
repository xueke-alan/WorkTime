"use strict";
// Presentation-only review: bank generation and unchanged levels have separate checks.
if (!process.argv[2])
  process.argv.push(require("node:path").resolve(__dirname, ".."));
process.argv.push("--motion-only");
require("./verify-garden.cjs");
