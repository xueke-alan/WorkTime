"use strict";
if (!process.argv[2])
  process.argv.push(require("node:path").resolve(__dirname, ".."));
process.argv.push("--ui-review");
require("./verify-link.cjs");
